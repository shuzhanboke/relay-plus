import { query } from '../db/pool.js';
import type { Request } from 'express';

export interface AuditInput {
  actorId: number;
  actorEmail: string;
  action: string;
  targetType?: string;
  targetId?: number | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/** 记录一条操作审计日志。 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, actor_email, action, target_type, target_id, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.actorId, input.actorEmail, input.action, input.targetType || null, input.targetId ?? null,
       JSON.stringify(input.detail || {}), input.ip || null]
    );
  } catch {
    // 审计失败不影响主流程
  }
}

/** 从 request 取操作人信息。 */
export function actorFrom(req: Request): { actorId: number; actorEmail: string; ip: string | null } {
  return {
    actorId: (req.user as any)?.id ?? 0,
    actorEmail: (req.user as any)?.email ?? '',
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null,
  };
}

/** 查询审计日志（管理员）。 */
export async function listAudit(limit: number, actorId?: number, action?: string): Promise<any[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (actorId) { params.push(actorId); cond.push(`actor_id = $${params.length}`); }
  if (action) { params.push(action); cond.push(`action = $${params.length}`); }
  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  params.push(limit);
  const rows = await query(
    `SELECT id, actor_id, actor_email, action, target_type, target_id, detail, ip, created_at
       FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
  );
  return rows.rows;
}
