import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requirePerm } from './authMiddleware.js';
import { success, failure, failFrom } from './respond.js';
import { createApiKey, revealKeyFull } from '../services/apiKey.js';

export const apiKeyRouter: Router = express.Router();

/** 把 zod 校验错误转成可读提示（指出具体字段），便于排障。 */
function zodErrorMsg(parsed: { success: boolean; error?: z.ZodError }): string {
  if (parsed.success) return '';
  const first = parsed.error?.issues?.[0];
  if (!first) return 'Invalid payload';
  const field = first.path.join('.') || '(body)';
  const expect = mapZodCode(first.code);
  return `Invalid payload: ${field} ${expect}`;
}

function mapZodCode(code: string): string {
  const map: Record<string, string> = {
    invalid_type: '类型不正确（如字段类型/必填字段缺失）',
    invalid_string: '格式不正确',
    too_small: '值过小/缺失',
    too_big: '值过大',
    invalid_enum_value: '取值不在允许范围内',
  };
  return map[code] || '不符合格式';
}

const upsertSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  model_whitelist: z.array(z.string()).optional(),
  group_id: z.number().int().nonnegative().nullish(),
  rps_limit: z.number().int().nonnegative().max(1000000).nullish(),
  rpm_limit: z.number().int().nonnegative().max(1000000).nullish(),
  tpm_limit: z.number().int().nonnegative().max(1000000000).nullish(),
  expires_at: z.string().datetime().nullish(),
});

// ---- 当前用户：我的 Key 列表 ----
apiKeyRouter.get('/me/api-keys', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT k.id, k.user_id, k.name, k.key_prefix, k.key_tail, k.model_whitelist, k.group_id,
              k.rps_limit, k.rpm_limit, k.tpm_limit, k.expires_at, k.status, k.created_at, k.last_used_at,
              g.name AS group_name
         FROM api_keys k LEFT JOIN groups g ON g.id = k.group_id
        WHERE k.user_id = $1 ORDER BY k.created_at DESC`,
      [req.user!.id]
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// ---- 当前用户：创建 Key（可设分组/限额，真实生效）----
apiKeyRouter.post('/me/api-keys', requireAuth, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const d = parsed.data;
  try {
    const { full } = await createApiKey({
      userId: req.user!.id,
      name: d.name,
      modelWhitelist: d.model_whitelist,
      groupId: d.group_id ?? null,
      rpsLimit: d.rps_limit ?? null,
      rpmLimit: d.rpm_limit ?? null,
      tpmLimit: d.tpm_limit ?? null,
      expiresAt: d.expires_at ? new Date(d.expires_at) : null,
    });
    success(res, { api_key: full, name: d.name || 'default' });
  } catch (err) { failFrom(res, err); }
});

// ---- 当前用户：编辑 Key（名称/分组/限额/过期，真实生效）----
apiKeyRouter.patch('/me/api-keys/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().min(1).max(64).optional(),
    group_id: z.number().int().nonnegative().nullish(),
    model_whitelist: z.array(z.string()).optional(),
    rps_limit: z.number().int().nonnegative().max(1000000).nullish(),
    rpm_limit: z.number().int().nonnegative().max(1000000).nullish(),
    tpm_limit: z.number().int().nonnegative().max(1000000000).nullish(),
    expires_at: z.string().datetime().nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const d = parsed.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.name !== undefined) { sets.push(`name = $${i++}`); params.push(d.name); }
  if (d.group_id !== undefined) { sets.push(`group_id = $${i++}`); params.push(d.group_id || null); }
  if (d.model_whitelist !== undefined) { sets.push(`model_whitelist = $${i++}`); params.push(d.model_whitelist); }
  if (d.rps_limit !== undefined) { sets.push(`rps_limit = $${i++}`); params.push(d.rps_limit); }
  if (d.rpm_limit !== undefined) { sets.push(`rpm_limit = $${i++}`); params.push(d.rpm_limit); }
  if (d.tpm_limit !== undefined) { sets.push(`tpm_limit = $${i++}`); params.push(d.tpm_limit); }
  if (d.expires_at !== undefined) { sets.push(`expires_at = $${i++}`); params.push(d.expires_at ? new Date(d.expires_at) : null); }
  if (sets.length === 0) return failure(res, 'Nothing to update', 400);
  params.push(id, req.user!.id);
  try {
    const result = await query(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = $${i} AND user_id = $${i + 1} RETURNING id`, params);
    if (!result.rowCount) return failure(res, 'Key not found', 404);
    success(res, { id });
  } catch (err) { failFrom(res, err); }
});

// ---- 当前用户：查看完整 Key（解密，用于自选 Key 自动填充/复制）----
apiKeyRouter.get('/me/api-keys/:id/reveal', requireAuth, async (req, res) => {
  try {
    const full = await revealKeyFull(Number(req.params.id), req.user!.id);
    if (!full) return failure(res, 'Key not found or no plaintext', 404);
    success(res, { api_key: full });
  } catch (err) { failFrom(res, err); }
});

// ---- 当前用户：撤销 Key ----
apiKeyRouter.delete('/me/api-keys/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await query('DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user!.id]);
    if (!result.rowCount) return failure(res, 'Key not found', 404);
    success(res, { id, removed: true });
  } catch (err) { failFrom(res, err); }
});

// ---- 管理员：查任意用户 Key ----
apiKeyRouter.get('/admin/api-keys', requireAuth, requirePerm('apikey.manage'), async (req, res) => {
  const uid = req.query.user_id ? Number(req.query.user_id) : null;
  try {
    const rows = await query(
      `SELECT k.id, k.user_id, u.email AS user_email, k.name, k.key_prefix, k.key_tail, k.model_whitelist, k.group_id,
              g.name AS group_name, k.rps_limit, k.rpm_limit, k.tpm_limit, k.expires_at, k.status, k.created_at, k.last_used_at
         FROM api_keys k
         JOIN users u ON u.id = k.user_id
         LEFT JOIN groups g ON g.id = k.group_id
        ${uid ? 'WHERE k.user_id = $1' : ''} ORDER BY k.created_at DESC`,
      uid ? [uid] : []
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// ---- 管理员：为指定用户造 Key ----
apiKeyRouter.post('/admin/api-keys', requireAuth, requirePerm('apikey.manage'), async (req, res) => {
  const schema = z.object({
    user_id: z.number().int().positive(),
    name: z.string().optional(),
    model_whitelist: z.array(z.string()).optional(),
    group_id: z.number().int().nonnegative().nullish(),
    rps_limit: z.number().int().nonnegative().nullish(),
    rpm_limit: z.number().int().nonnegative().nullish(),
    tpm_limit: z.number().int().nonnegative().nullish(),
    expires_at: z.string().datetime().nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, zodErrorMsg(parsed), 400);
  const d = parsed.data;
  try {
    const user = await query('SELECT id FROM users WHERE id = $1', [d.user_id]);
    if (!user.rowCount) return failure(res, 'User not found', 404);
    const { full } = await createApiKey({
      userId: d.user_id, name: d.name,
      modelWhitelist: d.model_whitelist, groupId: d.group_id ?? null,
      rpsLimit: d.rps_limit ?? null, rpmLimit: d.rpm_limit ?? null, tpmLimit: d.tpm_limit ?? null,
      expiresAt: d.expires_at ? new Date(d.expires_at) : null,
    });
    success(res, { user_id: d.user_id, api_key: full });
  } catch (err) { failFrom(res, err); }
});

// ---- 管理员：启停/删除 Key ----
apiKeyRouter.patch('/admin/api-keys/:id', requireAuth, requirePerm('apikey.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    status: z.enum(['active', 'disabled', 'expired']).optional(),
    rps_limit: z.number().int().nonnegative().nullish(),
    rpm_limit: z.number().int().nonnegative().nullish(),
    tpm_limit: z.number().int().nonnegative().nullish(),
    group_id: z.number().int().nonnegative().nullish(),
    expires_at: z.string().datetime().nullish(),
    name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const d = parsed.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (d.status !== undefined) { sets.push(`status = $${i++}`); params.push(d.status); }
  if (d.rps_limit !== undefined) { sets.push(`rps_limit = $${i++}`); params.push(d.rps_limit); }
  if (d.rpm_limit !== undefined) { sets.push(`rpm_limit = $${i++}`); params.push(d.rpm_limit); }
  if (d.tpm_limit !== undefined) { sets.push(`tpm_limit = $${i++}`); params.push(d.tpm_limit); }
  if (d.group_id !== undefined) { sets.push(`group_id = $${i++}`); params.push(d.group_id || null); }
  if (d.expires_at !== undefined) { sets.push(`expires_at = $${i++}`); params.push(d.expires_at ? new Date(d.expires_at) : null); }
  if (d.name !== undefined) { sets.push(`name = $${i++}`); params.push(d.name); }
  if (sets.length === 0) return failure(res, 'Nothing to update', 400);
  params.push(id);
  try {
    const result = await query(`UPDATE api_keys SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, params);
    if (!result.rowCount) return failure(res, 'Key not found', 404);
    success(res, { id });
  } catch (err) { failFrom(res, err); }
});

apiKeyRouter.delete('/admin/api-keys/:id', requireAuth, requirePerm('apikey.manage'), async (req, res) => {
  try {
    const result = await query('DELETE FROM api_keys WHERE id = $1 RETURNING id', [Number(req.params.id)]);
    if (!result.rowCount) return failure(res, 'Key not found', 404);
    success(res, { removed: true });
  } catch (err) { failFrom(res, err); }
});
