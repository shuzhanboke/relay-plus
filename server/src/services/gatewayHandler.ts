import type { Request, Response, NextFunction } from 'express';
import type { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { resolveApiKey, touchKey, type ApiKeyWithUser } from './apiKey.js';
import { accountsByGroup, accountsAllActive, resolveAccountTarget, type AccountRuntime } from './accountService.js';
import { priceService, computeCost, getBillingMultiplier } from './pricing.js';
import { estimateUsageFromRequest, parseOpenAIUsage, estimateTokens, extractStreamUsage } from './tokenizer.js';
import { insertLog } from './logService.js';
import { rateLimiter } from './rateLimit.js';

interface GatewayConfig {
  upstreamTimeoutMs: number;
}

let cfg: GatewayConfig = { upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS) || 300000 };
export function setGatewayConfig(c: Partial<GatewayConfig>): void { cfg = { ...cfg, ...c }; }

/** 终端入口中间件：鉴权 + 分发。 */
export async function gatewayHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  const startedAt = Date.now();
  const ip = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || null;
  const authHeader = req.headers.authorization || '';
  const keyInfo = await resolveApiKey(authHeader);
  if (!keyInfo) {
    sendUpstreamStyleError(res, req, { status: 401, body: { error: { message: 'Invalid API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } } });
    return;
  }

  // 并发限制
  if (!rateLimiter.acquire(keyInfo.id)) {
    await touchKey(keyInfo.id);
    sendUpstreamStyleError(res, req, { status: 429, body: { error: { message: `Too many concurrent requests (limit reached).`, type: 'rate_limit_error' } } });
    return;
  }
  const releaseConcurrent = () => rateLimiter.release(keyInfo.id);

  try {
    await routeRequest(req, res, keyInfo, startedAt, ip);
    await touchKey(keyInfo.id).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    await writeFailedLog(req, keyInfo, startedAt, ip, 500, msg);
    if (!res.headersSent) {
      sendUpstreamStyleError(res, req, { status: 500, body: { error: { message: 'Internal gateway error', type: 'server_error' } } });
    } else {
      res.end();
    }
  } finally {
    // 无论成功/失败/提前 return，都释放并发额度，避免泄漏导致后续请求被永久拒绝
    releaseConcurrent();
  }
}

function sendUpstreamStyleError(res: Response, req: Request, opt: { status: number; body: unknown }): void {
  // 按端点风格返回错误体
  const isAnthropic = req.path.startsWith('/v1/messages') && req.baseUrl === '';
  if (isAnthropic && (opt.body as any)?.error) {
    res.status(opt.status).json({ type: 'error', error: { type: 'invalid_request_error', message: (opt.body as any).error.message } });
    return;
  }
  res.status(opt.status).json(opt.body);
}

async function routeRequest(req: Request, res: Response, key: ApiKeyWithUser, startedAt: number, ip: string | null): Promise<void> {
  // 模型白名单校验
  if (key.model_whitelist && key.model_whitelist.length) {
    const model = extractModel(req);
    if (model && !key.model_whitelist.includes(model)) {
      await writeFailedLog(req, key, startedAt, ip, 403, `model ${model} not allowed`);
      sendUpstreamStyleError(res, req, { status: 403, body: { error: { message: `Model "${model}" is not allowed for this API key`, type: 'permission_error' } } });
      return;
    }
  }

  // RPM/TPM 限额
  const body: any = typeof req.body === 'object' && req.body !== null ? req.body : {};
  const model = extractModel(req) || 'unknown';
  if (key.rpm_limit) {
    const ok = await rateLimiter.checkWindow(key.id, key.rpm_limit, 'minute', 0);
    if (!ok) { await writeFailedLog(req, key, startedAt, ip, 429, 'rpm exceeded'); sendUpstreamStyleError(res, req, { status: 429, body: { error: { message: 'You exceeded your current RPM limit', type: 'rate_limit_error' } } }); return; }
  }
  if (key.rps_limit) {
    const ok = await rateLimiter.checkWindow(key.id, key.rps_limit, 'second', 0);
    if (!ok) { await writeFailedLog(req, key, startedAt, ip, 429, 'rps exceeded'); sendUpstreamStyleError(res, req, { status: 429, body: { error: { message: 'You exceeded your current RPS limit', type: 'rate_limit_error' } } }); return; }
  }
  if (key.tpm_limit) {
    const usg = estimateUsageFromRequest(body);
    const ok = await rateLimiter.checkWindow(key.id, key.tpm_limit, 'minute', usg.promptTokens);
    if (!ok) { await writeFailedLog(req, key, startedAt, ip, 429, 'tpm exceeded'); sendUpstreamStyleError(res, req, { status: 429, body: { error: { message: 'You exceeded your current TPM limit', type: 'rate_limit_error' } } }); return; }
  }

  // 余额前置检查
  if (!Number.isFinite(key.user_balance) || key.user_balance < 0) {
    await writeFailedLog(req, key, startedAt, ip, 402, 'insufficient balance');
    sendUpstreamStyleError(res, req, { status: 402, body: { error: { message: 'Insufficient balance', type: 'insufficient_quota' } } });
    return;
  }

  // 选择上游账号：key 指定分组时优先取该分组；仅当显式开启 ALLOW_GLOBAL_ROUTING 时，分组无账号才回退全局（一 key 多模型）
  let accounts = await accountsByGroup(key.group_id);
  if (accounts.length === 0 && process.env.ALLOW_GLOBAL_ROUTING === 'true') {
    accounts = await accountsAllActive();
  }
  if (accounts.length === 0) {
    await writeFailedLog(req, key, startedAt, ip, 503, 'no available upstream account');
    sendUpstreamStyleError(res, req, { status: 503, body: { error: { message: 'No available upstream account for this group', type: 'server_error' } } });
    return;
  }

  // 简单负载均衡：优先高 priority；同优先级内轮转打散压力
  const target = resolveAccountTarget(sortAccountsForLoad(accounts)[0]);

  // 是否计费：根据 group/platform 判断；不计费账号跳过
  const enforceBilling = !isFreeTier(key);

  // 构造上游 URL 与外发请求
  const upstreamUrl = buildUpstreamUrl(req, target);
  if (!upstreamUrl) {
    await writeFailedLog(req, key, startedAt, ip, 400, 'unsupported endpoint');
    sendUpstreamStyleError(res, req, { status: 400, body: { error: { message: 'Unsupported endpoint or platform misconfiguration', type: 'invalid_request_error' } } });
    return;
  }

  const outHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': req.headers.accept || 'application/json',
    'Authorization': target.authHeader,
  };
  // 透传几种可选头（OpenAI 组织、Anthropic 版本、Codex 粘性）
  const pass = ['openai-organization', 'anthropic-version', 'anthropic-beta', 'session_id', 'user_agent_boundary', 'chatgpt-config'];
  for (const h of pass) {
    const v = req.headers[h];
    if (v !== undefined) outHeaders[h] = Array.isArray(v) ? v[0] : v;
  }
  if (req.headers['x-stainless-lang']) outHeaders['x-stainless-lang'] = String(req.headers['x-stainless-lang']);

  const isStream = body.stream === true;
  const proxiedBody = JSON.stringify(body);
  const priorUsage = estimateUsageFromRequest(body);

  let upstreamRes: Awaited<ReturnType<typeof fetch>>;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: outHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : proxiedBody,
      signal: AbortSignal.timeout(cfg.upstreamTimeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? (err.name === 'TimeoutError' ? 'upstream timeout' : `upstream error: ${err.message}`) : 'upstream error';
    await writeFailedLog(req, key, startedAt, ip, 502, msg, target.account.id);
    sendUpstreamStyleError(res, req, { status: 502, body: { error: { message: 'Upstream request failed', type: 'api_error' } } });
    return;
  }

  // 设置响应头
  res.status(upstreamRes.status);
  res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
  for (const h of ['x-request-id', 'openai-organization', 'openai-processing-ms', 'x-ratelimit-remaining-tokens', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-requests-tokens']) {
    const v = upstreamRes.headers.get(h);
    if (v) res.setHeader(h, v);
  }

  // 读取上游响应体
  const bodyText = await upstreamRes.text();

  // 解析 usage 并计费
  const isOk = upstreamRes.status >= 200 && upstreamRes.status < 300;
  let promptTokens = priorUsage.promptTokens;
  let completionTokens = 0;
  let cachedTokens = priorUsage.cachedTokens;
  let cacheWriteTokens = 0;

  if (isStream) {
    // 优先从 SSE 末尾 chunk 提取真实 usage（OpenAI stream_options / Anthropic message_delta）
    const streamUsage = extractStreamUsage(bodyText);
    if (streamUsage && (streamUsage.prompt > 0 || streamUsage.completion > 0)) {
      promptTokens = streamUsage.prompt;
      completionTokens = streamUsage.completion;
      cachedTokens = streamUsage.cached;
      cacheWriteTokens = streamUsage.cacheWrite;
    } else {
      // 提取不到才回退估算
      completionTokens = priorUsage.maxCompletionTokens ?? estimateTokens(stripStreamContent(bodyText));
    }
  } else if (isOk) {
    try {
      const parsed = JSON.parse(bodyText);
      const u = parseOpenAIUsage(parsed?.usage);
      if (u.prompt > 0 || u.completion > 0) {
        promptTokens = u.prompt;
        completionTokens = u.completion;
        cachedTokens = u.cached;
        cacheWriteTokens = u.cacheWrite;
      }
    } catch { /* 非 JSON */ }
  }

  // 计算并扣除费用（若启用计费）
  let cost = 0;
  if (enforceBilling && isOk) {
    const price = await priceService.resolvePrice(model);
    // 未配置价格的模型：默认拒绝（防白嫖），除非显式开启 ALLOW_UNPRICED 按 0 计费放行
    if (!price && process.env.ALLOW_UNPRICED !== 'true') {
      await writeFailedLog(req, key, startedAt, ip, 402, `model ${model} not priced`, target.account.id);
      sendUpstreamStyleError(res, req, { status: 402, body: { error: { message: `Model "${model}" is not configured (no price). Ask admin to set a price.`, type: 'invalid_request_error' } } });
      return;
    }
    if (price) {
      // 畸形 usage 防护：cached 不得超过 prompt，禁止出现负成本
      const safeCached = Math.max(0, Math.min(cachedTokens, promptTokens));
      // 分组倍率优先，未绑定分组则回退全局倍率
      const groupRate = key.group_rate_multiplier ?? (await getBillingMultiplier());
      cost = computeCost(price, promptTokens, completionTokens, safeCached, groupRate, new Date(), cacheWriteTokens);
      cost = Math.max(0, cost);
      // 向上游实际调用扣费（订阅额度优先，余额兜底）
      if (cost > 0) {
        try {
          await deductCharge(key.user_id, cost);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'billing failed';
          if (msg === 'INSUFFICIENT_QUOTA') {
            await writeFailedLog(req, key, startedAt, ip, 402, 'insufficient quota', target.account.id);
            sendUpstreamStyleError(res, req, { status: 402, body: { error: { message: 'Insufficient quota or balance', type: 'insufficient_quota' } } });
            return;
          }
          throw e;
        }
      }
    }
  }

  // 记录日志
  await insertLog({
    userId: key.user_id, apiKeyId: key.id, accountId: target.account.id, model,
    endpoint: req.path, platform: target.account.platform, stream: isStream,
    promptTokens, completionTokens, cachedTokens, cost,
    success: isOk, statusCode: upstreamRes.status, errorMessage: isOk ? null : (redactUpstreamError(bodyText) || 'upstream error'),
    latencyMs: Date.now() - startedAt, ip,
  });

  // 透传响应
  res.end(bodyText);
}

function isFreeTier(key: ApiKeyWithUser): boolean {
  // 预留：未来支持不计费账号/免费额度。当前所有请求按余额计费。
  return false;
}

/** 简单负载均衡：按 priority 降序排序；同优先级内用轮转游标把首选账号放到首位。 */
function sortAccountsForLoad(accs: AccountRuntime[]): AccountRuntime[] {
  const sorted = [...accs].sort((a, b) => b.priority - a.priority);
  const topPriority = sorted[0].priority;
  const tier = sorted.filter((a) => a.priority === topPriority);
  if (tier.length > 1) {
    const picked = tier[loadIndex++ % tier.length];
    return [picked, ...sorted.filter((a) => a.id !== picked.id).sort((a, b) => b.priority - a.priority)];
  }
  return sorted;
}
let loadIndex = 0;

function extractModel(req: Request): string | null {
  const body: any = req.body;
  if (typeof body?.model === 'string') return body.model;
  const m = req.path.match(/\/models\/([^/]+)/);
  return m ? m[1] : null;
}

function buildUpstreamUrl(req: Request, target: { baseUrl: string; account: { platform: string } }): string | null {
  const base = target.baseUrl;
  if (!base) return null;
  // 透传客户端请求的完整路径（保持 /v1 前缀，兼容各 SDK）
  const p = req.path.startsWith('/v1') ? req.path : `/v1${req.path}`;
  const q = (req as Request & { _parsedUrl?: { search?: string } })._parsedUrl?.search
    || (req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '');
  return q ? `${base}${p}?${q}` : `${base}${p}`;
}

/** 对落库的上游错误体做截断与脱敏，避免泄露密钥/令牌。 */
function redactUpstreamError(text: string): string {
  let out = text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9]{8,}\b/g, 'sk-[redacted]')
    .replace(/\bant-[A-Za-z0-9]{8,}\b/g, 'ant-[redacted]');
  if (out.length > 500) out = out.slice(0, 500);
  return out;
}

function stripStreamContent(sse: string): string {  // 从 SSE 的 data: JSON 块里拼 content（近似）
  let out = '';
  for (const line of sse.split('\n')) {
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const d = j?.choices?.[0]?.delta?.content;
        if (typeof d === 'string') out += d;
      } catch { /* 忽略非 JSON */ }
    }
  }
  return out;
}

/** 记录失败日志。 */
async function writeFailedLog(req: Request, key: ApiKeyWithUser, startedAt: number, ip: string | null, status: number, msg: string, accountId?: number) {
  const body: any = req.body || {};
  const model = typeof body?.model === 'string' ? body.model : null;
  const usg = estimateUsageFromRequest(body);
  return insertLog({
    userId: key.user_id, apiKeyId: key.id, accountId: accountId ?? null, model,
    endpoint: req.path, platform: 'unknown', stream: body?.stream === true,
    promptTokens: usg.promptTokens, completionTokens: 0, cachedTokens: 0, cost: 0,
    success: false, statusCode: status, errorMessage: msg, latencyMs: Date.now() - startedAt, ip,
  });
}

export { requestIdMiddleware };
function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.headers['x-request-id']) res.setHeader('x-request-id', randomUUID());
  next();
}

/**
 * 计费扣款：订阅额度优先，余额兜底。
 * 1) 若有 active 订阅且本期未到期 → 先扣 used_credit（可扣部分），再看余额。
 * 2) 若订阅已过期 → 视为无订阅，仅从余额扣。
 * 3) 两者都不足 → 抛 INSUFFICIENT_QUOTA。
 * 在单事务内完成，避免并发超扣。
 */
async function deductCharge(userId: number, cost: number): Promise<void> {
  const { tx } = await import('../db/pool.js');
  await tx(async (client) => {
    let remaining = cost;
    // 1) 优先扣订阅额度
    const sub = await client.query<{ id: number; used: string; monthly: string; expires: Date }>(
      `SELECT id, used_credit AS used, monthly_credit AS monthly, expires_at AS expires
         FROM user_subscriptions WHERE user_id = $1 AND status='active'
         ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`, [userId]
    );
    if (sub.rows[0]) {
      const s = sub.rows[0];
      // 到期 → 订阅失效（需重新购买），本次从余额扣
      if (new Date(s.expires).getTime() < Date.now()) {
        await client.query(`UPDATE user_subscriptions SET status='expired' WHERE id=$1`, [s.id]);
      } else {
        const avail = Math.max(0, Number(s.monthly) - Number(s.used));
        if (avail > 0 && remaining > 0) {
          const take = Math.min(avail, remaining);
          await client.query(`UPDATE user_subscriptions SET used_credit = used_credit + $2 WHERE id=$1`, [s.id, take]);
          remaining -= take;
        }
      }
    }
    // 2) 剩余从余额扣
    if (remaining > 0) {
      const upd = await client.query(
        `UPDATE users SET balance = balance - $2 WHERE id = $1 AND balance >= $2`, [userId, remaining]
      );
      if (!upd.rowCount) throw new Error('INSUFFICIENT_QUOTA');
    }
  });
}
