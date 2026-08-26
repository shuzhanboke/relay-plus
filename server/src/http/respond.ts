import type { Response } from 'express';

/** 统一管理端响应包裹：{ code:0, data, message }。 */
export function success(res: Response, data: unknown = null, message = 'ok'): void {
  res.json({ code: 0, data, message });
}

export function failure(res: Response, message: string, status = 400, code = 1): void {
  res.status(status).json({ code, message, data: null });
}

export function failFrom(res: Response, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  const status = err instanceof HttpError ? err.status : (<{ status?: number }>err)?.status || 400;
  // ≥500 为内部错误，不回显内部细节（pg 错误、路径等）到客户端，避免信息泄露
  const message = status >= 500 ? 'Internal error' : raw;
  res.status(status).json({ code: status, message, data: null });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function badRequest(msg: string): HttpError { return new HttpError(400, msg); }
export function notFound(msg: string): HttpError { return new HttpError(404, msg); }
export function forbidden(msg: string): HttpError { return new HttpError(403, msg); }
