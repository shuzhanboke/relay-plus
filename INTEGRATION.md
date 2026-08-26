# 中转站 Plus · 接入指南

本指南说明如何把「中转站 Plus」作为统一 AI API 网关接入到你的应用（Node.js / Python / curl / 各类主流 SDK 与智能体框架）。

中转站是 **OpenAI 兼容**的：绝大多数「OpenAI 格式」的客户端/SDK，只需把 `base_url` 指向本中转站、`api_key` 换成你在本台生成的 `sk-` Key 即可直接使用。同时提供 **Anthropic 兼容**端点（`/v1/messages`）供 Claude Code 等接入。

---

## 1. 快速开始

| 项 | 值 |
|---|---|
| 平台地址 | `https://api.shuzhan.one` |
| OpenAI 兼容 Base URL | `https://api.shuzhan.one/v1` |
| Anthropic 兼容 Base URL | `https://api.shuzhan.one` |
| API Key | 登录后台「我的 API Key」页生成 `sk-...` |
| 支持的模型 | 见后台「模型价格」页（gpt-* / claude-* / gemini-* / deepseek-* / grok-* / mistral-* / llama-* / qwen-* 等） |

> 先在后台「上游账号」配置好你有权限的上游（官方 Key 或你的中转上游），并创建「分组」绑定；生成的 `sk-` Key 关联该分组即可转发对应模型。

---

## 2. Node.js 接入（OpenAI SDK）

```bash
npm install openai
```

```js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.shuzhan.one/v1', // 指向本中转站
  apiKey: 'sk-你的Key',                    // 本平台生成的 Key
});

const chat = await client.chat.completions.create({
  model: 'gpt-4o-mini',                   // 或 deepseek-chat / claude-3-7-sonnet 等
  messages: [{ role: 'user', content: '你好，介绍一下自己' }],
});

console.log(chat.choices[0].message.content);
```

**流式：**

```js
const stream = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: '写一首短诗' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

**图片（多模态 vision）：** content 传数组即可：

```js
const chat = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: '这张图里有什么？' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ],
  }],
});
```

---

## 3. Python 接入（openai / anthropic）

```bash
pip install openai anthropic
```

**OpenAI 兼容：**

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.shuzhan.one/v1", api_key="sk-你的Key")
resp = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role":"user","content":"你好"}],
)
print(resp.choices[0].message.content)
```

**Anthropic（Claude）兼容：**

```bash
# Claude Code CLI 用：
export ANTHROPIC_BASE_URL="https://api.shuzhan.one"
export ANTHROPIC_AUTH_TOKEN="sk-你的Key"
```

```python
from anthropic import Anthropic
client = Anthropic(base_url="https://api.shuzhan.one", api_key="sk-你的Key")
resp = client.messages.create(model="claude-3-7-sonnet", max_tokens=1024,
                              messages=[{"role":"user","content":"你好"}])
print(resp.content[0].text)
```

---

## 4. curl 直接调用

```bash
curl https://api.shuzhan.one/v1/chat/completions \
  -H "Authorization: Bearer sk-你的Key" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
```

---

## 5. 对接主流智能体 / 厂商 Idea

- **自定义上游 / 其他厂商**：在后台「上游账号」新建，`平台` 选对应厂商（OpenAI / Claude / Gemini / DeepSeek / Grok / Mistral / Meta Llama / Qwen / Kimi / 智谱 / MiniMax / Custom），`Base URL` 填官方地址（已内置默认），`API Key` 填该厂商 Key，再绑到分组。用户的 `sk-` Key 走该分组即可转发对应模型。
- **Codex / OpenAI 原生客户端**：`base_url = https://api.shuzhan.one/v1`
- **Claude Code**：设置 `ANTHROPIC_BASE_URL` 与 `ANTHROPIC_AUTH_TOKEN`（见上）。
- **多模型统一入口**：一个 `sk-` Key 可绑一个分组；分组内按优先级/并发轮转多个上游，实现负载均衡与故障转移。

---

## 6. 计费说明

- 按模型价格表计费（$ / 1M tokens），用户余额实时扣减。
- 后台「模型价格」页可按供应商查看/编辑官方价与渠道价、上下文窗口、折扣，并支持批量调价。
- 「分组管理」可按分组设置售价倍率（用户实付 = 官方价 × 倍率）。

---

## 7. 常见问题

| 问题 | 解决 |
|---|---|
| 401 Invalid API key | 用本平台生成的 `sk-` Key，非上游 Key |
| 403 model not allowed | 该 Key 的模型白名单未包含 model，或在后台开启 |
| 402 Insufficient balance | 先充值或兑换邀请码/体验额度 |
| 502 upstream error | 上游 Key 无效/超时，或上游账号未配置对 |
| 白屏 | 强制刷新（Ctrl+Shift+R），index.html 已设不缓存 |

---

## 8. 生成 API 接入示例（一键复制）

后台「我的 API Key」页会展示可直接复制的 curl / Node.js 示例。更多 SDK 示例参考 OpenAI 官方文档（本中转站向下兼容）。
