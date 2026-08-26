import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin, requirePerm } from './authMiddleware.js';
import { success, failure, failFrom } from './respond.js';
import { generateAuthUrl, exchangeCode, refreshToken, createOpenAIOAuthAccount } from '../services/oauthService.js';

export const oauthAdminRouter: Router = express.Router();

// ---- 生成 OAuth 授权链接（FlowPilot Step 1）----
// POST /api/v1/admin/openai/generate-auth-url
oauthAdminRouter.post('/admin/openai/generate-auth-url', requireAuth, requirePerm('oauth.manage'), async (req, res) => {
  const schema = z.object({
    proxy_id: z.number().int().positive().nullish(),
    redirect_uri: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const result = await generateAuthUrl({
      redirectUri: parsed.data.redirect_uri || undefined,
      proxyId: parsed.data.proxy_id ?? null,
      platform: 'openai',
    });
    success(res, result);
  } catch (err) { failFrom(res, err); }
});

// ---- 用授权码交换凭据（FlowPilot Step 10 first half）----
// POST /api/v1/admin/openai/exchange-code
oauthAdminRouter.post('/admin/openai/exchange-code', requireAuth, requirePerm('oauth.manage'), async (req, res) => {
  const schema = z.object({
    session_id: z.string().min(1),
    code: z.string().min(1),
    state: z.string().min(1),
    redirect_uri: z.string().optional(),
    proxy_id: z.number().int().positive().nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload: session_id/code/state required', 400);
  try {
    const info = await exchangeCode({
      sessionId: parsed.data.session_id,
      code: parsed.data.code,
      state: parsed.data.state,
      redirectUri: parsed.data.redirect_uri || undefined,
      proxyId: parsed.data.proxy_id ?? null,
    });
    success(res, info);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'exchange failed';
    if (msg === 'SESSION_NOT_FOUND') return failure(res, 'OAuth session expired or not found', 404);
    if (msg === 'STATE_MISMATCH') return failure(res, 'OAuth state mismatch', 400);
    if (msg.startsWith('TOKEN_EXCHANGE_FAILED')) return failure(res, 'Failed to exchange code with provider', 502);
    failFrom(res, err);
  }
});

// ---- 刷新 token ----
// POST /api/v1/admin/openai/refresh-token
oauthAdminRouter.post('/admin/openai/refresh-token', requireAuth, requirePerm('oauth.manage'), async (req, res) => {
  const schema = z.object({
    refresh_token: z.string().optional(),
    rt: z.string().optional(),
    client_id: z.string().optional(),
    proxy_id: z.number().int().positive().nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const refreshTokenValue = parsed.data.refresh_token || parsed.data.rt || '';
  if (!refreshTokenValue) return failure(res, 'refresh_token is required', 400);
  try {
    const info = await refreshToken({ refreshToken: refreshTokenValue, clientId: parsed.data.client_id, proxyId: parsed.data.proxy_id ?? null });
    success(res, info);
  } catch (err) { failFrom(res, err); }
});

// ---- 直接以 OAuth 结果创建账号 ----
// POST /api/v1/admin/openai/create-from-oauth
oauthAdminRouter.post('/admin/openai/create-from-oauth', requireAuth, requirePerm('oauth.manage'), async (req, res) => {
  const schema = z.object({
    session_id: z.string().min(1),
    code: z.string().min(1),
    state: z.string().min(1),
    redirect_uri: z.string().optional(),
    proxy_id: z.number().int().positive().nullish(),
    name: z.string().optional(),
    concurrency: z.number().int().nonnegative().optional(),
    priority: z.number().int().nonnegative().optional(),
    group_ids: z.array(z.number().int().positive()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const info = await exchangeCode({
      sessionId: parsed.data.session_id, code: parsed.data.code, state: parsed.data.state,
      redirectUri: parsed.data.redirect_uri || undefined, proxyId: parsed.data.proxy_id ?? null,
    });
    const credentials: Record<string, unknown> = {
      access_token: info.access_token,
      refresh_token: info.refresh_token || undefined,
      id_token: info.id_token || undefined,
      expires_at: info.expires_at,
      email: info.email || undefined,
    };
    const name = parsed.data.name || info.email || 'OpenAI OAuth Account';
    const account = await createOpenAIOAuthAccount({
      name, platform: 'openai', type: 'oauth',
      credentials, extra: info.email ? { email: info.email } : {},
      proxyId: parsed.data.proxy_id ?? null,
      concurrency: parsed.data.concurrency ?? 1,
      priority: parsed.data.priority ?? 1,
      rateMultiplier: 1,
      groupIds: parsed.data.group_ids || [],
    });
    success(res, account);
  } catch (err) { failFrom(res, err); }
});

// ---- 分组列表（FlowPilot getGroupsByNames 用）----
// GET /api/v1/admin/groups/all?platform=openai
oauthAdminRouter.get('/admin/groups/all', requireAuth, requirePerm('oauth.manage'), async (req, res) => {
  try {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : null;
    const rows = await query(
      `SELECT id, name, platform, description, created_at FROM groups ${platform ? 'WHERE platform = $1' : ''} ORDER BY id ASC`,
      platform ? [platform] : []
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// ---- 代理列表（FlowPilot resolveSub2ApiProxy 用）----
// GET /api/v1/admin/proxies/all?with_count=true
oauthAdminRouter.get('/admin/proxies/all', requireAuth, requirePerm('oauth.manage'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, protocol, host, port, status, created_at FROM proxies ORDER BY id ASC`
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});
