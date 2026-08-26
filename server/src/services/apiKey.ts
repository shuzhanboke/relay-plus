import crypto from 'crypto';
import { query } from '../db/pool.js';
import { randomToken, hashApiKey, getJwtSecret } from './auth.js';

// AES-256-GCM 加解密 API Key 明文，密钥由 JWT_SECRET 派生（sha256）
function encKey(): Buffer { return crypto.createHash('sha256').update(getJwtSecret()).digest(); }
export function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}
export function decryptKey(data: string): string {
  const [ivB64, tagB64, encB64] = data.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}

export interface ApiKeyRow {
  id: number;
  user_id: number;
  name: string;
  model_whitelist: string[] | null;
  group_id: number | null;
  status: string;
  rps_limit: number | null;
  rpm_limit: number | null;
  tpm_limit: number | null;
  expires_at: Date | null;
}

export interface ApiKeyWithUser extends ApiKeyRow {
  user_balance: number;
  user_status: string;
  group_platform?: string | null;
  group_rate_multiplier?: number | null;
}

/** 生成新 API Key 并入库。返回完整明文 key（仅本次展示）。 */
export async function createApiKey(input: {
  userId: number;
  name?: string;
  modelWhitelist?: string[];
  groupId?: number | null;
  rpsLimit?: number | null;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  expiresAt?: Date | null;
}): Promise<{ full: string; prefix: string; tail: string }> {
  const { full, tail, hash } = randomToken('sk-');
  const prefix = full.slice(0, 12);
  const keyEnc = encryptKey(full);
  const res = await query<{ id: string }>(
    `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, key_enc, key_tail, model_whitelist, group_id, rps_limit, rpm_limit, tpm_limit, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)`,
    [input.userId, input.name || 'default', prefix, hash, keyEnc, tail,
     input.modelWhitelist && input.modelWhitelist.length ? input.modelWhitelist : null,
     input.groupId ?? null, input.rpsLimit ?? null, input.rpmLimit ?? null, input.tpmLimit ?? null,
     input.expiresAt ?? null]
  );
  void res;
  return { full, prefix, tail };
}

/** 解密并返回某用户某 Key 的完整明文（调用方需校验归属）。 */
export async function revealKeyFull(keyId: number, userId: number): Promise<string | null> {
  const r = await query<{ key_enc: string | null }>(
    `SELECT key_enc FROM api_keys WHERE id = $1 AND user_id = $2`, [keyId, userId]
  );
  const enc = r.rows[0]?.key_enc;
  if (!enc) return null;
  try { return decryptKey(enc); } catch { return null; }
}

/** 校验终端 Bearer token，返回对齐了用户与分组信息的 Key 记录。 */
export async function resolveApiKey(rawToken: string): Promise<ApiKeyWithUser | null> {
  const token = rawToken.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const hash = hashApiKey(token);
  const res = await query<ApiKeyWithUser>(
    `SELECT k.id, k.user_id, k.name, k.model_whitelist, k.group_id, k.rps_limit, k.rpm_limit, k.tpm_limit, k.expires_at, k.status,
            u.balance::float8 AS user_balance, u.status AS user_status, g.platform AS group_platform, g.rate_multiplier AS group_rate_multiplier
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       LEFT JOIN groups g ON g.id = k.group_id
      WHERE k.key_hash = $1`,
    [hash]
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (row.user_status !== 'active') return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function touchKey(id: number): Promise<void> {
  await query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [id]);
}
