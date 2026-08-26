import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requirePerm } from './authMiddleware.js';
import { listAudit } from '../services/audit.js';
import { success, failure, failFrom } from './respond.js';
import { dashboardStats, hourlySeries } from '../services/logService.js';

export const miscAdminRouter: Router = express.Router();

// ==================== 用户侧：我的调用日志 ====================
// 登录用户只可查看自己的请求日志
miscAdminRouter.get('/billing/me/logs', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  try {
    const rows = await query(
      `SELECT id, model, endpoint, platform, stream, prompt_tokens, completion_tokens, cached_tokens,
              cost::float8 AS cost, success, status_code, error_message, latency_ms, created_at
         FROM request_logs WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2`, [req.user!.id, limit]
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// 登录用户：只看自己在中转站的用量（cost 已是站内综合价，天然只含本人）
miscAdminRouter.get('/billing/me/usage', requireAuth, async (req, res) => {
  const days = Math.max(1, Math.min(Number(req.query.days) || 7, 90));
  const uid = req.user!.id;
  try {
    const since = `now() - make_interval(days => $2::int)`;
    const byModel = await query(
      `SELECT model, COUNT(*)::int AS requests, SUM(cost)::float8 AS cost,
              SUM(prompt_tokens)::bigint AS prompt_tokens, SUM(completion_tokens)::bigint AS completion_tokens
         FROM request_logs WHERE user_id = $1 AND created_at >= ${since}
        GROUP BY model ORDER BY cost DESC NULLS LAST LIMIT 50`,
      [uid, days]
    );
    const series = await query(
      `SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS day,
              COUNT(*)::int AS requests, SUM(cost)::float8 AS cost,
              SUM(prompt_tokens + completion_tokens)::bigint AS tokens
         FROM request_logs WHERE user_id = $1 AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
      [uid, days]
    );
    const totals = await query(
      `SELECT COUNT(*)::int AS requests,
              COUNT(*) FILTER (WHERE success)::int AS success_requests,
              SUM(prompt_tokens)::bigint AS prompt_tokens,
              SUM(completion_tokens)::bigint AS completion_tokens,
              SUM(cost)::float8 AS cost
         FROM request_logs WHERE user_id = $1 AND created_at >= ${since}`,
      [uid, days]
    );
    const t = totals.rows[0] || {};
    success(res, {
      days,
      totals: {
        requests: Number(t.requests) || 0,
        successRequests: Number(t.success_requests) || 0,
        promptTokens: Number(t.prompt_tokens) || 0,
        completionTokens: Number(t.completion_tokens) || 0,
        cost: Number(t.cost) || 0,
      },
      byModel: byModel.rows.map((r) => ({ ...r, requests: Number(r.requests), cost: Number(r.cost) })),
      series: series.rows.map((r) => ({ ...r, requests: Number(r.requests), cost: Number(r.cost), tokens: Number(r.tokens) })),
    });
  } catch (err) { failFrom(res, err); }
});
// 免登录返回客服配置（供登录页/页脚展示微信/QQ/邮箱等联系入口）
miscAdminRouter.get('/public/support', async (_req, res) => {
  try {
    const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'support_%' OR key = 'system_name'");
    const out: Record<string, unknown> = {};
    for (const r of rows.rows) {
      const v = r.value;
      out[r.key] = typeof v === 'string' ? v : (v && v.value !== undefined ? (v as any).value : v);
    }
    success(res, out);
  } catch (err) { failFrom(res, err); }
});

// ==================== 模型价格 ====================
miscAdminRouter.get('/admin/model-prices', requireAuth, requirePerm('price.manage'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, model, provider, input_price::float8 AS input_price, output_price::float8 AS output_price,
              cache_read_price::float8 AS cache_read_price, cache_write_price::float8 AS cache_write_price,
              official_input_price::float8 AS official_input_price, official_output_price::float8 AS official_output_price,
              context_window, updated_at
         FROM model_prices ORDER BY provider, model`
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

miscAdminRouter.post('/admin/model-prices', requireAuth, requirePerm('price.manage'), async (req, res) => {
  const schema = z.object({
    model: z.string().min(1),
    provider: z.string().default('openai'),
    input_price: z.number().nonnegative().default(0),
    output_price: z.number().nonnegative().default(0),
    cache_read_price: z.number().nonnegative().default(0),
    cache_write_price: z.number().nonnegative().default(0),
    official_input_price: z.number().nonnegative().nullish(),
    official_output_price: z.number().nonnegative().nullish(),
    context_window: z.number().int().positive().nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const result = await query(
      `INSERT INTO model_prices (model, provider, input_price, output_price, cache_read_price, cache_write_price,
                                 official_input_price, official_output_price, context_window, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (model) DO UPDATE SET
         provider = EXCLUDED.provider,
         input_price = EXCLUDED.input_price, output_price = EXCLUDED.output_price,
         cache_read_price = EXCLUDED.cache_read_price, cache_write_price = EXCLUDED.cache_write_price,
         official_input_price = EXCLUDED.official_input_price, official_output_price = EXCLUDED.official_output_price,
         context_window = EXCLUDED.context_window,
         updated_at = now()
       RETURNING id, model`,
      [parsed.data.model, parsed.data.provider, parsed.data.input_price, parsed.data.output_price,
       parsed.data.cache_read_price, parsed.data.cache_write_price,
       parsed.data.official_input_price ?? null, parsed.data.official_output_price ?? null,
       parsed.data.context_window ?? null]
    );
    success(res, result.rows[0]);
  } catch (err) { failFrom(res, err); }
});

miscAdminRouter.delete('/admin/model-prices/:id', requireAuth, requirePerm('price.manage'), async (req, res) => {
  try {
    const result = await query('DELETE FROM model_prices WHERE id = $1 RETURNING id', [Number(req.params.id)]);
    if (!result.rowCount) return failure(res, 'Price not found', 404);
    success(res, { removed: true });
  } catch (err) { failFrom(res, err); }
});

// ==================== 请求日志 ====================
miscAdminRouter.get('/admin/logs', requireAuth, requirePerm('log.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const userId = req.query.user_id ? Number(req.query.user_id) : null;
  const model = typeof req.query.model === 'string' ? req.query.model : null;
  const tz = req.query.limit_timezone ? String(req.query.limit_timezone) : '24h'; // 支持 24h | 7d | all
  try {
    let where = '';
    const params: unknown[] = [];
    if (userId) { params.push(userId); where += ` WHERE l.user_id = $${params.length}`; }
    if (model) { params.push(model); where += where ? ' AND' : ' WHERE'; where += ` l.model = $${params.length}`; }
    let timeCond = '';
    if (tz !== 'all') {
      const hours = tz === '7d' ? 168 : tz === '24h' ? 24 : Number(tz) || 24;
      params.push(hours); timeCond = where ? ' AND' : ' WHERE';
    }
    const resRow = await query(
      `SELECT l.id, l.user_id, u.email AS user_email, l.api_key_id, l.account_id, l.model, l.endpoint,
              l.platform, l.stream, l.prompt_tokens, l.completion_tokens, l.cached_tokens, l.cost::float8 AS cost,
              l.success, l.status_code, l.error_message, l.latency_ms, l.ip, l.created_at
         FROM request_logs l
         LEFT JOIN users u ON u.id = l.user_id
         ${where}${timeCond ? `${timeCond} l.created_at > now() - ($${params.length} || ' hours')::interval` : ''}
         ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    success(res, resRow.rows);
  } catch (err) { failFrom(res, err); }
});

miscAdminRouter.get('/admin/logs/stats', requireAuth, requirePerm('log.view'), async (req, res) => {
  try {
    const stats = await dashboardStats();
    const hour = await hourlySeries();
    // 按模型汇总
    const byModel = await query(
      `SELECT model, COUNT(*)::text AS requests, SUM(cost)::float8 AS cost,
              SUM(prompt_tokens)::bigint AS prompt_tokens, SUM(completion_tokens)::bigint AS completion_tokens
         FROM request_logs GROUP BY model ORDER BY cost DESC NULLS LAST LIMIT 20`
    );
    success(res, { stats, hourly: hour, byModel: byModel.rows.map((r) => ({ ...r, requests: Number(r.requests), cost: Number(r.cost) })) });
  } catch (err) { failFrom(res, err); }
});

// 用量管理：按用户 / 模型 / 天聚合平台用量（总览 + 排行 + 趋势）
miscAdminRouter.get('/admin/usage', requireAuth, requirePerm('log.view'), async (req, res) => {
  const days = Math.max(1, Math.min(Number(req.query.days) || 7, 90));
  try {
    const since = `now() - make_interval(days => $1::int)`;
    const byUser = await query(
      `SELECT u.email, u.username,
              COUNT(r.id)::int AS requests,
              SUM(r.prompt_tokens)::bigint AS prompt_tokens,
              SUM(r.completion_tokens)::bigint AS completion_tokens,
              SUM(r.cost)::float8 AS cost
         FROM request_logs r JOIN users u ON u.id = r.user_id
        WHERE r.created_at >= ${since}
        GROUP BY u.id, u.email, u.username
        ORDER BY cost DESC NULLS LAST, COUNT(r.id) DESC
        LIMIT 50`,
      [days]
    );
    const byModel = await query(
      `SELECT model, COUNT(*)::int AS requests, SUM(cost)::float8 AS cost,
              SUM(prompt_tokens)::bigint AS prompt_tokens, SUM(completion_tokens)::bigint AS completion_tokens
         FROM request_logs WHERE created_at >= ${since}
        GROUP BY model ORDER BY cost DESC NULLS LAST LIMIT 20`,
      [days]
    );
    const series = await query(
      `SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS day,
              COUNT(*)::int AS requests, SUM(cost)::float8 AS cost,
              SUM(prompt_tokens + completion_tokens)::bigint AS tokens
         FROM request_logs WHERE created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
      [days]
    );
    const totals = await query(
      `SELECT COUNT(*)::int AS requests,
              SUM(prompt_tokens)::bigint AS prompt_tokens,
              SUM(completion_tokens)::bigint AS completion_tokens,
              SUM(cost)::float8 AS cost
         FROM request_logs WHERE created_at >= ${since}`,
      [days]
    );
    const t = totals.rows[0] || {};
    success(res, {
      days,
      totals: {
        requests: Number(t.requests) || 0,
        prompt_tokens: Number(t.prompt_tokens) || 0,
        completion_tokens: Number(t.completion_tokens) || 0,
        tokens: (Number(t.prompt_tokens) || 0) + (Number(t.completion_tokens) || 0),
        cost: Number(t.cost) || 0,
      },
      byUser: byUser.rows.map((r) => ({ ...r, requests: Number(r.requests), cost: Number(r.cost) })),
      byModel: byModel.rows.map((r) => ({ ...r, requests: Number(r.requests), cost: Number(r.cost) })),
      series: series.rows,
    });
  } catch (err) { failFrom(res, err); }
});

// 渠道（上游账号）健康状态监控：状态 + 近1h/24h 成功率、延迟、用量、消耗
miscAdminRouter.get('/admin/channel-health', requireAuth, requirePerm('channel.health'), async (_req, res) => {
  try {
    const rows = await query(
      `SELECT a.id, a.name, a.platform, a.type, a.base_url, a.status, a.last_error, a.created_at,
              COALESCE(p.name, '') AS proxy_name,
              COALESCE(g.names, '') AS group_names,
              COALESCE(h1.req, 0)::int AS req_1h, COALESCE(h1.ok, 0)::int AS ok_1h,
              COALESCE(h24.req, 0)::int AS req_24h, COALESCE(h24.ok, 0)::int AS ok_24h,
              COALESCE(h24.avg_latency, 0)::int AS avg_latency_24h,
              COALESCE(h24.tokens, 0)::bigint AS tokens_24h,
              COALESCE(h24.cost, 0)::float8 AS cost_24h,
              COALESCE(h24.last_at, a.created_at) AS last_used_at
         FROM accounts a
         LEFT JOIN proxies p ON p.id = a.proxy_id
         LEFT JOIN (
           SELECT ag.account_id, string_agg(g.name, ', ' ORDER BY g.name) AS names
             FROM account_groups ag JOIN groups g ON g.id = ag.group_id
            GROUP BY ag.account_id
         ) g ON g.account_id = a.id
         LEFT JOIN (
           SELECT account_id, COUNT(*) AS req, COUNT(*) FILTER (WHERE success) AS ok
             FROM request_logs WHERE created_at > now() - interval '1 hour'
            GROUP BY account_id
         ) h1 ON h1.account_id = a.id
         LEFT JOIN (
           SELECT account_id, COUNT(*) AS req, COUNT(*) FILTER (WHERE success) AS ok,
                  AVG(latency_ms)::int AS avg_latency,
                  SUM(prompt_tokens + completion_tokens + cached_tokens)::bigint AS tokens,
                  SUM(cost)::float8 AS cost, MAX(created_at) AS last_at
             FROM request_logs WHERE created_at > now() - interval '24 hours'
            GROUP BY account_id
         ) h24 ON h24.account_id = a.id
        ORDER BY a.id`
    );
    const health = rows.rows.map((r: any) => {
      let level = 'healthy';
      const req24 = Number(r.req_24h) || 0;
      const ok24 = Number(r.ok_24h) || 0;
      if (r.status === 'disabled') level = 'off';
      else if (r.status === 'paused') level = 'paused';
      else if (req24 >= 10 && ok24 / req24 < 0.9) level = 'degraded';
      else if (req24 === 0 && r.last_error) level = 'idle_error';
      else if (req24 === 0) level = 'idle';
      return {
        ...r,
        cost_24h: Number(r.cost_24h || 0),
        tokens_24h: Number(r.tokens_24h || 0),
        success_rate_24h: req24 > 0 ? Math.round((ok24 / req24) * 1000) / 10 : null,
        health: level,
      };
    });
    const total = health.length;
    const off = health.filter((h: any) => h.health === 'off' || h.health === 'paused').length;
    const degraded = health.filter((h: any) => h.health === 'degraded' || h.health === 'idle_error').length;
    const healthy = health.filter((h: any) => h.health === 'healthy').length;
    const sumReq24 = health.reduce((s: number, h: any) => s + (Number(h.req_24h) || 0), 0);
    const sumOk24 = health.reduce((s: number, h: any) => s + (Number(h.ok_24h) || 0), 0);
    const sumCost24 = health.reduce((s: number, h: any) => s + (Number(h.cost_24h) || 0), 0);
    const sumTokens24 = health.reduce((s: number, h: any) => s + (Number(h.tokens_24h) || 0), 0);
    success(res, {
      summary: {
        total, healthy, degraded, off,
        req_24h: sumReq24,
        success_rate_24h: sumReq24 > 0 ? Math.round((sumOk24 / sumReq24) * 1000) / 10 : null,
        cost_24h: Math.round(sumCost24 * 1000000) / 1000000,
        tokens_24h: sumTokens24,
      },
      channels: health,
    });
  } catch (err) { failFrom(res, err); }
});

// 操作审计日志查看（管理员）
miscAdminRouter.get('/admin/audit', requireAuth, requirePerm('audit.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const actorId = req.query.actor_id ? Number(req.query.actor_id) : undefined;
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  try {
    const rows = await listAudit(limit, actorId, action);
    success(res, rows);
  } catch (err) { failFrom(res, err); }
});
