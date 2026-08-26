import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Pricing from './pages/Pricing';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Groups from './pages/Groups';
import Accounts from './pages/Accounts';
import ChannelHealth from './pages/ChannelHealth';
import Usage from './pages/Usage';
import OrdersAdmin from './pages/OrdersAdmin';
import MyOrders from './pages/MyOrders';
import Profile from './pages/Profile';
import AuditLogs from './pages/AuditLogs';
import Roles from './pages/Roles';
import Charge from './pages/Charge';
import PaymentConfig from './pages/PaymentConfig';
import ApiKeys from './pages/ApiKeys';
import Logs from './pages/Logs';
import ModelPrices from './pages/ModelPrices';
import ManagePlans from './pages/ManagePlans';
import Settings from './pages/Settings';
import OwnKeys from './pages/OwnKeys';
import Redeem from './pages/Redeem';
import GiftCards from './pages/GiftCards';
import MyLogs from './pages/MyLogs';
import TotpSettings from './pages/TotpSettings';
import Affiliate from './pages/Affiliate';
import { getToken } from './api';

export default function App() {
  const authed = !!getToken();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pricing" element={<Pricing />} />
      {/* 官网根路径：已登录进入控制台，未登录展示落地页 */}
      <Route path="/" element={authed ? <Navigate to="/app" replace /> : <Landing />} />
      {/* 控制台（用户自助 + 管理后台） */}
      <Route path="/app" element={authed ? <Layout /> : <Navigate to="/login" replace />}>
        <Route index element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="groups" element={<Groups />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="channel-health" element={<ChannelHealth />} />
        <Route path="usage" element={<Usage />} />
        <Route path="orders" element={<OrdersAdmin />} />
        <Route path="my-orders" element={<MyOrders />} />
        <Route path="profile" element={<Profile />} />
        <Route path="audit" element={<AuditLogs />} />
        <Route path="roles" element={<Roles />} />
        <Route path="charge" element={<Charge />} />
        <Route path="payment-config" element={<PaymentConfig />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="logs" element={<Logs />} />
        <Route path="prices" element={<ModelPrices />} />
        <Route path="manage-plans" element={<ManagePlans />} />
        <Route path="settings" element={<Settings />} />
        <Route path="keys" element={<OwnKeys />} />
        <Route path="redeem" element={<Redeem />} />
        <Route path="gift-cards" element={<GiftCards />} />
        <Route path="my-logs" element={<MyLogs />} />
        <Route path="totp" element={<TotpSettings />} />
        <Route path="affiliate" element={<Affiliate />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
