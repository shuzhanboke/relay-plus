// 轻量 API 客户端：统一处理 JWT 存储与 {code,data} 响应包裹。

const TOKEN_KEY = 'relay_plus_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const isFormData = options.body instanceof FormData;
  if (isFormData) delete headers['Content-Type'];

  let res: Response;
  try {
    res = await fetch(path, { ...options, headers, ...(isFormData ? { body: options.body } : {}) });
  } catch {
    throw new ApiError(0, '网络请求失败');
  }

  const text = await res.text();
  let payload: any = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (res.status === 401 && !path.startsWith('/api/v1/auth/login')) {
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(401, '登录已过期');
  }

  if (!res.ok) {
    const msg = payload?.message || payload?.error?.message || `请求失败 (${res.status})`;
    throw new ApiError(res.status, msg);
  }

  // 兼容两种包裹：{code:0,data} 或直接对象
  if (payload && typeof payload === 'object' && 'code' in payload && payload.code === 0) {
    return payload.data as T;
  }
  return payload as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T = any>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
};
