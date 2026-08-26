/**
 * 极简 token 估算器（无需重型分词库）。
 * 中文约 1 token/字，英文约 4 chars/token。对计费够用。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = text.length - cjk;
  return Math.ceil(cjk + nonCjk / 4);
}

/**
 * 从 OpenAI chat/completions 请求体估算本次请求使用的 token。
 * 返回 { promptTokens, cachedTokens, maxCompletionTokens, stream }。
 * cachedTokens 依据 usage.prompt_tokens_details.cached_tokens（上游返回时用真实值）。
 */
export function estimateUsageFromRequest(body: any): {
  promptTokens: number;
  cachedTokens: number;
  maxCompletionTokens: number | null;
} {
  let prompt = 0;
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (typeof m?.content === 'string') {
        prompt += estimateTokens(m.content);
      } else if (Array.isArray(m?.content)) {
        for (const part of m.content) {
          if (typeof part?.text === 'string') prompt += estimateTokens(part.text);
        }
      }
      if (m?.role) prompt += 2;
    }
  }
  if (typeof body?.system === 'string') prompt += estimateTokens(body.system);
  // function/tool definitions
  if (Array.isArray(body?.functions)) for (const f of body.functions) prompt += estimateTokens(JSON.stringify(f));
  if (Array.isArray(body?.tools)) for (const t of body.tools) prompt += estimateTokens(JSON.stringify(t));
  if (typeof body?.input === 'string') prompt += estimateTokens(body.input);

  const maxTokens = typeof body?.max_tokens === 'number' ? body.max_tokens
    : typeof body?.max_completion_tokens === 'number' ? body.max_completion_tokens
    : null;
  return { promptTokens: prompt, cachedTokens: 0, maxCompletionTokens: maxTokens };
}

/** 解析 OpenAI usage 对象（真实计费以它为最终依据）。 */
export function parseOpenAIUsage(usage: any): { prompt: number; completion: number; cached: number; cacheWrite: number } {
  const prompt = Number(usage?.prompt_tokens) || 0;
  const completion = Number(usage?.completion_tokens) || 0;
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens) || 0;
  const cacheWrite = Number(usage?.prompt_tokens_details?.cache_write_tokens) || 0;
  return { prompt, completion, cached, cacheWrite };
}

/**
 * 从 SSE 流文本中提取末尾 usage 数据（真实计费依据）。
 * 兼容两种格式：
 *  1) OpenAI：最后一个 data: chunk 的 JSON 里有 usage 字段
 *     （需客户端传 stream_options:{include_usage:true}，或某些模型默认返回）
 *     usage = { prompt_tokens, completion_tokens, prompt_tokens_details:{cached_tokens, cache_write_tokens?} }
 *  2) Anthropic：message_delta 事件的 usage = { input_tokens, output_tokens, cache_read_input_tokens?, cache_creation_input_tokens? }
 * 返回 null 表示未找到可用 usage。
 */
export function extractStreamUsage(sseText: string): { prompt: number; completion: number; cached: number; cacheWrite: number } | null {
  if (!sseText) return null;
  // 倒序遍历 data: 行，找到第一个含 usage 的 JSON
  const lines = sseText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;
    try {
      const j = JSON.parse(payload);
      // OpenAI 格式：顶层 usage
      if (j?.usage && typeof j.usage === 'object') {
        const u = parseOpenAIUsage(j.usage);
        if (u.prompt > 0 || u.completion > 0) return u;
      }
      // Anthropic 格式：event 类型 message_delta，usage 在 message.usage 或顶层 usage
      if (j?.type === 'message_delta' || (j?.type === 'message_start' && j?.message?.usage)) {
        const usage = j?.message?.usage || j?.usage;
        if (usage && typeof usage === 'object') {
          const prompt = Number(usage.input_tokens) || 0;
          const completion = Number(usage.output_tokens) || 0;
          const cached = Number(usage.cache_read_input_tokens) || 0;
          const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
          if (prompt > 0 || completion > 0) return { prompt, completion, cached, cacheWrite };
        }
      }
    } catch { /* 非 JSON，跳过 */ }
  }
  return null;
}
