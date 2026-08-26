// 权限点注册表：集中定义系统所有可授权操作。
// 内置角色 role='admin'（超管）拥有全部权限；自定义角色通过 roles.permissions 数组按需勾选。
export interface PermissionDef {
  key: string;          // 唯一标识，如 'user.manage'
  label: string;        // 中文名
  group: string;        // 分组（用于前端矩阵分组）
  desc?: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { key: 'dashboard.view', label: '查看仪表盘', group: '通用' },
  { key: 'user.manage', label: '用户管理（增删改/余额/禁封）', group: '用户' },
  { key: 'user.assign_role', label: '给用户分配角色', group: '用户' },
  { key: 'account.manage', label: '上游账号管理（增删改/凭据）', group: '网关' },
  { key: 'channel.health', label: '渠道状态监控', group: '网关' },
  { key: 'group.manage', label: '分组管理', group: '网关' },
  { key: 'proxy.manage', label: '代理管理', group: '网关' },
  { key: 'apikey.manage', label: 'API Key 管理', group: '网关' },
  { key: 'price.manage', label: '模型价格管理', group: '计费' },
  { key: 'plan.manage', label: '套餐/计划管理', group: '计费' },
  { key: 'order.view', label: '查看订单', group: '计费' },
  { key: 'order.confirm', label: '确认订单到账', group: '计费' },
  { key: 'card.manage', label: '卡密管理', group: '计费' },
  { key: 'invite.manage', label: '邀请码管理', group: '计费' },
  { key: 'log.view', label: '查看请求日志', group: '日志' },
  { key: 'audit.view', label: '查看审计日志', group: '日志' },
  { key: 'setting.manage', label: '系统设置', group: '系统' },
  { key: 'oauth.manage', label: 'OAuth 对接（FlowPilot）', group: '系统' },
  { key: 'role.manage', label: '角色管理', group: '系统' },
];

/** 返回按分组排列的权限点（前端矩阵用） */
export function permissionGroups(): Record<string, PermissionDef[]> {
  const g: Record<string, PermissionDef[]> = {};
  for (const p of PERMISSIONS) {
    (g[p.group] = g[p.group] || []).push(p);
  }
  return g;
}

export const PERM_KEYS: string[] = PERMISSIONS.map((p) => p.key);
export const ALL_PERMISSIONS: string[] = [...PERM_KEYS];

/** 校验权限数组是否合法（过滤未知 key、去重） */
export function normalizePermissions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.filter((x): x is string => typeof x === 'string' && PERM_KEYS.includes(x))));
}
