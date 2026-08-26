import { query } from '../db/pool.js';

/**
 * SSRF 防护：校验上游 Base URL 只允许 https/http，且不得指向私网/回环/保留网段/元数据地址。
 * 未配置（null）视为使用平台内置默认上游，放行。
 * 开发/测试模式：当 ALLOW_LOOPBACK_UPSTREAM=true 时放行回环与本机地址（用于指向本机 mock/代理，切勿在生产开启）。
 */
export function assertSafeBaseUrl(baseUrl: string | null | undefined): void {
  if (!baseUrl) return;
  if (process.env.ALLOW_LOOPBACK_UPSTREAM === 'true') {
    // 放行回环，但仍校验协议与其余非私网? —— 开发模式下仅放行回环/本机，其余仍走完整校验
    try {
      const u0 = new URL(baseUrl);
      const h0 = u0.hostname.toLowerCase();
      if (h0 === 'localhost' || h0 === '127.0.0.1' || h0 === '::1') return;
      // eslint-disable-next-line no-empty
    } catch {
      /* 交给下方正常校验报错 */
    }
  }
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw Object.assign(new Error('base_url 不是合法 URL'), { status: 400, code: 'INVALID_BASE_URL' });
  }
  const protocol = u.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw Object.assign(new Error('base_url 仅允许 http/https'), { status: 400, code: 'INVALID_BASE_URL_PROTOCOL' });
  }
  const host = u.hostname.toLowerCase();
  if (isBlockedHost(host)) {
    throw Object.assign(new Error('base_url 不允许指向内网/本机/保留地址'), { status: 400, code: 'SSRF_BLOCKED_HOST' });
  }
}

function isBlockedHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true;
  // 明文 IPv4
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const ints = v4.slice(1).map(Number);
    const [a, b] = ints;
    // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16-31/12, 192.168/16
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224 && a <= 255) return true; // 组播/保留/广播
    return false;
  }
  // 十六进制/八进制 IPv4 变形（如 2130706433）做基本防御
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (Number.isFinite(n) && n >= 0 && n <= 4294967295) return true;
  }
  // IPv6 简写常见回环
  if (host.startsWith('0:') || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}

/** 上游账号（渠道）运行时视图。 */
export interface AccountRuntime {
  id: number;
  name: string;
  platform: string;      // openai | anthropic | custom
  type: string;          // api_key | oauth | codex_pat
  base_url: string | null;
  api_key: string | null;
  credentials: Record<string, unknown>;
  proxy_id: number | null;
  concurrency: number;
  priority: number;
  rate_multiplier: number;
  group_id: number | null;
}

/** 环境里用于构造 Authorization 的上游凭据结构。 */
export interface ResolvedAccount {
  account: AccountRuntime;
  authHeader: string;          // 如 "Bearer xxx"
  baseUrl: string;             // 上游 base，不含 trailing slash
  displayKey: string;          // 展示用的 key 片段
}

/** 获取给定 group 下所有激活账号，附带 group_id。 */
export async function accountsByGroup(groupId: number | null): Promise<AccountRuntime[]> {
  // 语义：
  //  - 指定分组：只返回【明确绑定】该分组的账号（不含未绑组的）
  //  - 未指定分组：只返回【未绑定任何分组】的账号
  let sql = `
    SELECT a.id, a.name, a.platform, a.type, a.base_url, a.api_key, a.credentials,
           a.proxy_id, a.concurrency, a.priority, a.rate_multiplier, ag.group_id
      FROM accounts a
      LEFT JOIN account_groups ag ON ag.account_id = a.id
     WHERE a.status = 'active'
  `;
  const params: unknown[] = [];
  if (groupId !== null) {
    sql += ` AND a.id IN (SELECT account_id FROM account_groups WHERE group_id = $1)`;
    params.push(groupId);
  } else {
    sql += ` AND NOT EXISTS (SELECT 1 FROM account_groups x WHERE x.account_id = a.id)`;
  }
  const res = await query<AccountRuntime>(sql + ` ORDER BY a.priority DESC, a.id ASC`, params);
  return res.rows.map((r) => ({ ...r, credentials: typeof r.credentials === 'object' ? r.credentials : {} }));
}

/** 所有激活状态的账号（不限分组），用于「一 key 多模型」的全局路由回退。 */
export async function accountsAllActive(): Promise<AccountRuntime[]> {
  const res = await query<AccountRuntime>(
    `SELECT a.id, a.name, a.platform, a.type, a.base_url, a.api_key, a.credentials,
            a.proxy_id, a.concurrency, a.priority, a.rate_multiplier, NULL::bigint AS group_id
       FROM accounts a WHERE a.status = 'active' ORDER BY a.priority DESC, a.id ASC`
  );
  return res.rows.map((r) => ({ ...r, credentials: typeof r.credentials === 'object' ? r.credentials : {} }));
}

/** 根据账号构造可用的上游请求目标。 */
export function resolveAccountTarget(acc: AccountRuntime): ResolvedAccount {
  let baseUrl = '';
  let authHeader = '';
  switch (acc.platform) {
    case 'openai':
      baseUrl = acc.base_url || 'https://api.openai.com';
      authHeader = buildAuth(acc);
      break;
    case 'anthropic':
      baseUrl = acc.base_url || 'https://api.anthropic.com';
      authHeader = buildAuth(acc);
      break;
    case 'gemini':
      // Gemini 有 OpenAI 兼容端点（/v1beta/openai），也可走原生生成端点；默认走 OpenAI 兼容
      baseUrl = acc.base_url || 'https://generativelanguage.googleapis.com/v1beta/openai';
      authHeader = buildAuth(acc);
      break;
    case 'deepseek':
      baseUrl = acc.base_url || 'https://api.deepseek.com';
      authHeader = buildAuth(acc);
      break;
    case 'xai':        // Grok
      baseUrl = acc.base_url || 'https://api.x.ai';
      authHeader = buildAuth(acc);
      break;
    case 'mistral':
      baseUrl = acc.base_url || 'https://api.mistral.ai';
      authHeader = buildAuth(acc);
      break;
    case 'meta':       // llama
      baseUrl = acc.base_url || 'https://api.together.xyz';
      authHeader = buildAuth(acc);
      break;
    case 'qwen':
      baseUrl = acc.base_url || 'https://dashscope.aliyuncs.com/compatible-mode';
      authHeader = buildAuth(acc);
      break;
    case 'kimi':
      baseUrl = acc.base_url || 'https://api.moonshot.cn';
      authHeader = buildAuth(acc);
      break;
    case 'zhipu':
      baseUrl = acc.base_url || 'https://open.bigmodel.cn/api/paas/v4';
      authHeader = buildAuth(acc);
      break;
    case 'minimax':
      baseUrl = acc.base_url || 'https://api.minimax.chat';
      authHeader = buildAuth(acc);
      break;
    default:
      baseUrl = acc.base_url || '';
      authHeader = buildAuth(acc);
  }
  const cred = acc.credentials as Record<string, unknown>;
  const displayKey = acc.api_key
    ? maskKey(acc.api_key)
    : cred?.access_token ? maskKey(String(cred.access_token)) : '(oauth)';
  return { account: acc, authHeader, baseUrl: baseUrl.replace(/\/+$/, ''), displayKey };
}

function buildAuth(acc: AccountRuntime): string {
  if (acc.api_key) return `Bearer ${acc.api_key}`;
  const cred = acc.credentials as Record<string, unknown>;
  if (acc.platform === 'anthropic') return acc.api_key ? `Bearer ${acc.api_key}` : (cred?.access_token ? `Bearer ${cred.access_token}` : '');
  return cred?.access_token ? `Bearer ${cred.access_token}` : '';
}

function maskKey(k: string): string {
  if (k.length <= 8) return '****';
  return k.slice(0, 4) + '****' + k.slice(-4);
}
