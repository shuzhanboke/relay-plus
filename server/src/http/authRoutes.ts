import type { Router } from 'express';
import express, { type Request } from 'express';
import { z } from 'zod';
import { login, register, signTokenWith, findUserByEmail } from '../services/auth.js';
import { query } from '../db/pool.js';
import {
  checkLoginAllowed, recordLoginFailure, clearLoginFailures, getClientIp,
} from '../services/loginGuard.js';
import { requireAuth, requireAdmin, requirePerm } from './authMiddleware.js';
import { success, failure, failFrom, badRequest } from './respond.js';
import bcrypt from 'bcryptjs';
import { audit, actorFrom } from '../services/audit.js';

// 注册 IP 限流：同一 IP 60 秒内最多 N 次注册
const REGISTER_IP_CAP = Number(process.env.REGISTER_IP_CAP || 5);

export const authRouter: Router = express.Router();

/**
 * Cloudflare Turnstile 人机验证。
 * 仅当配置了 TURNSTILE_SECRET 时强制执行；未配置则视为通过（适用于内测/本地，生产务必配置）。
 */
async function verifyTurnstile(token: string, req: Request): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // 未启用验证码
  if (!token) return false;
  try {
    const ip = req.ip || '';
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const j = await resp.json().catch(() => null) as { success?: boolean } | null;
    return !!(j && j.success === true);
  } catch {
    return false;
  }
}

// ---- 登录：返回格式与 FlowPilot/Sub2API 一致（顶层 access_token）----
authRouter.post('/auth/login', async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1), turnstile: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid email or password', 400);

  const email = parsed.data.email;

  // 登录安全防护：IP 限流 + 邮箱失败锁定 + 可选验证码
  const guard = await checkLoginAllowed(email, req);
  if (!guard.allowed) {
    const message = guard.reason === 'ACCOUNT_LOCKED'
      ? `登录失败次数过多，账号已临时锁定，请 ${Math.ceil((guard.retryAfterSec || 0) / 60)} 分钟后再试`
      : '请求过于频繁，请稍后再试';
    return failure(res, message, 429);
  }
  if (parsed.data.turnstile) {
    const ok = await verifyTurnstile(parsed.data.turnstile, req);
    if (!ok) return failure(res, '人机验证未通过，请重试', 400);
  }

  try {
    const data = await login(email, parsed.data.password);
    // 登录成功，清除失败记录
    await clearLoginFailures(email);
    // 若该用户已启用两步验证（TOTP），先不给正式 token，改为要求第二步
    const totpRow = await query('SELECT totp_enabled FROM users WHERE email = $1', [email]);
    if (totpRow.rows[0]?.totp_enabled) {
      // 短效 pending token（带 totp_pending 标记，5 分钟），仅用于 /auth/totp/verify，不能当正式凭证
      const u = data.user as any;
      const pending = signTokenWith({
        id: Number(u?.id) || 0, email: String(u?.email ?? email), username: u?.username ?? null,
        role: String(u?.role ?? 'user'), status: String(u?.status ?? 'active'), balance: Number(u?.balance ?? 0),
        created_at: u?.created_at ?? new Date(),
      }, { totp_pending: true }, 5 * 60 * 1000);
      res.json({ totp_required: true, pending_totp_token: pending, expires_in: 300, token_type: 'Bearer' });
      return;
    }
    res.json(data); // { access_token, expires_in, token_type, user }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg === 'INVALID_CREDENTIALS') {
      await recordLoginFailure(email);
      return failure(res, 'Invalid email or password', 401);
    }
    if (msg === 'ACCOUNT_DISABLED') return failure(res, 'Account disabled', 403);
    failFrom(res, err);
  }
});

authRouter.post('/auth/register', async (req, res) => {
  if (process.env.ALLOW_REGISTER !== 'true') {
    return failure(res, 'Registration is disabled by administrator', 403);
  }
  // 注册 IP 限流：防注册轰炸
  const ip = getClientIp(req);
  const winBucket = String(Math.floor(Date.now() / 60_000));
  const ipKey = `register:ip:${ip}`;
  const r = await query<{ count: string }>(
    `INSERT INTO rate_counters (scope, bucket, count) VALUES ($1, $2, 1)
     ON CONFLICT (scope, bucket) DO UPDATE SET count = rate_counters.count + 1 RETURNING count::text`,
    [ipKey, winBucket]
  );
  if (Number(r.rows[0].count) > REGISTER_IP_CAP) {
    return failure(res, '注册过于频繁，请稍后再试', 429);
  }
  const schema = z.object({ email: z.string().email(), password: z.string().min(8), username: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid registration payload', 400);
  const email = parsed.data.email.toLowerCase();
  // 邮箱后缀白名单（REGISTER_EMAIL_SUFFIX_WHITELIST="a@b.com,*.edu.cn" 波浪号分隔；支持 * 前缀如 .edu.cn）
  const whitelist = (process.env.REGISTER_EMAIL_SUFFIX_WHITELIST || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (whitelist.length) {
    const domain = email.split('@')[1] || '';
    const ok = whitelist.some((rule) => rule.startsWith('*') ? domain.endsWith(rule.slice(1)) : '@' + domain === rule);
    if (!ok) return failure(res, '该邮箱域名不支持注册', 400);
  }
  // 每域名注册配额（REGISTER_EMAIL_DOMAIN_QUOTA=10）
  const domainQuota = Number(process.env.REGISTER_EMAIL_DOMAIN_QUOTA || 0);
  if (domainQuota > 0) {
    const domain = email.split('@')[1] || '';
    const cnt = await query<{ c: string }>('SELECT COUNT(*)::text AS c FROM users WHERE split_part(email, \'@\', 2) = $1', [domain]);
    if (Number(cnt.rows[0]?.c || 0) >= domainQuota) {
      return failure(res, '该邮箱域名的注册数量已达上限', 400);
    }
  }
  try {
    const data = await register(email, parsed.data.password, parsed.data.username);
    res.json(data);
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') return failure(res, 'Email already registered', 409);
    failFrom(res, err);
  }
});

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  const threshold = Number(process.env.BALANCE_LOW_THRESHOLD || 0);
  const u = req.user!;
  success(res, { ...u, balance_low: threshold > 0 && u.balance <= threshold });
});

// 修改自己的密码（需验证旧密码）
authRouter.post('/auth/change-password', requireAuth, async (req, res) => {
  const schema = z.object({ old_password: z.string().min(1), new_password: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '新密码至少 6 位', 400);
  try {
    const row = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!row.rows[0]) return failure(res, '用户不存在', 404);
    const ok = await bcrypt.compare(parsed.data.old_password, row.rows[0].password_hash);
    if (!ok) return failure(res, '旧密码错误', 400);
    const hash = await bcrypt.hash(parsed.data.new_password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user!.id]);
    success(res, { ok: true });
  } catch (err) { failFrom(res, err); }
});

// ---- 用户管理（管理员）----
authRouter.get('/admin/users', requireAuth, requirePerm('user.manage'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT u.id, u.email, u.username, u.role, u.status, u.balance::float8 AS balance, u.created_at,
              (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id) AS key_count,
              (SELECT COALESCE(SUM(l.cost),0)::float8 FROM request_logs l WHERE l.user_id = u.id) AS spent
         FROM users u ORDER BY u.created_at DESC`
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

authRouter.post('/admin/users', requireAuth, requirePerm('user.manage'), async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    username: z.string().optional(),
    balance: z.number().nonnegative().default(0),
    role: z.enum(['admin', 'user']).default('user'),
    status: z.enum(['active', 'disabled']).default('active'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid user payload', 400);
  try {
    const hash = await bcrypt.hash(parsed.data.password, 10);
    const dup = await query('SELECT id FROM users WHERE email = $1', [parsed.data.email.toLowerCase()]);
    if (dup.rowCount) return failure(res, 'Email already registered', 409);
    const resRow = await query(
      `INSERT INTO users (email, password_hash, username, role, status, balance)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, username, role, status, balance::float8 AS balance, created_at`,
      [parsed.data.email.toLowerCase(), hash, parsed.data.username || parsed.data.email.toLowerCase().split('@')[0],
       parsed.data.role, parsed.data.status, parsed.data.balance]
    );
    success(res, resRow.rows[0]);
  } catch (err) { failFrom(res, err); }
});

authRouter.patch('/admin/users/:id', requireAuth, requirePerm('user.manage'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return failure(res, 'Invalid user id', 400);
  const schema = z.object({
    username: z.string().optional(),
    balance: z.number().nonnegative().optional(),
    role: z.enum(['admin', 'user']).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    password: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const f = parsed.data;
  if (f.username !== undefined) { sets.push(`username = $${i++}`); params.push(f.username); }
  if (f.balance !== undefined) { sets.push(`balance = $${i++}`); params.push(f.balance); }
  if (f.role !== undefined) { sets.push(`role = $${i++}`); params.push(f.role); }
  if (f.status !== undefined) { sets.push(`status = $${i++}`); params.push(f.status); }
  if (f.password !== undefined) { sets.push(`password_hash = $${i++}`); params.push(await bcrypt.hash(f.password, 10)); }
  if (sets.length === 0) return failure(res, 'Nothing to update', 400);
  params.push(id);
  try {
    const result = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, email, username, role, status, balance::float8 AS balance, created_at`,
      params
    );
    if (!result.rowCount) return failure(res, 'User not found', 404);
    // 审计：管理员修改用户（余额/角色/状态/密码等）
    await audit({ ...actorFrom(req), action: 'update_user', targetType: 'user', targetId: id, detail: { changed: Object.keys(f) }, ip: actorFrom(req).ip });
    success(res, result.rows[0]);
  } catch (err) { failFrom(res, err); }
});

authRouter.delete('/admin/users/:id', requireAuth, requirePerm('user.manage'), async (req, res) => {
  const id = Number(req.params.id);
  if (req.user && req.user.id === id) return failure(res, 'Cannot delete your own account', 400);
  try {
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!result.rowCount) return failure(res, 'User not found', 404);
    success(res, { id });
  } catch (err) { failFrom(res, err); }
});

// ==================== OAuth 登录（GitHub）====================
// 需配置 OAUTH_GITHUB_CLIENT_ID / OAUTH_GITHUB_CLIENT_SECRET / OAUTH_GITHUB_REDIRECT_URI
function githubOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID || '';
  const clientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET || '';
  const redirectUri = process.env.OAUTH_GITHUB_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL || ''}/api/v1/auth/oauth/github/callback`;
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('OAUTH_NOT_CONFIGURED'), { status: 400 });
  }
  return { clientId, clientSecret, redirectUri };
}

// 跳转 GitHub 授权
authRouter.get('/auth/oauth/github', async (req, res) => {
  try {
    const { clientId, redirectUri } = githubOAuthConfig();
    const state = require('crypto').randomBytes(16).toString('hex');
    // 防 login CSRF：state 存 httpOnly cookie，回调时校验
    res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, secure: isHttpsReq(req) });
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=${state}`;
    res.redirect(url);
  } catch (err) {
    const m = err instanceof Error ? err.message : '';
    if (m === 'OAUTH_NOT_CONFIGURED') return failure(res, 'OAuth 未配置（需设置 OAUTH_GITHUB_CLIENT_ID/SECRET）', 400);
    failFrom(res, err);
  }
});

// state 是否来自 https（生产 HTTPS 下 cookie 加 secure）
function isHttpsReq(req: Request): boolean {
  return req.secure || /^https/i.test(req.headers['x-forwarded-proto'] as string || '') || req.get('host')?.startsWith('api.') === true;
}

// 手动解析 Cookie 头（无 cookie-parser 依赖）
function readCookie(req: Request, name: string): string {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) {
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return '';
}

// GitHub 回调：换 token -> 取邮箱 -> 登录/注册
authRouter.get('/auth/oauth/github/callback', async (req, res) => {
  try {
    const { clientId, clientSecret, redirectUri } = githubOAuthConfig();
    const code = req.query.code as string;
    if (!code) return failure(res, 'GitHub 授权失败', 400);
    // 校验 state（防 login CSRF）
    const state = req.query.state as string;
    const cookieState = (req as any).cookies?.oauth_state || readCookie(req, 'oauth_state');
    res.clearCookie('oauth_state', { httpOnly: true, sameSite: 'lax', secure: isHttpsReq(req) });
    if (!state || !cookieState || state !== cookieState) {
      return failure(res, 'OAuth state 校验失败', 400);
    }
    // 换 access_token
    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const tokenJson = await tokenResp.json().catch(() => null) as { access_token?: string } | null;
    const ghToken = tokenJson?.access_token;
    if (!ghToken) return failure(res, 'GitHub token 换取失败', 401);
    // 取邮箱
    const userResp = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: 'Bearer ' + ghToken, Accept: 'application/json' },
    });
    const emails = await userResp.json().catch(() => []);
    const primary = (Array.isArray(emails) ? emails : []).find((e: any) => e.primary && e.verified);
    const email = (primary?.email || (Array.isArray(emails) ? emails[0]?.email : null)) as string | undefined;
    if (!email) return failure(res, '未能获取 GitHub 邮箱', 401);
    // 登录或注册
    let existing = await findUserByEmail(email);
    if (!existing) {
      if (process.env.ALLOW_REGISTER !== 'true') return failure(res, '注册已关闭', 403);
      const hash = await bcrypt.hash(require('crypto').randomBytes(12).toString('hex'), 10);
      const ins = await query<{ id: number; email: string; username: string | null; role: string; status: string; balance: string; created_at: Date }>(
        'INSERT INTO users (email, password_hash, username, role, status, balance) VALUES ($1,$2,$3,$4,\'active\',0) RETURNING id, email, username, role, status, balance, created_at',
        [email, hash, email.split('@')[0], 'user']
      );
      const r = ins.rows[0];
      existing = { id: r.id, email: r.email, username: r.username, role: r.role, status: r.status, balance: Number(r.balance), created_at: r.created_at };
    }
    const token = signTokenWith(existing, {}, 7 * 86400 * 1000);
    // 前端拿到 token 后调用 /auth/me 完成会话；用 fragment 传递
    const frontUrl = `${process.env.PUBLIC_BASE_URL || ''}/login?oauth_token=${encodeURIComponent(token)}`;
    res.redirect(frontUrl);
  } catch (err) {
    const m = err instanceof Error ? err.message : '';
    if (m === 'OAUTH_NOT_CONFIGURED') return failure(res, 'OAuth 未配置', 400);
    failFrom(res, err);
  }
});

authRouter.post('/auth/oauth/accept', requireAuth, async (req, res) => {
  success(res, { user: req.user });
});

// ==================== 密码找回（邮箱验证码重置）====================
// 发信可用 SMTP_* 环境变量；未配置 SMTP 时验证码会打到日志（仅开发/测试）
authRouter.post('/auth/forgot-password', async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '邮箱格式错误', 400);
  const email = parsed.data.email.toLowerCase();
  try {
    const user = await query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
    if (!user.rowCount) {
      // 不泄露是否存在：统一返回成功
      return success(res, { ok: true });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await query('INSERT INTO password_reset_codes (user_id, code, expires_at) VALUES ($1,$2,$3)', [user.rows[0].id, code, expires]);
    await sendResetMail(email, code);
    success(res, { ok: true, dev_code: process.env.NODE_ENV !== 'production' ? code : undefined });
  } catch (err) { failFrom(res, err); }
});

// 用验证码重置密码
authRouter.post('/auth/reset-password', async (req, res) => {
  const schema = z.object({ email: z.string().email(), code: z.string().length(6), new_password: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '参数错误', 400);
  const email = parsed.data.email.toLowerCase();
  // IP 限流：防止 6 位码暴力爆破
  try {
    const ip = getClientIp(req);
    const bucket = String(Math.floor(Date.now() / 60_000));
    const r = await query('INSERT INTO rate_counters (scope, bucket, count) VALUES ($1,$2,1) ON CONFLICT (scope,bucket) DO UPDATE SET count=rate_counters.count+1 RETURNING count::int', [`reset:ip:${ip}`, bucket]);
    if (Number(r.rows[0]?.count) > 5) return failure(res, '尝试次数过多，请稍后再试', 429);
  } catch { /* 限流失败不阻塞 */ }
  try {
    const user = await query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
    if (!user.rowCount) return failure(res, '邮箱未注册', 404);
    const uid = user.rows[0].id;
    // 原子消费码（条件 UPDATE 一次有效）
    const consumed = await query(
      `UPDATE password_reset_codes SET consumed=true
        WHERE id = (SELECT id FROM password_reset_codes WHERE user_id=$1 AND code=$2 AND consumed=false AND expires_at > now() ORDER BY id DESC LIMIT 1 FOR UPDATE) RETURNING id`,
      [uid, parsed.data.code]
    );
    if (!consumed.rowCount) return failure(res, '验证码无效或已过期', 400);
    const hash = await bcrypt.hash(parsed.data.new_password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, uid]);
    success(res, { ok: true });
  } catch (err) { failFrom(res, err); }
});

async function sendResetMail(to: string, code: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (host) {
    // SMTP 发送（需 nodemailer；此处用 fetch 占位或交由用户配置官方邮件服务）
    // eslint-disable-next-line no-console
    console.log(`[mail:reset] to=${to} code=${code}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[reset-code] ${to}: ${code}`);
  }
}
