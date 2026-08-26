import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { requireAuth } from './authMiddleware.js';
import { success, failure } from './respond.js';
import { assertSafeBaseUrl } from '../services/accountService.js';

export const debugRouter: Router = express.Router();

/**
 * 测试 API 连接是否有效。
 * POST /api/v1/debug/test-key { base_url?, api_key, model? }
 * - base_url 留空 = 本平台网关（需填 model 做真实 chat 探测，key = 本平台 sk- key）
 * - base_url 填外部 = 直连外部上游（base_url 无需带 /v1，自动兼容）
 * 通过一次真实 chat/completions 探测（max_tokens 很小，基本不产生费用）。
 */
debugRouter.post('/debug/test-key', requireAuth, async (req, res) => {
  const schema = z.object({
    base_url: z.string().max(300).optional(),
    api_key: z.string().min(3).max(200),
    model: z.string().min(1).max(100).optional(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).max(50).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '请填写 API Key', 400);
  const { api_key } = parsed.data;
  const model = parsed.data.model || 'gpt-4o-mini'; // 留空用默认模型做连通性探测
  const messages = parsed.data.messages?.length ? parsed.data.messages : [{ role: 'user', content: 'ok' }];
  const rawBase = (parsed.data.base_url || '').trim().replace(/\/+$/, '');

  // 构造 chat 端点：外部 base_url 自动补 /v1（若未含）；本平台用容器直连网关
  let chatUrl: string;
  try {
    if (rawBase) {
      assertSafeBaseUrl(rawBase); // SSRF 防护：仅 http/https
      // 额外严格拦截：test-key 是用户可控探测点，即便 ALLOW_LOOPBACK 开启也不放行回环/私网
      const u = new URL(rawBase);
      const host = u.hostname.toLowerCase();
      const blocked = host === 'localhost' || host === '::1' || host === '127.0.0.1' || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host);
      if (blocked) return failure(res, '不允许探测内网/本机地址', 400);
      chatUrl = rawBase.endsWith('/v1') ? `${rawBase}/chat/completions` : `${rawBase}/v1/chat/completions`;
    } else {
      chatUrl = `http://127.0.0.1:${process.env.PORT || 8080}/v1/chat/completions`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'base_url 不合法';
    return failure(res, msg, 400);
  }

  try {
    const cr = await fetch(chatUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: 512 }),
      signal: AbortSignal.timeout(25000),
    });
    const cb = await cr.text();
    const ok = cr.status >= 200 && cr.status < 300;
    const result: any = { ok, status: cr.status };
    if (ok) {
      try {
        const j = JSON.parse(cb);
        result.model = j?.model || j?.id || model;
        // 兼容多模态 content（数组：含 text / image_url 段落）与纯文本
        const c = j?.choices?.[0]?.message?.content;
        if (Array.isArray(c)) {
          result.reply = c.filter((x: any) => x?.type === 'text' && x.text).map((x: any) => x.text).join('\n') || '(模型返回了内容)';
          result.images = c.filter((x: any) => x?.type === 'image_url' && x?.image_url?.url).map((x: any) => x.image_url.url);
        } else if (typeof c === 'string') {
          result.reply = c || '(ok)';
          // 提取 markdown 图片链接（![alt](url) 或裸 http 图片）
          const md = [...c.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]).filter((u) => /^https?:\/\//i.test(u));
          result.images = md.length ? md : undefined;
        } else {
          result.reply = '(ok)';
        }
      } catch { result.reply = '(ok)'; }
    } else {
      result.error = cb.slice(0, 250);
    }
    success(res, result);
  } catch (err) {
    failure(res, '连接失败：' + (err instanceof Error ? err.message : 'unknown'), 400);
  }
});
