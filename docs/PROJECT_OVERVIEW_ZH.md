# OpenClaw for Paper Research 项目说明文档

生成时间：2026-04-16

## 1. 项目定位

当前仓库是一个基于 FastAPI 的个人研究助手原型，项目名为 `OpenClaw for Paper Research`。它并不是单纯的论文搜索脚本，而是一个组合型后端系统：

- 以企业微信作为轻量消息入口，支持文本、语音消息、提醒创建、确认、查询和研究状态通知。
- 以移动端 API 作为提醒和语音转写入口，支持配对码、JWT access token、refresh token。
- 以本地 Research UI 作为主要研究操作界面，支持创建研究任务、规划方向、多轮探索、论文检索、全文处理、引文图构建、论文保存和导出。
- 以 OpenClaw/Ollama/模板回退构成 LLM 能力层，用于意图识别、回复生成、研究方向规划、论文要点总结。
- 以 SQLite + SQLAlchemy 存储用户、消息、提醒、研究任务、论文、全文、图谱快照和异步任务队列。

从代码结构看，项目当前更像一个“可运行的研究助手 MVP/原型系统”。其中 `research` 模块已经明显成为最大业务域，后续改造时建议优先围绕这个模块拆分边界。

## 2. 技术栈概览

主要技术栈：

- Python 3.10+
- FastAPI / Starlette：HTTP API、Webhook、内嵌本地 UI
- SQLAlchemy 2.x：ORM 与 SQLite 持久化
- Alembic：数据库迁移脚本
- APScheduler：后台调度提醒和内部 research job
- httpx / requests：外部 HTTP 调用
- pydantic / pydantic-settings：配置和请求响应模型
- PyJWT / passlib：移动端认证相关能力
- wechatpy：企业微信回调加解密
- faster-whisper / av：本地语音识别链路
- PyMuPDF / pdfminer.six：PDF 全文解析
- networkx：图谱指标计算
- OpenClaw / Ollama：LLM 能力提供方
- pytest：自动化测试

默认数据库为 SQLite，配置项是 `DB_URL=sqlite:///./memomate.db`。默认应用端口是 `8000`。

## 3. 仓库结构

```text
OpenClaw-for-paper-research/
├── app/
│   ├── api/              # FastAPI 路由：wechat、mobile、health、research、admin、dev、research_ui
│   ├── core/             # 配置、日志、时区工具
│   ├── domain/           # SQLAlchemy 模型、枚举、Pydantic schema
│   ├── infra/            # DB session、Repository、企业微信 client
│   ├── llm/              # OpenClaw/Ollama client、provider、prompt 文件
│   ├── services/         # 核心业务服务
│   └── workers/          # 提醒分发器、research worker
├── docs/                 # 已有架构/演示/LLM 调优文档，本文件也放在这里
├── migrations/           # Alembic 迁移脚本
├── scripts/              # PowerShell 启动、测试、隧道、LLM 调试脚本
├── tests/                # 单元测试和集成测试
├── .env.example          # 配置模板
├── alembic.ini
├── README.md
└── requirements.txt
```

代码体量上，`app/` 下约有 46 个文件，`tests/` 下约有 23 个测试文件。当前最重的文件包括：

- `app/services/research_service.py`：约 3029 行，是 research 业务核心中枢。
- `app/infra/repos.py`：约 1429 行，集中放置所有仓储类。
- `app/api/research_ui.py`：约 824 行，内嵌 HTML/CSS/JS 本地研究界面。
- `app/api/admin.py`：约 641 行，包含本地管理 API 与 HTML 页面。
- `app/api/research.py`：约 622 行，包含 research REST API。
- `app/domain/schemas.py`：约 537 行，集中定义请求/响应 schema。
- `app/services/research_command_service.py`：约 477 行，处理企业微信 research 命令。

这说明后续重构时，主要复杂度不在入口文件，而集中在 `research_service.py`、`repos.py`、`research_ui.py` 和 `admin.py`。

## 4. 应用启动链路

应用入口是 `app/main.py`。

启动时会执行以下工作：

1. 调用 `setup_logging()` 初始化日志。
2. 读取 `.env` 和默认配置，生成全局 `settings`。
3. 在 FastAPI lifespan 中调用 `init_db()`，根据 SQLAlchemy 模型创建表。
4. 初始化外部 client：
   - `WeComClient`
   - `OllamaClient`
   - `OpenClawClient`
5. 根据配置构造 Provider 链：
   - intent providers
   - reply providers
   - ASR providers
6. 初始化业务服务：
   - `AsrService`
   - `ReplyRenderer`
   - `ReplyGenerationService`
   - `IntentService`
   - `ConfirmService`
   - `ReminderService`
   - `ResearchService`
   - `ResearchCommandService`
   - `MobileAuthService`
   - `MessageIngestService`
   - `SchedulerService`
7. 将这些服务挂到 `app.state`，供路由依赖注入使用。
8. 启动 APScheduler。
9. 注册所有 router。

注册的 router 包括：

- `/wechat`
- `/api/v1/health`
- `/api/v1/capabilities`
- `/api/v1/auth/*`
- `/api/v1/reminders/*`
- `/api/v1/asr/transcribe`
- `/api/v1/research/*`
- `/research/ui`
- `/api/v1/dev/*`
- `/admin`
- `/api/v1/admin/*`

## 5. 配置体系

配置集中在 `app/core/config.py` 的 `Settings` 类中，通过 `pydantic-settings` 从 `.env` 读取。

主要配置分组如下：

- 应用配置：`APP_NAME`、`APP_ENV`、`APP_HOST`、`APP_PORT`、`LOG_LEVEL`
- 数据库配置：`DB_URL`
- 调度配置：`SCHEDULER_INTERVAL_SECONDS`、`REMINDER_RETRY_MINUTES`
- 企业微信配置：`WECOM_TOKEN`、`WECOM_AES_KEY`、`WECOM_CORP_ID`、`WECOM_AGENT_ID`、`WECOM_SECRET`
- Ollama 配置：`OLLAMA_BASE_URL`、`OLLAMA_MODEL`、温度、超时
- LLM provider 配置：`INTENT_PROVIDER`、`REPLY_PROVIDER`、fallback 开关和顺序
- OpenClaw 配置：`OPENCLAW_ENABLED`、`OPENCLAW_BASE_URL`、`OPENCLAW_GATEWAY_TOKEN`、`OPENCLAW_AGENT_ID`、CLI fallback
- ASR 配置：本地 whisper、外部讯飞占位、fallback
- 移动端认证配置：`JWT_SECRET`、`ACCESS_TOKEN_MINUTES`、`REFRESH_TOKEN_DAYS`
- research 配置：是否启用、队列模式、worker、方向数量、检索数量、缓存、全文、图谱、探索轮次、导出路径
- Cloudflare tunnel 配置：用于企业微信回调地址暴露

默认 `.env.example` 中 `OPENCLAW_ENABLED=false`、`RESEARCH_ENABLED=false`。如果要运行完整 research 功能，至少需要打开：

```env
OPENCLAW_ENABLED=true
RESEARCH_ENABLED=true
RESEARCH_QUEUE_MODE=worker
```

如果只想先跑本地 Research UI，可以先不配置企业微信真实凭据，但涉及消息推送、导出文件发送、语音下载时仍会依赖企业微信配置。

## 6. 分层说明

### 6.1 API 层

API 层位于 `app/api/`。

主要文件职责：

- `wechat.py`：企业微信 URL 验证和消息接收，负责解密回调 XML，然后把文本或语音消息交给 `MessageIngestService`。
- `mobile.py`：移动端认证、提醒 CRUD、日历视图、音频上传转写。
- `health.py`：健康检查和能力查询，聚合 DB、scheduler、WeCom、ASR、LLM、OpenClaw、research metrics。
- `research.py`：research REST API，依赖移动端 Bearer token 识别用户。
- `research_ui.py`：内嵌本地研究 UI，路径是 `/research/ui`。
- `dev.py`：本地开发 token 和用户列表，限制 localhost 访问。
- `admin.py`：本地管理后台页面和 `/api/v1/admin/*` API，限制 localhost 访问。

### 6.2 Domain 层

Domain 层位于 `app/domain/`。

主要文件：

- `models.py`：SQLAlchemy 数据库模型。
- `schemas.py`：Pydantic 请求/响应模型。
- `enums.py`：业务枚举。

当前模型分为几大类：

- 用户与消息：`User`、`InboundMessage`
- 待确认动作：`PendingAction`
- 提醒：`Reminder`、`DeliveryLog`
- 移动端认证：`MobileDevice`、`RefreshToken`
- 语音：`VoiceRecord`
- Research：`ResearchTask`、`ResearchDirection`、`ResearchSeedPaper`、`ResearchPaper`、`ResearchJob`、`ResearchSession`、`ResearchSearchCache`、`ResearchPaperFulltext`、`ResearchCitationEdge`、`ResearchGraphSnapshot`、`ResearchRound`、`ResearchRoundCandidate`、`ResearchRoundPaper`、`ResearchCitationFetchCache`

### 6.3 Infra 层

Infra 层位于 `app/infra/`。

主要职责：

- `db.py`：创建 engine、sessionmaker、`session_scope()`、FastAPI `get_db()`。
- `repos.py`：集中封装所有业务表的 CRUD 和查询。
- `admin_repo.py`：管理后台专用聚合查询。
- `wecom_client.py`：企业微信 token 获取、文本发送、文件发送、素材下载。

目前 `repos.py` 体量较大，包含所有 repo 类。后续如果要增强可维护性，建议按业务域拆分，比如 `user_repo.py`、`reminder_repo.py`、`research_repo/`。

### 6.4 Service 层

Service 层位于 `app/services/`。

主要服务：

- `MessageIngestService`：统一处理企业微信/管理聊天入口的文本和语音消息。
- `IntentService`：调用 LLM provider 识别提醒意图，并做 fallback 解析和归一化。
- `ConfirmService`：生成 pending action，解析用户确认/取消。
- `ReminderService`：创建、更新、删除、查询提醒。
- `SchedulerService`：定时分发提醒，也可以在 internal 队列模式下处理 research job。
- `ReplyGenerationService`：调用回复 provider 生成自然语言回复，并校验必要事实。
- `ReplyRenderer`：确定性回复模板。
- `AsrService`：语音转写，支持本地和外部 provider fallback。
- `MobileAuthService`：JWT access/refresh token 生成、校验和刷新。
- `AdminService`：管理后台聚合和操作。
- `ResearchCommandService`：企业微信 research 命令解析。
- `ResearchService`：research 核心业务中枢。

### 6.5 LLM 层

LLM 层位于 `app/llm/`。

主要组成：

- `openclaw_client.py`：封装 OpenClaw HTTP gateway 调用和 CLI fallback。
- `ollama_client.py`：封装本地 Ollama `/api/generate` 调用。
- `providers.py`：定义 intent/reply provider 协议，以及 Ollama/OpenClaw/external provider 实现。
- `prompts/intent_v1.txt`：意图识别 prompt。
- `prompts/reply_nlg_v1.txt`：回复生成 prompt。

OpenClaw 支持的任务类型包括：

- `intent_parse`
- `research_plan`
- `abstract_summarize`
- `paper_keypoints`

当前 external provider 主要是占位实现，配置检查存在，但实际调用尚未完成。

## 7. 核心业务流程

### 7.1 企业微信文本消息流程

入口：

```text
POST /wechat
```

流程：

1. `wechat.py` 解密企业微信消息。
2. 解析 XML，识别消息类型。
3. 文本消息交给 `MessageIngestService.process_text_message()`。
4. `MessageIngestService` 根据 `wecom_user_id` 获取或创建用户。
5. 写入 `inbound_messages`，用 `wecom_msg_id` 去重。
6. 判断是否是移动端配对命令。
7. 判断是否是 research 命令。
8. 如果有 pending action，则解析用户确认/取消。
9. 如果是普通提醒消息，调用 `IntentService` 解析意图。
10. 查询类意图直接返回提醒摘要。
11. 新增/删除/更新类意图先创建 `PendingAction`，然后回复确认文案。

### 7.2 企业微信语音消息流程

入口同样是 `/wechat`。

流程：

1. 如果企业微信回调中已经带有 `Recognition` 字段，则直接使用该文本。
2. 如果没有识别文本，则通过 `WeComClient.download_media()` 下载音频。
3. 交给 `AsrService.transcribe_wecom_media()`。
4. 本地 ASR provider 会使用 faster-whisper，并可能调用 ffmpeg 转换音频。
5. 转写结果写入 `voice_records`。
6. 转写文本继续走普通文本消息流程。

### 7.3 提醒流程

提醒相关数据表：

- `reminders`
- `deliveries`
- `pending_actions`

流程：

1. 用户发消息，例如“明天早上 9 点提醒我开会”。
2. LLM 解析为 `IntentDraft`。
3. 系统回复确认文案。
4. 用户确认后，`ReminderService.apply_confirmed_draft()` 写入提醒。
5. `SchedulerService` 定期调用 `Dispatcher.dispatch_due()`。
6. `Dispatcher` 查询到期提醒，调用 `WeComClient.send_text()` 发送消息。
7. 发送结果写入 `deliveries`。
8. 对周期性提醒，根据 RRULE 计算下一次执行时间。

## 8. Research 模块说明

Research 是当前项目最复杂的业务域。

### 8.1 Research 目标

Research 模块的目标是把“搜索论文”升级为一个持续迭代的研究流程：

```text
Topic
  -> 初始方向规划
  -> 每个方向检索论文
  -> 用户反馈
  -> 生成下一轮候选方向
  -> 选择候选并继续检索
  -> 全文解析
  -> 引文图构建
  -> 保存/导出/总结
```

### 8.2 Research 数据模型

核心表：

- `research_tasks`：研究任务主体，保存 topic、constraints、status。
- `research_directions`：初始研究方向，每个方向有名称、queries、exclude terms、论文数量。
- `research_seed_papers`：规划方向前的种子论文语料，用于让 LLM 基于真实论文归纳方向。
- `research_papers`：检索到的论文，包含标题、作者、年份、venue、DOI、URL、abstract、方法摘要、保存状态、要点总结状态。
- `research_rounds`：用户驱动的探索轮次，记录 action、feedback、query terms、深度和父轮次。
- `research_round_candidates`：某一轮 propose 出来的候选方向。
- `research_round_papers`：轮次与论文的映射。
- `research_paper_fulltext`：论文全文抓取、PDF 路径、文本路径、解析状态、质量分。
- `research_citation_edges`：引用/被引边。
- `research_graph_snapshots`：树图或引文图快照。
- `research_search_cache`：检索缓存。
- `research_citation_fetch_cache`：引文 provider 抓取缓存。
- `research_jobs`：异步任务队列表，支持 lease、heartbeat、retry、worker reclaim。
- `research_sessions`：用户当前活动任务、方向、分页状态。

### 8.3 Research Job 类型

当前枚举 `ResearchJobType` 包括：

- `plan`：规划研究方向。
- `search`：按方向或轮次检索论文。
- `fulltext`：抓取和解析全文。
- `graph_build`：构建树图或引文图。
- `paper_summary`：总结单篇论文要点。

Job 状态：

- `queued`
- `running`
- `done`
- `failed`

### 8.4 Research 队列模式

配置项：

```env
RESEARCH_QUEUE_MODE=worker
```

支持两种模式：

- `internal`：由 FastAPI 进程中的 `SchedulerService` 定时调用 `ResearchService.process_one_job()`。
- `worker`：由独立进程 `app.workers.research_worker` 轮询数据库 job 队列。

当前 README 和脚本更推荐 `worker` 模式，因为 research job 可能执行较久，包含外部检索、LLM 调用、PDF 下载和图构建。

Worker 机制：

1. `research_worker.py` 启动后创建 `worker_id`。
2. 按 `RESEARCH_WORKER_POLL_SECONDS` 轮询。
3. 每轮最多处理 `RESEARCH_WORKER_CONCURRENCY` 个 job。
4. 使用 `ResearchJobRepo.claim_next()` 抢占 job。
5. claim 时写入 `worker_id` 和 `lease_until`。
6. 长任务执行时通过 heartbeat 延长 lease。
7. 如果 worker 崩溃，lease 过期后其他 worker 可 reclaim。
8. 失败后按最大重试次数和指数退避重新排队。

### 8.5 Research 规划流程

创建任务时：

1. API 或企业微信命令调用 `ResearchService.create_task()`。
2. 系统写入 `research_tasks`。
3. 同时写入一个 `PLAN` job。
4. 设置用户 `research_sessions.active_task_id`。

执行 `PLAN` job 时：

1. `ResearchService._build_seed_corpus_for_task()` 根据 topic 先检索种子论文。
2. 种子来源包括 Semantic Scholar 和 arXiv。
3. 对种子论文去重后写入 `research_seed_papers`。
4. `ResearchService._plan_directions_from_seed()` 基于种子论文构造 prompt。
5. 调用 OpenClaw 生成方向 JSON。
6. 如果 LLM 失败或输出不合规，则 fallback 到 `ResearchService._plan_directions()`。
7. 如果仍失败，则使用 `_fallback_directions()`。
8. 方向写入 `research_directions`。
9. 任务状态更新为 `created`。

### 8.6 Research 检索流程

检索入口包括：

- REST API：`POST /api/v1/research/tasks/{task_id}/search`
- 企业微信命令：研究检索/选择/继续
- 探索轮次选择后触发的 child round search

执行 `SEARCH` job 时：

1. 读取任务 constraints。
2. 合并 payload 中的 override，例如年份、来源、topN。
3. 找到对应 direction。
4. 如果是 round search，则读取 round 的 query terms，并更新 round 状态为 running。
5. 如果不是 round search，则使用 direction 的 queries。
6. 对每个 query 合并 exclude terms。
7. 依次调用 Semantic Scholar 和 arXiv。
8. 通过 `research_search_cache` 进行 TTL 缓存。
9. 合并所有来源结果。
10. 按 DOI 和标题归一化去重。
11. 为每篇论文生成轻量方法摘要。
12. 如果是普通方向检索，则替换该方向论文。
13. 如果是轮次检索，则 upsert 到方向论文，并写入 `research_round_papers`。
14. 更新 direction 的论文数量。
15. 任务状态更新为 `done`。

### 8.7 多轮探索流程

核心动作枚举：

- `expand`：扩展邻近方向。
- `deepen`：深入当前方向。
- `pivot`：转向新角度。
- `converge`：收敛到核心问题。
- `stop`：停止。

REST API：

- `POST /api/v1/research/tasks/{task_id}/explore/start`
- `POST /api/v1/research/tasks/{task_id}/explore/rounds/{round_id}/propose`
- `POST /api/v1/research/tasks/{task_id}/explore/rounds/{round_id}/select`
- `POST /api/v1/research/tasks/{task_id}/explore/rounds/{round_id}/next`
- `GET /api/v1/research/tasks/{task_id}/explore/tree`

流程：

1. `explore/start` 为某个 direction 创建 Round-1，并提交 search job。
2. 用户输入反馈和 action。
3. `propose` 调用 OpenClaw 生成若干候选方向，写入 `research_round_candidates`。
4. 用户选择 candidate。
5. `select` 创建子 round，并把 candidate queries 用于新一轮检索。
6. `next` 支持用户用自然语言直接进入下一轮，系统会从 intent 文本生成 queries。
7. `explore/tree` 返回 Topic -> Direction -> Round -> Paper 的树图数据。

### 8.8 全文处理流程

REST API：

- `POST /api/v1/research/tasks/{task_id}/fulltext/build`
- `POST /api/v1/research/tasks/{task_id}/fulltext/retry`
- `GET /api/v1/research/tasks/{task_id}/fulltext/status`
- `POST /api/v1/research/tasks/{task_id}/papers/{paper_id}/pdf/upload`

执行 `FULLTEXT` job 时：

1. 遍历任务下论文。
2. 跳过已解析且未强制刷新的论文。
3. 设置全文状态为 `fetching`。
4. 尝试根据论文 URL、候选 PDF 链接下载 PDF。
5. 下载失败则标记为 `need_upload`。
6. 下载成功后保存到 `RESEARCH_ARTIFACT_DIR/{task_id}/fulltext/`。
7. 使用 PyMuPDF 或 pdfminer 解析文本。
8. 提取轻量 sections。
9. 估算文本质量分。
10. 写入 PDF 路径、txt 路径、字符数、parser、质量分和状态。
11. 解析失败则仍保留 PDF，并标记 `need_upload`。

手动上传 PDF 后，会立即解析并写入 `research_paper_fulltext`。

### 8.9 引文图和树图流程

REST API：

- `POST /api/v1/research/tasks/{task_id}/graph/build`
- `POST /api/v1/research/tasks/{task_id}/explore/rounds/{round_id}/citation/build`
- `GET /api/v1/research/tasks/{task_id}/graph`
- `GET /api/v1/research/tasks/{task_id}/graph/snapshots`
- `GET /api/v1/research/tasks/{task_id}/graph/view`

图类型：

- `tree`：Topic -> Direction -> Round -> Paper。
- `citation`：Topic/Direction/Paper + 引用/被引边。

引文 provider 顺序：

1. Semantic Scholar
2. OpenAlex
3. Crossref

构建 citation graph 时：

1. 根据 task/direction/round 确定 seed papers。
2. 为 topic 和 direction 建立基础节点。
3. 为 seed papers 建立论文节点。
4. 对每篇 seed paper 依次调用 citation provider。
5. 成功获取邻居后构建引用/被引边。
6. 使用 cache 减少重复抓取。
7. 使用 networkx 计算图统计指标，如组件数、中心性分数。
8. 写入 `research_citation_edges`。
9. 写入 `research_graph_snapshots`。

### 8.10 论文保存、导出和总结

相关 API：

- `GET /api/v1/research/tasks/{task_id}/papers`
- `GET /api/v1/research/tasks/{task_id}/papers/saved`
- `GET /api/v1/research/tasks/{task_id}/papers/{paper_id}`
- `POST /api/v1/research/tasks/{task_id}/papers/{paper_id}/save`
- `POST /api/v1/research/tasks/{task_id}/papers/{paper_id}/summarize`
- `GET /api/v1/research/tasks/{task_id}/export`

保存论文时：

- 生成 Markdown 文件。
- 生成 BibTeX 文件。
- 标记 `research_papers.saved=true`。
- 写入保存路径和保存时间。

导出任务时支持：

- `md`
- `bib`
- `json`

论文总结时：

1. 提交 `PAPER_SUMMARY` job。
2. 优先读取全文 txt。
3. 如果没有全文，则使用 abstract。
4. 调用 OpenClaw 生成 5-8 条关键要点。
5. 写回 `research_papers.key_points`、状态和来源。

## 9. 本地 Research UI

本地 UI 路径：

```text
http://127.0.0.1:8000/research/ui
```

UI 是内嵌在 `app/api/research_ui.py` 的 HTML/CSS/JS 页面。它会通过 `/api/v1/dev/token` 获取 localhost-only 的开发 token，然后调用 research API。

主要功能：

- 切换本地用户。
- 创建研究任务。
- 刷新任务列表。
- 查看方向列表。
- 开始某方向探索。
- 输入反馈，继续调研或生成候选。
- 查看树图。
- 显示论文节点。
- 保存论文。
- 查看已保存论文。
- 查看日志。

图渲染依赖 CDN 上的 Cytoscape。

后续如果要做正式前端，建议把这块从 Python 字符串中迁移出去，至少拆成静态文件；如果要长期维护，建议改为单独前端工程。

## 10. 移动端和认证

移动端 API 前缀为：

```text
/api/v1
```

认证流程：

1. 用户在企业微信发送配对命令。
2. `MessageIngestService` 生成 6 位配对码，写入 `mobile_devices`。
3. 移动端调用 `POST /api/v1/auth/pair`，提交 `pair_code` 和 `device_id`。
4. 后端签发 access token 和 refresh token。
5. refresh token 的 hash 写入 `refresh_tokens`。
6. 后续移动端请求使用 `Authorization: Bearer <access_token>`。
7. access token 过期后调用 `POST /api/v1/auth/refresh`。

注意：

- `JWT_SECRET` 在 `.env.example` 里是弱默认值，部署或对外暴露前必须更换。
- refresh token 会按设备维度撤销旧 token。

## 11. Admin 和 Dev 接口

Admin 页面：

- `/admin`
- `/admin/users`
- `/admin/users/{user_id}`
- `/admin/chat`

Admin API：

- `/api/v1/admin/overview`
- `/api/v1/admin/scheduler/dispatch-once`
- `/api/v1/admin/users`
- `/api/v1/admin/users/{user_id}/overview`
- `/api/v1/admin/users/{user_id}/reminders`
- `/api/v1/admin/users/{user_id}/pending-actions`
- `/api/v1/admin/users/{user_id}/inbound-messages`
- `/api/v1/admin/users/{user_id}/voice-records`
- `/api/v1/admin/users/{user_id}/deliveries`
- `/api/v1/admin/users/{user_id}/devices`
- `/api/v1/admin/reminders/{reminder_id}/cancel`
- `/api/v1/admin/reminders/{reminder_id}/retry`
- `/api/v1/admin/reminders/{reminder_id}/snooze`
- `/api/v1/admin/chat/send`

Admin 和 Dev 接口均通过请求来源限制为 localhost 或 testclient。

Dev API：

- `POST /api/v1/dev/token`
- `GET /api/v1/dev/users`

Dev token 用于本地 Research UI，不应暴露到公网。

## 12. 启动方式

### 12.1 安装依赖

推荐创建独立环境：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

项目脚本默认会读取 `.env` 中的 `CONDA_ENV_NAME`，并寻找对应 conda 环境的 `python.exe`。默认环境名是 `memomate`。

### 12.2 创建配置

```powershell
Copy-Item .env.example .env
```

### 12.3 启动后端

```powershell
.\scripts\start_backend.ps1
```

等价命令：

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 12.4 启动 research worker

```powershell
.\scripts\start_research_worker.ps1
```

### 12.5 同时启动后端和 worker

```powershell
.\scripts\start_all_with_worker.ps1
```

### 12.6 一键测试和启动

```powershell
.\scripts\one_click_start_and_test.ps1
```

这个脚本会先运行 pytest，通过后再启动服务。

## 13. 测试覆盖情况

测试目录包含以下方向：

- 企业微信 webhook
- 语音流程
- RRULE 调度
- Research flow
- Research API
- Reply renderer
- Reply generation
- Provider fallback
- OpenClaw client
- Mobile auth
- LLM intent/reply contract
- LLM complex cases
- Intent flow
- Health API
- ASR API
- Admin guard
- Admin users list
- Admin readonly contract
- Admin user audit detail
- Admin chat flow

我在当前环境尝试运行：

```powershell
python -m pytest -q
```

第一次失败原因：

- 当前全局环境中 `pytest==7.4.4`，但 `pytest_asyncio` 插件导入时报错：`cannot import name 'FixtureDef' from 'pytest'`。
- 这是 pytest 和 pytest-asyncio 版本不兼容导致的测试加载失败。

随后用禁用插件自动加载的方式尝试：

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
python -m pytest -q
```

这次进入测试收集，但失败原因变成缺少项目依赖：

- `pydantic_settings`
- `wechatpy`

结论：当前机器的 Python 环境尚未按 `requirements.txt` 完整安装或版本不匹配，测试未能验证业务代码本身。建议在干净虚拟环境或项目指定 conda 环境中执行：

```powershell
pip install -r requirements.txt
python -m pytest -q
```

## 14. 当前架构优点

- 功能闭环完整：从消息入口、提醒、ASR、移动端认证，到 research UI 和 worker 都有实现。
- Research workflow 设计比较完整：规划、检索、轮次、全文、图谱、导出、总结都有数据模型和 API。
- 队列设计考虑了可靠性：`claim_next`、lease、heartbeat、retry、reclaim 都已经具备。
- Localhost-only 的 dev/admin 限制降低了本地调试风险。
- LLM provider 做了 fallback 设计，不完全绑定单一模型。
- 测试覆盖面较广，虽然当前环境没跑通，但测试文件覆盖了大部分关键链路。

## 15. 当前架构风险和改造重点

### 15.1 ResearchService 过重

`ResearchService` 目前承担了过多职责：

- 任务创建和状态流转
- job 分发
- 方向规划
- 论文检索
- 搜索缓存
- 全文下载和解析
- 引文 provider 调用
- 图构建
- 论文保存和导出
- 论文总结
- 企业微信通知
- metrics 统计

后续建议拆分为：

- `ResearchTaskService`
- `ResearchPlanningService`
- `ResearchSearchService`
- `ResearchFulltextService`
- `ResearchGraphService`
- `ResearchRoundService`
- `ResearchExportService`
- `ResearchSummaryService`
- `ResearchJobProcessor`

### 15.2 Repository 过于集中

`app/infra/repos.py` 包含所有 repo。随着 research 表增多，这个文件会越来越难维护。

建议按领域拆分：

- `infra/repos/user_repo.py`
- `infra/repos/reminder_repo.py`
- `infra/repos/mobile_repo.py`
- `infra/repos/voice_repo.py`
- `infra/repos/research/`

### 15.3 UI 内嵌在 Python 字符串中

`research_ui.py` 把完整 HTML/CSS/JS 写在 Python 字符串里，短期方便演示，长期会带来维护困难。

建议：

- 短期：拆成 `static/research/index.html`、`static/research/app.js`、`static/research/style.css`。
- 中期：如果 UI 要持续发展，迁移为独立前端工程。

### 15.4 外部 provider 与网络失败处理需要产品化

Research 模块依赖 Semantic Scholar、arXiv、OpenAlex、Crossref、OpenClaw。当前已有 fallback 和 cache，但生产化还需要关注：

- API 限流
- 失败重试策略
- provider 状态展示
- per-source 配额
- 数据来源可追踪性
- 论文元数据归一化规则

### 15.5 配置默认值不适合对外部署

例如：

- `JWT_SECRET` 是示例值。
- dev/admin 接口依赖 localhost 判断。
- research UI 可通过 dev token 获取本地 token。
- 企业微信配置为空或占位。

如果后续要公网部署，需要重新审视认证、授权、CORS、dev endpoint、admin endpoint 和密钥管理。

### 15.6 文档编码显示问题

我在 PowerShell 中读取 README 和部分 docs 时中文显示为乱码。这通常是终端编码问题，不一定代表文件内容损坏。

如果后续维护中文文档，建议统一：

```powershell
chcp 65001
$OutputEncoding = [System.Text.UTF8Encoding]::new()
```

并确保编辑器以 UTF-8 保存。

## 16. 建议的后续改造路线

如果目标是“在现有项目上继续扩展 research 能力”，建议按以下顺序推进：

1. 先修环境：创建干净虚拟环境，安装 `requirements.txt`，跑通 `python -m pytest -q`。
2. 固化当前行为：在所有重构前，保留并补充 research service 的关键测试，尤其是 job 状态流转、search cache、round select、graph build。
3. 拆分 `ResearchService`：先做纯移动，不改行为，把 plan/search/fulltext/graph/export/summary 拆出去。
4. 拆分 `repos.py`：跟随业务域拆分 repo，保持方法签名尽量不变。
5. 抽离 Research UI 静态资源：先不重做设计，只从 Python 字符串中移出。
6. 梳理配置和启动脚本：明确 venv/conda 二选一策略，避免测试跑到全局 Python。
7. 强化外部 provider 层：为论文检索和引文抓取定义统一 provider 接口、错误码和限流策略。
8. 最后再做功能增强：例如更好的全文质量评估、图谱可视化、论文评分、任务协作、多用户权限。

如果目标是“做论文研究系统产品化”，则优先级应调整为：

1. 认证和权限。
2. 数据模型稳定化。
3. Worker 独立部署。
4. 前端独立化。
5. Provider 可靠性和缓存策略。
6. 任务观测、日志和失败恢复。

## 17. 快速接手清单

第一次接手建议按这个顺序看代码：

1. `README.md`
2. `.env.example`
3. `app/main.py`
4. `app/core/config.py`
5. `app/domain/models.py`
6. `app/domain/schemas.py`
7. `app/api/research.py`
8. `app/services/research_service.py`
9. `app/infra/repos.py`
10. `app/workers/research_worker.py`
11. `app/api/research_ui.py`
12. `tests/test_research_flow.py`
13. `tests/test_research_api.py`

如果只关心提醒助手底座，则看：

1. `app/api/wechat.py`
2. `app/services/message_ingest.py`
3. `app/services/intent_service.py`
4. `app/services/reminder_service.py`
5. `app/workers/dispatcher.py`
6. `tests/test_intent_flow.py`
7. `tests/test_rrule_scheduler.py`

## 18. 总体结论

这个项目已经具备比较完整的“个人研究助手”原型能力，核心价值集中在 research workflow：它能从一个 topic 出发，通过 LLM 规划方向、检索论文、支持用户多轮反馈、补全文、构建引文图并导出结果。

当前最大问题不是“缺功能”，而是“核心业务逐渐集中在少数大文件里”。因此，后续改造最稳妥的策略不是先大改业务，而是先修环境、补测试、再做低风险拆分。只要保持 API 和数据模型行为不变，先把 `ResearchService`、`repos.py`、内嵌 UI 拆开，项目后续扩展会轻松很多。
