import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireAuth, requirePerm } from './authMiddleware.js';
import { success, failure } from './respond.js';

export const uploadRouter: Router = express.Router();

// 上传目录：优先取环境变量，默认容器内 /app/uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
export function getUploadDir(): string { return UPLOAD_DIR; }

// 允许的图片类型 -> 扩展名
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};

/**
 * 通用图片上传（base64 data URL）。
 * POST /api/v1/admin/upload { data_uri: "data:image/png;base64,...", folder?: 'payment' }
 * 返回 { url: "/uploads/payment/<name>" }（前端通过同一 origin 访问）
 */
uploadRouter.post('/admin/upload', requireAuth, requirePerm('payment.config'), async (req, res) => {
  const schema = z.object({
    data_uri: z.string().min(1),
    folder: z.string().max(40).regex(/^[a-z0-9_\-]+$/).default('misc'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'data_uri 格式错误', 400);

  const m = parsed.data.data_uri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return failure(res, '需为 base64 data URI 图片', 400);
  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return failure(res, '仅支持 jpg/png/webp/gif 图片', 400);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return failure(res, '图片不能超过 3MB', 400);

  const folder = parsed.data.folder;
  const dir = path.join(UPLOAD_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + ext;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buf);
  const url = `/uploads/${folder}/${name}`;
  success(res, { url });
});
