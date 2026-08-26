import { query } from '../db/pool.js';
import { normalizePermissions, permissionGroups } from '../permissions.js';

export interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
  created_at: Date;
}

export async function listRoles(): Promise<RoleRow[]> {
  const res = await query<RoleRow & { perms: string[] }>(
    `SELECT id, name, description, permissions, is_system, created_at FROM roles ORDER BY is_system DESC, id ASC`
  );
  return res.rows.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: r.permissions || [], is_system: r.is_system, created_at: r.created_at }));
}

export async function createRole(input: { name: string; description?: string; permissions: string[] }): Promise<RoleRow> {
  const perms = normalizePermissions(input.permissions);
  if (!input.name.trim()) throw Object.assign(new Error('ROLE_NAME_REQUIRED'), { status: 400 });
  const res = await query<RoleRow>(
    `INSERT INTO roles (name, description, permissions) VALUES ($1,$2,$3) RETURNING id, name, description, permissions, is_system, created_at`,
    [input.name.trim(), input.description || null, perms]
  );
  return res.rows[0];
}

export async function updateRole(id: number, input: { name?: string; description?: string | null; permissions?: string[] }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); params.push(input.name.trim()); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); params.push(input.description || null); }
  if (input.permissions !== undefined) { sets.push(`permissions = $${i++}`); params.push(normalizePermissions(input.permissions)); }
  if (sets.length === 0) throw Object.assign(new Error('NOTHING_TO_UPDATE'), { status: 400 });
  params.push(id);
  await query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $${i}`, params);
}

export async function deleteRole(id: number): Promise<void> {
  // 系统内置角色与已被用户使用的角色不可删
  const r = await query<{ is_system: boolean }>('SELECT is_system FROM roles WHERE id = $1', [id]);
  if (!r.rows[0]) throw Object.assign(new Error('ROLE_NOT_FOUND'), { status: 404 });
  if (r.rows[0].is_system) throw Object.assign(new Error('ROLE_SYSTEM'), { status: 400 });
  const used = await query('SELECT COUNT(*)::int AS c FROM users WHERE role_id = $1', [id]);
  if (used.rows[0].c > 0) throw Object.assign(new Error('ROLE_IN_USE'), { status: 400 });
  await query('DELETE FROM roles WHERE id = $1', [id]);
}

export { permissionGroups, normalizePermissions };
