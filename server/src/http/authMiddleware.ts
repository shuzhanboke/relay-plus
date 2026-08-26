import type { Request, Response, NextFunction } from 'express';
import { verifyToken, findUserById, type UserRow } from '../services/auth.js';
import { query } from '../db/pool.js';
import { failure } from './respond.js';

// 扩展用户视图：权限集合 + 角色名
type AuthedUser = UserRow & { permissions: string[]; role_name: string | null };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      rawToken?: string;
    }
  }
}

/** JWT 认证：解析 Authorization: Bearer <token>，填充 req.user（含权限）。 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) { return failUnauthorized(res); }
  const payload = verifyToken(token);
  if (!payload) { return failUnauthorized(res); }
  // TOTP 两步验证的 pending token 不能作为正式凭证使用
  if ((payload as any).totp_pending) { return failUnauthorized(res); }
  const user = await findUserById(Number(payload.sub));
  if (!user) { return failUnauthorized(res); }
  // 禁用/停用用户在 token 有效期内也应立即失效
  if (user.status !== 'active') { return failUnauthorized(res); }
  // 加载权限：admin 角色全权限；否则取自定义角色权限 + 用户覆盖权限
  let permissions: string[] = [];
  let roleName: string | null = null;
  if (user.role === 'admin') {
    permissions = ['*'];
  } else {
    const row = await query<{ permissions: string[] | null; name: string | null; user_perms: string[] | null }>(
      `SELECT r.permissions, r.name, u.permissions AS user_perms
         FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`, [user.id]
    );
    if (row.rows[0]) {
      roleName = row.rows[0].name;
      permissions = [...(row.rows[0].permissions || []), ...(row.rows[0].user_perms || [])];
    }
  }
  const authed: AuthedUser = { ...user, permissions, role_name: roleName };
  req.user = authed;
  req.rawToken = token;
  next();
}

/** 权限检查：admin 拥有全部权限；自定义角色按权限点判断。 */
export function requirePerm(permKey: string) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) { return failUnauthorized(res); }
    if (req.user.permissions.includes('*') || req.user.permissions.includes(permKey)) {
      return next();
    }
    failure(res, 'Forbidden: insufficient permission', 403);
  };
}

/** 兼容旧接口：超级管理员校验（保留供未迁移到权限点的路由）。 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { return failUnauthorized(res); }
  if (req.user.role !== 'admin') {
    failure(res, 'Forbidden: admin only', 403);
    return;
  }
  next();
}

function failUnauthorized(res: Response): void {
  failure(res, 'Unauthorized', 401);
}
