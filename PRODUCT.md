# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

两类使用者，两者并重，但以第一类为设计的第一优先：

1. **最终用户（客户）**：购买或使用 API 能力的开发者/个人，自助完成注册、卡密兑换/付费充值、购买订阅套餐、创建自己的 API Key、查看余额与用量。其自助购买与使用体验是产品门面。
2. **站点运营方（管理员）**：经营中转站的人，在后台配置上游账号（OpenAI / Anthropic / 自定义 / OAuth / Codex PAT）、分组、代理、用户、API Key、模型价格、充值套餐、卡密、角色权限、订单、支付配置，并监控渠道健康、日志与仪表盘。

## Product Purpose

自建 AI API 中转站（网关）：把多个上游 AI 能力统一接入一个网关，再向终端用户分发 API Key。平台完成鉴权、按量计费、限流、负载均衡和请求转发，并提供完整管理后台。成功 = 运营方能稳定、低成本地对外提供服务并准确计费，同时为终端用户提供简单顺畅的自助购买与调用体验。

## Positioning

一套可自建（自托管）的 AI API 聚合网关 + 计费 + 管理后台，其管理接口兼容 Sub2API / FlowPilot 的核心对接约定（含 OAuth 批量注册回写），可与 FlowPilot 批量注册工具联动。上游支持多种账号类型（API Key / OAuth / Codex PAT）与分组、代理、优先级 + 轮询的负载均衡，按真实 usage（含 cache tokens）计费，余额不足自动拒绝。

## Operating Context

- 管理员使用后台完成主流程：配置上游账号 → 创建分组并绑定账号 → 创建用户并生成 API Key、充值余额、绑定分组与限流。
- 终端用户通过 `ANTHROPIC_BASE_URL` / OpenAI SDK `base_url` + `sk-` 面版 Key 接入网关调用 `/v1` 兼容端点。
- 后端为 Node.js 22 + TypeScript + Express + pg，数据库 PostgreSQL 16，前端 React 18 + Vite 5 + React Router，原生 `fetch` 流式透传（SSE），部署 Docker Compose + Nginx。
- 计费逻辑参考公开的 Sub2API 设计思想但为独立实现；上游代理等在 token 交换等场景默认为透传直连。

## Capabilities and Constraints

- AI 网关：`/v1/chat/completions`、`/v1/responses`、`/v1/embeddings`、`/v1/models`（OpenAI）、`/v1/messages`（Anthropic）；流式（SSE）透传与非流式 JSON；模型白名单鉴权、负载均衡（优先级 + 轮询）。
- 统一计费：可按模型配置价格（美元 / 1M tokens，支持 `*` 通配）；真实 usage 计费（含 cache tokens）；余额不足自动拒绝。
- 限流：RPM / TPS / TPM / 并发上限。
- 多级用户系统：注册、登录、JWT、admin/user 角色、余额。
- API Key 管理：生成 `sk-` Key（仅明文展示一次）、前缀/尾号识别、启停、过期、限流参数。
- 上游账号池：API Key / OAuth / Codex PAT 类型；可分组成组、可绑定代理、可设并发与优先级。
- FlowPilot / Sub2API 兼容接口：`generate-auth-url`、`exchange-code`、`refresh-token`、`create-from-oauth`、`groups/all`、`proxies/all`、`accounts`；登录接口返回格式与 FlowPilot 一致（顶层 `access_token`）。
- 日志与统计：请求日志、按模型消耗、近 24h 曲线、仪表盘。
- 面向商业自营时需注意：批量注册、共享上游账号可能违反上游平台服务条款，须自行评估风险并控制用量（README 明示的合规提示）。

## Brand Commitments

- 产品名称为「中转站 Plus」（relay-plus），无既定 Logo、配色或品牌资产，视觉方向可以自由构建（用户确认）。

## Evidence on Hand

- 完整可运行的前后端代码（`server/` 后端、`web/` 前端）与部署配置（`docker-compose.yml`、`compose.db.yml`、`web/nginx.conf`、`DEPLOY.md`）。
- 前端页面清单（`web/src/pages/`）与后端接口实现即为产品功能的直接证据。默认管理员账号与安全建议见 README 与 `.env.example`。
- 尚未有已确认的测试用户、公开部署站点、案例或价格承诺等营销证据，后续不得捏造。

## Product Principles

- 计费准确优先：向运营方与终端用户呈现的余额、用量与成本必须可信、可核对。
- 自助顺畅：终端用户的注册、充值、购买与 Key 管理流程应最小步骤完成。
- 管理与运维可靠：后台对上游账号、分组、转发状态（渠道健康）的呈现要清晰可操作。
- 兼容是承诺：对外对接约定（OpenAI / Anthropic / Sub2API / FlowPilot）不得在视觉改版中被破坏。
- 安全默认：Key 明文仅展示一次、余额不足自动拒绝、生产环境强制改密与 HTTPS 等既有安全行为必须保留。

## Accessibility & Inclusion

未确认额外的无障碍标准或特定群体需求。界面文案以中文为主（现行代码即中文 UI）。
