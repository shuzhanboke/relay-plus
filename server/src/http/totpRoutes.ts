import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth } from './authMiddleware.js';
import { success, failure, failFrom } from './respond.js';
import { generateSecret, otpauthUrl, validateTotp } from '../services/totp.js';
import { signToken, verifyToken } from '../services/auth.js';
import type { Request } from 'express';

export const totpRouter: Router = express.Router();

const ISSUER = process.env.SITE_NAME || 'RelayPlus';

/** 获取/创建用户的 TOTP secret，返回 otpauth URL 供扫码。 */
totpRouter.get('/auth/totp/setup', requireAuth, async (req, res) => {
  try {
    const row = await query<{ totp_secret: string | null; totp_enabled: boolean; email: string }>(
      'SELECT totp_secret, totp_enabled, email FROM users WHERE id = $1', [req.user!.id]
    );
    const u = row.rows[0];
    if (u.totp_enabled) return success(res, { enabled: true });
    let secret = u.totp_secret;
    if (!secret) {
      secret = generateSecret();
      await query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, req.user!.id]);
    }
    const url = otpauthUrl(secret, u.email, ISSUER);
    success(res, { enabled: false, secret, otpauth_url: url });
  } catch (err) { failFrom(res, err); }
});

/** 启用 TOTP：需先校验一次当前验证码。 */
totpRouter.post('/auth/totp/enable', requireAuth, async (req, res) => {
  const schema = z.object({ code: z.string().min(6).max(6) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '请输入 6 位验证码', 400);
  try {
    const row = await query<{ totp_secret: string | null; totp_last_code: string | null }>(
      'SELECT totp_secret, totp_last_code FROM users WHERE id = $1', [req.user!.id]
    );
    const u = row.rows[0];
    if (!u.totp_secret) return failure(res, '请先获取 TOTP 密钥', 400);
    if (!validateTotp(u.totp_secret, parsed.data.code)) return failure(res, '验证码错误，请重试', 400);
    // 原子防重放：条件 UPDATE，同码只启用一次
    const consumed = await query(
      `UPDATE users SET totp_enabled = true, totp_last_code = $1 WHERE id = $2 AND (totp_last_code IS NULL OR totp_last_code <> $1)`,
      [parsed.data.code, req.user!.id]
    );
    if (!consumed.rowCount) return failure(res, '该验证码已被使用', 400);
    success(res, { enabled: true });
  } catch (err) { failFrom(res, err); }
});

/** 关闭 TOTP：需校验一次验证码。 */
totpRouter.post('/auth/totp/disable', requireAuth, async (req, res) => {
  const schema = z.object({ code: z.string().min(6).max(6) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '请输入 6 位验证码', 400);
  try {
    const row = await query<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id = $1', [req.user!.id]);
    if (!row.rows[0]?.totp_secret) return failure(res, 'TOTP 未启用', 400);
    if (!validateTotp(row.rows[0].totp_secret, parsed.data.code)) return failure(res, '验证码错误', 400);
    await query('UPDATE users SET totp_enabled = false, totp_last_code = $1 WHERE id = $2', [parsed.data.code, req.user!.id]);
    success(res, { enabled: false });
  } catch (err) { failFrom(res, err); }
});

/** TOTP 第二步登录：用 pending token 校验验证码，换取正式 access_token。 */
totpRouter.post('/auth/totp/verify', async (req, res) => {
  const schema = z.object({ code: z.string().min(6).max(6), pending_token: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '参数不完整', 400);
  const payload = verifyToken(parsed.data.pending_token);
  if (!payload || (payload as any).totp_pending !== true) return failure(res, '登录状态失效，请重新登录', 401);
  const userId = Number(payload.sub);
  try {
    const row = await query<{ totp_secret: string | null; totp_enabled: boolean; totp_last_code: string | null; id: number; email: string; username: string | null; role: string; status: string; balance: string; created_at: Date }>(
      `SELECT id, email, username, role, status, balance, totp_secret, totp_enabled, totp_last_code, created_at FROM users WHERE id = $1`, [userId]
    );
    const u = row.rows[0];
    if (!u || u.status !== 'active') return failure(res, '账号不可用', 403);
    if (!u.totp_enabled || !u.totp_secret) return failure(res, '该账号未启用两步验证', 400);
    if (!validateTotp(u.totp_secret, parsed.data.code)) return failure(res, '验证码错误', 401);
    // 原子防重放：用一次一个码（条件 UPDATE，同码并发只成功一次）
    const consumed = await query(
      `UPDATE users SET totp_last_code = $1 WHERE id = $2 AND (totp_last_code IS NULL OR totp_last_code <> $1)`,
      [parsed.data.code, userId]
    );
    if (!consumed.rowCount) return failure(res, '该验证码已被使用', 400);
    const user = { id: u.id, email: u.email, username: u.username, role: u.role, status: u.status, balance: Number(u.balance), created_at: u.created_at };
    const access_token = signToken(user);
    res.json({ access_token, expires_in: 604800, token_type: 'Bearer', user });
  } catch (err) { failFrom(res, err); }
});
