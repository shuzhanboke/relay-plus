import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../db/pool.js';

export interface UserRow {
  id: number;
  email: string;
  username: string | null;
  role: string;
  status: string;
  balance: number;
  created_at: Date;
}

export interface TokenPair {
  access_token: string;
  expires_in: number;
  token_type: 'Bearer';
  user?: UserRow;
}

const SECRET = process.env.JWT_SECRET || '';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// 生产安全：缺失 JWT_SECRET 时拒绝启动，避免硬编码/弱密钥被用于伪造任意身份。
export function getJwtSecret(): string {
  if (!SECRET || SECRET.length < 24) {
    throw new Error('[security] JWT_SECRET 未设置或过短（≥24 字符）。请在环境变量/ .env 中配置随机密钥后重启。');
  }
  return SECRET;
}

export function signToken(user: UserRow): string {
  return jwt.sign({ sub: String(user.id), role: user.role, email: user.email }, getJwtSecret(), { expiresIn: EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

/** 签带额外 claims + 自定义有效期的 token（如 TOTP 两步验证的短效 pending token）。 */
export function signTokenWith(user: UserRow, extra: Record<string, unknown>, expiresInMs: number): string {
  return jwt.sign(
    { sub: String(user.id), role: user.role, email: user.email, ...extra },
    getJwtSecret(),
    { expiresIn: Math.floor(expiresInMs / 1000) }
  );
}

export function verifyToken(token: string): { sub: string; role: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { sub: string; role: string; email: string };
    return decoded;
  } catch {
    return null;
  }
}

/** 密码校验。 */
export async function verifyPassword(input: string, hash: string): Promise<boolean> {
  return bcrypt.compare(input, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const res = await query<UserRow>('SELECT id, email, username, role, status, balance::float8 AS balance, created_at FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const res = await query<UserRow>('SELECT id, email, username, role, status, balance::float8 AS balance, created_at FROM users WHERE email = $1', [email]);
  return res.rows[0] || null;
}

/** 登录，返回 token pair；失败抛出带 message 的 Error。 */
export async function login(email: string, password: string): Promise<TokenPair> {
  const normalized = email.toLowerCase();
  const res = await query<{ id: number; email: string; password_hash: string; username: string | null; role: string; status: string; balance: string; created_at: Date }>(
    'SELECT id, email, password_hash, username, role, status, balance, created_at FROM users WHERE email = $1', [normalized]
  );
  const row = res.rows[0];
  if (!row) throw new Error('INVALID_CREDENTIALS');
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new Error('INVALID_CREDENTIALS');
  if (row.status !== 'active') throw new Error('ACCOUNT_DISABLED');

  const user: UserRow = { id: row.id, email: row.email, username: row.username, role: row.role, status: row.status, balance: Number(row.balance), created_at: row.created_at };
  const access_token = signToken(user);
  // 计算秒数：简单起见返回固定 7 天
  const exp = jwt.decode(access_token) as { exp: number } | null;
  const expires_in = exp ? Math.max(0, exp.exp - Math.floor(Date.now() / 1000)) : 604800;
  return { access_token, expires_in, token_type: 'Bearer', user };
}

export async function register(email: string, password: string, username?: string): Promise<TokenPair> {
  const normalized = email.toLowerCase();
  const existing = await findUserByEmail(normalized);
  if (existing) throw new Error('EMAIL_EXISTS');
  const hash = await hashPassword(password);
  const defaultBalance = Number(process.env.DEFAULT_BALANCE || 0);
  const res = await query<UserRow>(
    `INSERT INTO users (email, password_hash, username, role, status, balance)
     VALUES ($1, $2, $3, 'user', 'active', $4) RETURNING id, email, username, role, status, balance::float8 AS balance, created_at`,
    [normalized, hash, username || normalized.split('@')[0], defaultBalance]
  );
  const user = res.rows[0];
  return login(user.email, password);
}

export function randomToken(prefix: string, bytes = 24): { full: string; tail: string; hash: string } {
  const secret = crypto.randomBytes(bytes).toString('base64url');
  const full = `${prefix}${secret}`;
  const tail = full.slice(-4);
  const hash = crypto.createHash('sha256').update(full).digest('hex');
  return { full, tail, hash };
}

export function hashApiKey(full: string): string {
  return crypto.createHash('sha256').update(full).digest('hex');
}
