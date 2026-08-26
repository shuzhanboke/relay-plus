import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { requireAuth, requirePerm } from './authMiddleware.js';
import { success, failure, failFrom } from './respond.js';
import { listRoles, createRole, updateRole, deleteRole, permissionGroups } from '../services/rolesService.js';
import { query } from '../db/pool.js';
import { audit, actorFrom } from '../services/audit.js';

export const rolesRouter: Router = express.Router();

// 权限点清单（前端矩阵用）+ 角色列表
rolesRouter.get('/admin/roles', requireAuth, requirePerm('role.manage'), async (_req, res) => {
  try {
    const roles = await listRoles();
    success(res, { roles, permission_groups: permissionGroups() });
  } catch (err) { failFrom(res, err); }
});

// 创建角色
rolesRouter.post('/admin/roles', requireAuth, requirePerm('role.manage'), async (req, res) => {
  const schema = z.object({ name: z.string().min(1), description: z.string().optional(), permissions: z.array(z.string()).default([]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const role = await createRole(parsed.data);
    const a = actorFrom(req);
    await audit({ actorId: a.actorId, actorEmail: a.actorEmail, action: 'create_role', targetType: 'role', targetId: role.id, detail: { name: role.name }, ip: a.ip });
    success(res, role);
  } catch (err) {
    const m = err instanceof Error ? err.message : '';
    if (m === 'ROLE_NAME_REQUIRED') return failure(res, '角色名不能为空', 400);
    if ((err as any).code === '23505') return failure(res, '角色名已存在', 409);
    failFrom(res, err);
  }
});

// 更新角色权限
rolesRouter.patch('/admin/roles/:id', requireAuth, requirePerm('role.manage'), async (req, res) => {
  const schema = z.object({ name: z.string().min(1).optional(), description: z.string().nullish(), permissions: z.array(z.string()).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    await updateRole(Number(req.params.id), parsed.data);
    const a = actorFrom(req);
    await audit({ actorId: a.actorId, actorEmail: a.actorEmail, action: 'update_role', targetType: 'role', targetId: Number(req.params.id), detail: {}, ip: a.ip });
    success(res, { ok: true });
  } catch (err) { failFrom(res, err); }
});

// 删除角色
rolesRouter.delete('/admin/roles/:id', requireAuth, requirePerm('role.manage'), async (req, res) => {
  try {
    await deleteRole(Number(req.params.id));
    success(res, { ok: true });
  } catch (err) {
    const m = err instanceof Error ? err.message : '';
    const map: Record<string, [number, string]> = {
      ROLE_NOT_FOUND: [404, '角色不存在'], ROLE_SYSTEM: [400, '系统内置角色不可删除'], ROLE_IN_USE: [400, '该角色已被用户使用，无法删除'],
    };
    if (map[m]) return failure(res, map[m][1], map[m][0]);
    failFrom(res, err);
  }
});

// 给用户分配角色（或直接覆盖权限）
rolesRouter.patch('/admin/users/:id/role', requireAuth, requirePerm('user.assign_role'), async (req, res) => {
  const schema = z.object({ role_id: z.number().int().positive().nullish(), permissions: z.array(z.string()).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    if (parsed.data.role_id) {
      const r = await query('SELECT id FROM roles WHERE id = $1', [parsed.data.role_id]);
      if (!r.rowCount) return failure(res, '角色不存在', 404);
      await query('UPDATE users SET role_id = $1 WHERE id = $2', [parsed.data.role_id, Number(req.params.id)]);
    } else {
      await query('UPDATE users SET role_id = NULL WHERE id = $1', [Number(req.params.id)]);
    }
    if (parsed.data.permissions) {
      // 直接覆盖权限（需在 rolesService 引入 normalize；此处用服务导出）
      const { normalizePermissions } = await import('../services/rolesService.js');
      await query('UPDATE users SET permissions = $1 WHERE id = $2', [normalizePermissions(parsed.data.permissions), Number(req.params.id)]);
    }
    const a = actorFrom(req);
    await audit({ actorId: a.actorId, actorEmail: a.actorEmail, action: 'assign_role', targetType: 'user', targetId: Number(req.params.id), detail: { role_id: parsed.data.role_id ?? null }, ip: a.ip });
    success(res, { ok: true });
  } catch (err) { failFrom(res, err); }
});
