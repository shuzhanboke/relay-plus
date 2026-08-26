import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin, requirePerm } from './authMiddleware.js';
import { success, failure, failFrom } from './respond.js';
import { assertSafeBaseUrl } from '../services/accountService.js';
import { audit, actorFrom } from '../services/audit.js';

export const managerAdminRouter: Router = express.Router();

// ==================== 分组 ====================
managerAdminRouter.get('/admin/groups', requireAuth, requirePerm('group.manage'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT g.id, g.name, g.platform, g.description, g.created_at,
              g.rate_multiplier::float8 AS rate_multiplier,
              (SELECT COUNT(*) FROM account_groups ag WHERE ag.group_id = g.id) AS account_count,
              (SELECT COUNT(DISTINCT mp.model) FROM account_groups ag
                 JOIN accounts a ON a.id = ag.account_id
                 LEFT JOIN model_prices mp ON mp.provider = a.platform OR mp.provider = 'custom'
               WHERE ag.group_id = g.id) AS model_count
         FROM groups g ORDER BY g.created_at DESC`
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.post('/admin/groups', requireAuth, requirePerm('group.manage'), async (req, res) => {
  const schema = z.object({ name: z.string().min(1).max(64), platform: z.string().default('openai'), description: z.string().optional(), rate_multiplier: z.number().positive().default(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const result = await query(
      `INSERT INTO groups (name, platform, description, rate_multiplier) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name, platform) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, platform, description, rate_multiplier::float8 AS rate_multiplier, created_at`,
      [parsed.data.name, parsed.data.platform, parsed.data.description || null, parsed.data.rate_multiplier]
    );
    success(res, result.rows[0]);
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.patch('/admin/groups/:id', requireAuth, requirePerm('group.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ name: z.string().optional(), platform: z.string().optional(), description: z.string().nullish(), rate_multiplier: z.number().nonnegative().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (parsed.data.name !== undefined) { sets.push(`name = $${i++}`); params.push(parsed.data.name); }
  if (parsed.data.platform !== undefined) { sets.push(`platform = $${i++}`); params.push(parsed.data.platform); }
  if (parsed.data.description !== undefined) { sets.push(`description = $${i++}`); params.push(parsed.data.description); }
  if (parsed.data.rate_multiplier !== undefined) { sets.push(`rate_multiplier = $${i++}`); params.push(parsed.data.rate_multiplier); }
  if (!sets.length) return failure(res, 'Nothing to update', 400);
  params.push(id);
  try {
    const result = await query(`UPDATE groups SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (!result.rowCount) return failure(res, 'Group not found', 404);
    success(res, result.rows[0]);
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.delete('/admin/groups/:id', requireAuth, requirePerm('group.manage'), async (req, res) => {
  try {
    const result = await query('DELETE FROM groups WHERE id = $1 RETURNING id', [Number(req.params.id)]);
    if (!result.rowCount) return failure(res, 'Group not found', 404);
    success(res, { removed: true });
  } catch (err) { failFrom(res, err); }
});

// ==================== 代理 ====================
managerAdminRouter.get('/admin/proxies', requireAuth, requirePerm('proxy.manage'), async (req, res) => {
  try {
    const rows = await query('SELECT id, name, protocol, host, port, status, created_at FROM proxies ORDER BY created_at DESC');
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.post('/admin/proxies', requireAuth, requirePerm('proxy.manage'), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    protocol: z.enum(['http', 'https', 'socks5']).default('http'),
    host: z.string().min(1),
    port: z.number().int().positive(),
    username: z.string().optional(),
    password: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const result = await query(
      `INSERT INTO proxies (name, protocol, host, port, username, password, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id, name, protocol, host, port, status, created_at`,
      [parsed.data.name, parsed.data.protocol, parsed.data.host, parsed.data.port, parsed.data.username || null, parsed.data.password || null]
    );
    success(res, result.rows[0]);
  } catch (err) {
    if (err instanceof Error && (err as any).code === '23505') return failure(res, 'Proxy name already exists', 409);
    failFrom(res, err);
  }
});

managerAdminRouter.delete('/admin/proxies/:id', requireAuth, requirePerm('proxy.manage'), async (req, res) => {
  try {
    const result = await query('DELETE FROM proxies WHERE id = $1 RETURNING id', [Number(req.params.id)]);
    if (!result.rowCount) return failure(res, 'Proxy not found', 404);
    success(res, { removed: true });
  } catch (err) { failFrom(res, err); }
});

// ==================== 上游账号（渠道）====================
// 注意：POST /admin/accounts 兼容 FlowPilot createPayload
managerAdminRouter.get('/admin/accounts', requireAuth, requirePerm('account.manage'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT a.id, a.name, a.platform, a.type, a.base_url,
              (a.api_key IS NOT NULL) AS has_api_key,
              (a.credentials->>'email')::text AS email,
              a.proxy_id, p.name AS proxy_name, a.concurrency, a.priority, a.rate_multiplier,
              a.status, a.last_error, a.created_at,
              ARRAY(SELECT g.name FROM account_groups ag JOIN groups g ON g.id = ag.group_id WHERE ag.account_id = a.id) AS groups
         FROM accounts a LEFT JOIN proxies p ON p.id = a.proxy_id ORDER BY a.created_at DESC`
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// 账号健康探测：向上游发起真实请求，返回连通性/延迟/尽力获取额度
managerAdminRouter.post('/admin/accounts/:id/probe', requireAuth, requirePerm('account.manage'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await query<{ platform: string; type: string; base_url: string | null; api_key: string | null }>(
      `SELECT platform, type, base_url, api_key FROM accounts WHERE id = $1`, [id]
    );
    const acc = r.rows[0];
    if (!acc) return failure(res, 'Account not found', 404);
    if (!acc.api_key) return success(res, { ok: false, note: '该账号无明文上游 Key（OAuth/凭据型），无法直接探测，请通过实际调用验证' });

    const base = (acc.base_url || '');
    const openai = acc.platform === 'openai';
    // 连通性探针：OpenAI 用 /models，其它用最小 chat 或 /models
    const probeUrl = openai ? `${base}/models` : `${base}/models`;
    const started = Date.now();
    try {
      const pr = await fetch(probeUrl, { headers: { Authorization: `Bearer ${acc.api_key}` }, signal: AbortSignal.timeout(12000) });
      const latency = Date.now() - started;
      const ok = pr.status >= 200 && pr.status < 300;
      let balance: string | null = null;
      // OpenAI 尽力获取额度
      if (openai && ok) {
        try {
          const br = await fetch(`${base}/dashboard/billing/credit_grants`, { headers: { Authorization: `Bearer ${acc.api_key}` }, signal: AbortSignal.timeout(12000) });
          if (br.ok) { const bj: any = await br.json(); balance = (bj?.total_available != null ? `¥${Number(bj.total_available).toFixed(2)}` : null); }
        } catch { /* 余额获取失败忽略 */ }
      }
      return success(res, { ok, status: pr.status, latency_ms: latency, balance, error: ok ? null : (await pr.text()).slice(0, 200) });
    } catch (err) {
      return success(res, { ok: false, error: err instanceof Error ? err.message : '连接失败', latency_ms: Date.now() - started });
    }
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.post('/admin/accounts', requireAuth, requirePerm('account.manage'), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    platform: z.string().default('openai'),
    type: z.string().default('api_key'),
    base_url: z.string().optional(),
    api_key: z.string().optional(),
    credentials: z.record(z.string(), z.unknown()).default({}),
    extra: z.record(z.string(), z.unknown()).default({}),
    proxy_id: z.number().int().positive().nullish(),
    concurrency: z.number().int().nonnegative().default(4),
    priority: z.number().int().nonnegative().default(1),
    rate_multiplier: z.number().nonnegative().default(1),
    group_ids: z.array(z.number().int().positive()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const d = parsed.data;
  try {
    // SSRF 防护：校验上游地址不得指向内网/本机/保留地址
    assertSafeBaseUrl(d.base_url);
    const result = await query(
      `INSERT INTO accounts (name, platform, type, base_url, api_key, credentials, extra, proxy_id, concurrency, priority, rate_multiplier, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active') RETURNING id, name, platform, type`,
      [
        d.name, d.platform, d.type, d.base_url || null, d.api_key || null,
        JSON.stringify(d.credentials), JSON.stringify(d.extra),
        d.proxy_id ?? null, d.concurrency, d.priority, d.rate_multiplier,
      ]
    );
    const id = result.rows[0].id;
    if (d.group_ids && d.group_ids.length) {
      for (const gid of d.group_ids) {
        await query('INSERT INTO account_groups (account_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, gid]);
      }
    }
    success(res, { ...result.rows[0], group_ids: d.group_ids || [] });
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.patch('/admin/accounts/:id', requireAuth, requirePerm('account.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().optional(),
    platform: z.string().optional(),
    base_url: z.string().nullish(),
    api_key: z.string().nullish(),
    proxy_id: z.number().int().positive().nullish(),
    concurrency: z.number().int().nonnegative().optional(),
    priority: z.number().int().nonnegative().optional(),
    rate_multiplier: z.number().nonnegative().optional(),
    status: z.enum(['active', 'paused', 'disabled']).optional(),
    credentials: z.record(z.string(), z.unknown()).optional(),
    group_ids: z.array(z.number().int().positive()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const d = parsed.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.name !== undefined) { sets.push(`name = $${i++}`); params.push(d.name); }
  if (d.platform !== undefined) { sets.push(`platform = $${i++}`); params.push(d.platform); }
  if (d.base_url !== undefined) { assertSafeBaseUrl(d.base_url); sets.push(`base_url = $${i++}`); params.push(d.base_url || null); }
  if (d.api_key !== undefined) { sets.push(`api_key = $${i++}`); params.push(d.api_key || null); }
  if (d.proxy_id !== undefined) { sets.push(`proxy_id = $${i++}`); params.push(d.proxy_id || null); }
  if (d.concurrency !== undefined) { sets.push(`concurrency = $${i++}`); params.push(d.concurrency); }
  if (d.priority !== undefined) { sets.push(`priority = $${i++}`); params.push(d.priority); }
  if (d.rate_multiplier !== undefined) { sets.push(`rate_multiplier = $${i++}`); params.push(d.rate_multiplier); }
  if (d.status !== undefined) { sets.push(`status = $${i++}`); params.push(d.status); }
  if (d.credentials !== undefined) { sets.push(`credentials = $${i++}`); params.push(JSON.stringify(d.credentials)); }

  try {
    if (sets.length) {
      params.push(id);
      const result = await query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, params);
      if (!result.rowCount) return failure(res, 'Account not found', 404);
    }
    if (d.group_ids) {
      await query('DELETE FROM account_groups WHERE account_id = $1', [id]);
      for (const gid of d.group_ids) {
        await query('INSERT INTO account_groups (account_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, gid]);
      }
    }
    await audit({ ...actorFrom(req), action: 'update_account', targetType: 'account', targetId: id, detail: { changed: Object.keys(d) }, ip: actorFrom(req).ip });
    success(res, { id });
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.delete('/admin/accounts/:id', requireAuth, requirePerm('account.manage'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM accounts WHERE id = $1', [id]);
    await audit({ ...actorFrom(req), action: 'delete_account', targetType: 'account', targetId: id, detail: {}, ip: actorFrom(req).ip });
    success(res, { removed: true });
  } catch (err) { failFrom(res, err); }
});

// ==================== 系统设置 ====================
managerAdminRouter.get('/admin/settings', requireAuth, requirePerm('setting.manage'), async (req, res) => {
  try {
    const rows = await query('SELECT key, value FROM settings');
    const obj: Record<string, unknown> = {};
    for (const r of rows.rows) obj[r.key] = r.value;
    success(res, obj);
  } catch (err) { failFrom(res, err); }
});

managerAdminRouter.post('/admin/settings', requireAuth, requirePerm('setting.manage'), async (req, res) => {
  const schema = z.object({ key: z.string().min(1), value: z.unknown() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [parsed.data.key, JSON.stringify(parsed.data.value)]
    );
    success(res, { key: parsed.data.key });
  } catch (err) { failFrom(res, err); }
});
