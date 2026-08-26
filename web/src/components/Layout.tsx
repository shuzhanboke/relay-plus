import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, clearToken, getToken } from '../api';
import { ToastProvider } from './ui';
import {
  Gauge, Coins, Receipt, Key, Gift, Scroll, UserCircle, ShieldCheck,
  Pulse, TerminalWindow, Detective, Users, IdentificationBadge, Stack,
  CloudArrowUp, ShoppingCart, Tag, Bank, GearSix, SignOut, List, X,
  ChartBar,
  type Icon,
} from '@phosphor-icons/react';

interface NavItem { to: string; label: string; icon: Icon; perm?: string; }
interface NavGroup { title: string; items: NavItem[]; admin?: boolean; }

const NAV_GROUPS: NavGroup[] = [
  {
    title: '总览',
    items: [{ to: '/app', label: '仪表盘', icon: Gauge }],
  },
  {
    title: '我的账户',
    items: [
      { to: '/app/charge', label: '充值中心', icon: Coins },
      { to: '/app/keys', label: '我的 API Key', icon: Key },
      { to: '/app/my-orders', label: '订单/流水', icon: Receipt },
      { to: '/app/redeem', label: '卡密兑换', icon: Gift },
      { to: '/app/affiliate', label: '邀请返利', icon: Users },
      { to: '/app/my-logs', label: '我的日志', icon: Scroll },
      { to: '/app/profile', label: '我的资料', icon: UserCircle },
      { to: '/app/totp', label: '两步验证', icon: ShieldCheck },
    ],
  },
  {
    title: '运营监控',
    admin: true,
    items: [
      { to: '/app/channel-health', label: '渠道监控', icon: Pulse, perm: 'channel.health' },
      { to: '/app/usage', label: '用量管理', icon: ChartBar, perm: 'log.view' },
      { to: '/app/logs', label: '请求日志', icon: TerminalWindow, perm: 'log.view' },
      { to: '/app/audit', label: '审计日志', icon: Detective, perm: 'audit.view' },
    ],
  },
  {
    title: '用户与权限',
    admin: true,
    items: [
      { to: '/app/users', label: '用户管理', icon: Users, perm: 'user.manage' },
      { to: '/app/roles', label: '角色管理', icon: IdentificationBadge, perm: 'role.manage' },
      { to: '/app/api-keys', label: 'API Key 管理', icon: Key, perm: 'apikey.manage' },
      { to: '/app/groups', label: '分组管理', icon: Stack, perm: 'group.manage' },
      { to: '/app/accounts', label: '上游账号', icon: CloudArrowUp, perm: 'account.manage' },
    ],
  },
  {
    title: '计费与商品',
    admin: true,
    items: [
      { to: '/app/orders', label: '订单管理', icon: ShoppingCart, perm: 'order.view' },
      { to: '/app/gift-cards', label: '卡密管理', icon: Gift, perm: 'card.manage' },
      { to: '/app/prices', label: '模型价格', icon: Tag, perm: 'price.manage' },
      { to: '/app/manage-plans', label: '套餐管理', icon: Tag, perm: 'plan.manage' },
      { to: '/app/payment-config', label: '收款配置', icon: Bank, perm: 'setting.manage' },
    ],
  },
  {
    title: '系统',
    admin: true,
    items: [{ to: '/app/settings', label: '系统设置', icon: GearSix, perm: 'setting.manage' }],
  },
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="2.4" />
        <circle cx="19" cy="5.5" r="2.4" />
        <circle cx="19" cy="18.5" r="2.4" />
        <path d="M7.2 11 16.8 6.4M7.2 13l9.6 4.6" />
      </svg>
    </span>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) return;
      try { setUser(await api.get('/api/v1/auth/me')); }
      catch { /* 401 自动跳转 */ }
    })();
  }, []);

  const logout = () => { clearToken(); nav('/login'); };
  const isAdmin = user?.role === 'admin';
  const perms: string[] = user?.permissions || [];
  const hasPerm = (k: string) => isAdmin || perms.includes('*') || perms.includes(k);

  const close = onClose;
  const renderItem = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.to === '/app'} className={({ isActive }) => (isActive ? 'active' : '')} onClick={close}>
      <item.icon size={17} weight="regular" />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <>
      <div className={open ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <BrandMark />
          <div className="brand-name">中转站 Plus<small>AI API 中转管理台</small></div>
        </div>
        <nav>
          {NAV_GROUPS.map((g) => {
            if (g.admin && !isAdmin && !perms.some((p) => p !== '*')) return null;
            const items = g.admin ? g.items.filter((it) => hasPerm(it.perm!)) : g.items;
            if (!items.length) return null;
            return (
              <div className="nav-group" key={g.title}>
                <div className="nav-group-title">{g.title}</div>
                {items.map(renderItem)}
              </div>
            );
          })}
        </nav>
        <div className="foot">
          <div className="user-line">
            <span className="user-email">{user?.email || '未登录'}</span>
            <span className="role-tag">{isAdmin ? '管理员' : '用户'}</span>
          </div>
          <button className="btn btn-sm" onClick={logout}>
            <span>退出登录</span>
            <span className="btn-ic"><SignOut size={13} weight="bold" /></span>
          </button>
        </div>
      </div>
      {open && <div className="sidebar-backdrop" onClick={close} />}
    </>
  );
}

export default function Layout() {
  const [user, setUser] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) return;
      try { setUser(await api.get('/api/v1/auth/me')); } catch { /* 401 自动跳转 */ }
    })();
  }, []);
  // 管理路径 -> 所需权限
  const pathPerms: Record<string, string> = {
    '/app/users': 'user.manage', '/app/orders': 'order.view', '/app/groups': 'group.manage',
    '/app/accounts': 'account.manage', '/app/channel-health': 'channel.health', '/app/api-keys': 'apikey.manage',
    '/app/gift-cards': 'card.manage', '/app/logs': 'log.view', '/app/audit': 'audit.view',
    '/app/usage': 'log.view', '/app/manage-plans': 'plan.manage',
    '/app/prices': 'price.manage', '/app/roles': 'role.manage', '/app/payment-config': 'setting.manage', '/app/settings': 'setting.manage',
  };
  const enteringAdminPath = Object.keys(pathPerms).find((p) => pathname.startsWith(p));
  const isAdmin = user?.role === 'admin';
  const perms = user?.permissions || [];
  const hasPerm = (k: string) => isAdmin || perms.includes('*') || perms.includes(k);
  // 权限守卫：非 admin 访问无权限的管理路径时重定向到自己的仪表盘/我的 Key
  if (enteringAdminPath && user && !hasPerm(pathPerms[enteringAdminPath])) {
    return <Navigate to="/app/keys" replace />;
  }
  return (
    <ToastProvider>
      <div className="app-layout">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <div className="main">
          <button className="nav-toggle" onClick={() => setMenuOpen((v) => !v)} aria-label={menuOpen ? '关闭菜单' : '打开菜单'}>
            {menuOpen ? <X size={18} /> : <List size={18} />}
          </button>
          <Outlet />
        </div>
      </div>
    </ToastProvider>
  );
}
