import './env.js'; // 加载项目根 .env（单一配置源）
import express from 'express';
import cors from 'cors';
import { basename } from 'path';
import type { Request, Response, NextFunction } from 'express';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { authRouter } from './http/authRoutes.js';
import { apiKeyRouter } from './http/apiKeyRoutes.js';
import { oauthAdminRouter } from './http/oauthAdminRoutes.js';
import { managerAdminRouter } from './http/managerAdminRoutes.js';
import { miscAdminRouter } from './http/miscAdminRoutes.js';
import { gatewayHandler } from './services/gatewayHandler.js';
import { getJwtSecret } from './services/auth.js';
import { billingRouter } from './http/billingRoutes.js';
import { totpRouter } from './http/totpRoutes.js';
import { rolesRouter } from './http/rolesRoutes.js';
import { paymentRouter } from './http/paymentRoutes.js';
import { uploadRouter } from './http/uploadRoutes.js';
import { getUploadDir } from './http/uploadRoutes.js';
import { debugRouter } from './http/debugRoutes.js';
import { publicRouter } from './http/publicRoutes.js';

const app = express();

app.disable('x-powered-by');
// CORS：可用 CORS_ORIGINS（逗号分隔）限定允许的前端来源；未配置则反射同源（仅建议内网/默认）
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'anthropic-version', 'anthropic-beta', 'openai-organization', 'session_id', 'x-stainless-lang', 'chatgpt-config'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
}));
app.use(express.json({ limit: '25mb', verify: (req: any, _res, buf: Buffer) => { req.rawBody = buf; } }));

// ================== 健康检查 ==================
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// ================== 管理 & 用户 API（前缀 /api/v1）==================
const apiRouter = express.Router();
apiRouter.use(publicRouter); // 免登录公开接口（落地页/定价页）
apiRouter.use(authRouter);
apiRouter.use(apiKeyRouter);
apiRouter.use(oauthAdminRouter);
apiRouter.use(managerAdminRouter);
apiRouter.use(miscAdminRouter);
apiRouter.use(billingRouter);
apiRouter.use(totpRouter);
apiRouter.use(rolesRouter);
apiRouter.use(paymentRouter);
apiRouter.use(uploadRouter);
apiRouter.use(debugRouter);
app.use('/api/v1', apiRouter);

// ================== 上传文件静态服务（收款码等图片）==================
app.use('/uploads', express.static(getUploadDir(), { maxAge: '1d' }));

// ================== AI 网关（兼容端点）==================
// 挂载在根路径，透传 /v1/* 到上游。管理接口 /api 已被上面占用，无冲突。
app.all(['/v1/*', '/chat/completions', '/chat/*', '/embeddings', '/responses', '/messages', '/models'], gatewayHandler);

// 未匹配
app.use((_req, res) => {
  res.status(404).json({ code: 404, message: 'Not found', data: null });
});

// 错误处理
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ code: 500, message: 'Internal error', data: null });
});

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  // 启动即校验安全关键配置，避免模糊失败
  getJwtSecret();

  console.log('[boot] connecting to database...');
  await pool.query('SELECT 1');
  console.log('[boot] running migrations...');
  await runMigrations();
  console.log('[boot] seeding admin...');
  await seed();

  const server = app.listen(PORT, HOST, () => {
    console.log(`[boot] relay-plus backend listening on http://${HOST}:${PORT}`);
  });
  server.keepAliveTimeout = 65_000;
  return server;
}

const isMain = basename(process.argv[1] || '').replace(/\.(ts|js|mjs)$/i, '') === 'index';
if (isMain) {
  main().catch((err) => {
    console.error('[fatal] failed to start:', err);
    process.exit(1);
  });
}

export { app, main };
