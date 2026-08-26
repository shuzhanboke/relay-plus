import crypto from 'crypto';
import { query, tx } from '../db/pool.js';
import type pg from 'pg';

/** OpenAI Codex CLI 公共 OAuth 客户端（与 Sub2API 一致）。 */
export const OPENAI_OAUTH = {
  clientId: process.env.OPENAI_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: process.env.OPENAI_OAUTH_AUTHORIZE_URL || 'https://auth.openai.com/oauth/authorize',
  tokenUrl: process.env.OPENAI_OAUTH_TOKEN_URL || 'https://auth.openai.com/oauth/token',
  defaultRedirectUri: 'http://localhost:1455/auth/callback',
  scopes: 'openid profile email offline_access',
  sessionTtlMs: 30 * 60 * 1000,
};

export function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generateState(): string {
  return base64url(crypto.randomBytes(24));
}

export function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

export interface OAuthSessionRow {
  session_id: string;
  state: string;
  code_verifier: string;
  redirect_uri: string;
  proxy_id: number | null;
  client_id: string;
  platform: string;
  expires_at: Date;
}

const SESSION_CLEANUP = setInterval(() => {
  query('DELETE FROM oauth_sessions WHERE expires_at < now()').catch(() => {});
}, 5 * 60 * 1000).unref();

/**
 * 生成 OpenAI OAuth 授权 URL（对应 POST /api/v1/admin/openai/generate-auth-url）。
 * 返回 { auth_url, session_id, state }。
 */
export async function generateAuthUrl(input: { redirectUri?: string; proxyId?: number | null; platform?: string; clientId?: string }): Promise<{ auth_url: string; session_id: string; state: string }> {
  const redirectUri = input.redirectUri || OPENAI_OAUTH.defaultRedirectUri;
  const platform = input.platform || 'openai';
  const clientId = input.clientId || OPENAI_OAUTH.clientId;
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + OPENAI_OAUTH.sessionTtlMs);

  await query(
    `INSERT INTO oauth_sessions (session_id, state, code_verifier, redirect_uri, proxy_id, client_id, platform, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [sessionId, state, codeVerifier, redirectUri, input.proxyId ?? null, clientId, platform, expiresAt]
  );

  const u = new URL(OPENAI_OAUTH.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', OPENAI_OAUTH.scopes);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'login');
  u.searchParams.set('source', 'codex');

  return { auth_url: u.toString(), session_id: sessionId, state };
}

export interface ExchangeResult {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  expires_at: number;
  email?: string;
  chatgpt_account_id?: string;
  chatgpt_user_id?: string;
  organization_id?: string;
  plan_type?: string;
  client_id: string;
  account_id?: string; // Sub2API 资源 id（账户创建时写回）
}

/**
 * 用授权码换取 token（对应 POST /api/v1/admin/openai/exchange-code）。
 * 校验 session_id 与 state，然后调用 OpenAI token 端点。
 */
export async function exchangeCode(input: {
  sessionId: string;
  code: string;
  state: string;
  redirectUri?: string;
  proxyId?: number | null;
}): Promise<ExchangeResult> {
  const session = await query<OAuthSessionRow>(
    'SELECT * FROM oauth_sessions WHERE session_id = $1 AND expires_at > now()',
    [input.sessionId]
  );
  const row = session.rows[0];
  if (!row) throw new Error('SESSION_NOT_FOUND');
  if (row.state !== input.state) throw new Error('STATE_MISMATCH');

  const proxy = row.proxy_id ? await query<{ id: number; protocol: string; host: string; port: number; username: string | null; password: string | null }>('SELECT * FROM proxies WHERE id = $1 AND status = $2', [row.proxy_id, 'active']) : null;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: row.client_id,
    code: input.code,
    redirect_uri: input.redirectUri || row.redirect_uri,
    code_verifier: row.code_verifier,
  });

  let tokenUrl = OPENAI_OAUTH.tokenUrl;
  if (proxy && proxy.rowCount && proxy.rows[0]) {
    tokenUrl = proxyTokenUrl(proxy.rows[0], OPENAI_OAUTH.tokenUrl);
  }

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`TOKEN_EXCHANGE_FAILED:${resp.status}`);

  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch { throw new Error('TOKEN_EXCHANGE_BAD_RESPONSE'); }
  const accessToken = data.access_token as string;
  if (!accessToken) throw new Error('TOKEN_EXCHANGE_NO_ACCESS_TOKEN');

  // 尝试从 id_token 里解析邮箱（JWT payload）
  let email: string | undefined;
  try {
    const idToken = data.id_token as string;
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    email = payload?.email || payload?.['https://api.openai.com/auth']?.email;
  } catch { /* 忽略 */ }

  return {
    access_token: accessToken,
    refresh_token: (data.refresh_token as string) || '',
    id_token: (data.id_token as string) || '',
    expires_in: Number(data.expires_in) || 3600,
    expires_at: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
    email,
    client_id: row.client_id,
  };
}

function proxyTokenUrl(proxy: { protocol: string; host: string; port: number }, target: string): string {
  // 说明：Node 原生 fetch（undici）目前不支持自定义代理。
  // 生产环境请通过系统级 HTTP(S)_PROXY 或改用它 (agent) 支持代理的上游客户端。
  // 此处保留占位，返回原 URL（无代理），避免静默失败。
  void proxy;
  return target;
}

/**
 * refresh-token：用 refresh_token 刷新（对应 POST /api/v1/admin/openai/refresh-token）。
 */
export async function refreshToken(input: { refreshToken: string; clientId?: string; proxyId?: number | null }): Promise<ExchangeResult> {
  const clientId = input.clientId || OPENAI_OAUTH.clientId;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: clientId,
  });
  const resp = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`REFRESH_FAILED:${resp.status}`);
  const data = JSON.parse(text) as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) || input.refreshToken,
    id_token: (data.id_token as string) || '',
    expires_in: Number(data.expires_in) || 3600,
    expires_at: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
    client_id: clientId,
  };
}

/**
 * 在事务内创建账号并绑定分组（对应 POST /api/v1/admin/accounts 中 oauth 类型）。
 */
export async function createOpenAIOAuthAccount(
  input: {
    name: string;
    platform: string;
    type: string;
    credentials: Record<string, unknown>;
    extra: Record<string, unknown>;
    proxyId?: number | null;
    concurrency: number;
    priority: number;
    rateMultiplier: number;
    groupIds: number[];
  }
): Promise<{ id: number; name: string }> {
  return tx(async (client) => {
    const res = await client.query<{ id: number }>(
      `INSERT INTO accounts (name, platform, type, base_url, api_key, credentials, extra, proxy_id, concurrency, priority, rate_multiplier, status)
       VALUES ($1,$2,$3,NULL,NULL,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
      [
        input.name, input.platform, input.type,
        JSON.stringify(input.credentials), JSON.stringify(input.extra),
        input.proxyId ?? null, input.concurrency, input.priority, input.rateMultiplier,
      ]
    );
    const id = res.rows[0].id;
    // 绑 group
    for (const gid of input.groupIds) {
      await client.query('INSERT INTO account_groups (account_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, gid]);
    }
    return { id, name: input.name };
  });
}
