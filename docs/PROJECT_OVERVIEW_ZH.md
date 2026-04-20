# OpenClaw for Paper Research 项目说明文档

生成时间：2026-04-19  
文档状态：已同步到当前 `research_local` + `project / collection / Zotero v1` 进度

## 1. 当前项目定位

当前仓库已经不再以“企业微信提醒助手”作为默认主线，而是转向一个本地运行的单用户研究工作台。

当前默认目标形态是：

- 运行环境：`WSL / Linux VM`
- 默认部署档位：`research_local`
- 默认使用方式：本地启动后，通过浏览器访问独立前端工作台
- 核心能力：围绕论文研究任务进行规划、检索、探索、全文处理、图谱构建、报告输出和工作台组织

项目当前的真实目标可以概括为一句话：

> 一个运行在本地 Linux 环境中的 research-only 研究系统，支持半自动的 `GPT Step` 模式，以及分阶段自治的 `OpenClaw Auto` 模式，并通过独立前端工作台承载卡片化研究过程。

## 2. 当前阶段结论

这轮重构之后，仓库已经进入“research-only 主线已跑通，legacy 功能软下线”的状态。

已经完成的核心变化：

- 默认启动档位改为 `research_local`
- `research` API 在本地档位下不再依赖 JWT
- 旧的企业微信、提醒、移动端认证、Admin、自建通知、ASR 链路默认不参与启动
- 引入独立前端工程 `frontend/`
- 增加 `GPT Step` 和 `OpenClaw Auto` 两种研究模式
- 增加 `canvas state`、`run events`、`node chat` 相关数据结构和 API
- 增加 project / collection / collection study task
- 增加 Zotero v1 导入能力
- 补充 WSL 下前后端启动、构建、打包脚本

当前仍然保留但不是默认主线的内容：

- 企业微信入口
- 提醒和确认流
- 移动端 JWT 配对与提醒 API
- Admin / Dev 页面
- 本地语音转写链路
- 原内嵌 `research_ui`

这些内容没有删除，但只会在 `legacy_full` 档位下重新参与完整启动链路。

## 3. 当前联调进度

截至 `2026-04-19`，已在当前机器上完成并验证：

- WSL 中安装并运行 OpenClaw gateway
- WSL 中运行 `backend + worker + frontend`
- `GPT Step` live smoke：
  - `gpt_basic`
  - `gpt_explore`
- `OpenClaw Auto` live smoke：
  - `start -> checkpoint -> guidance -> continue -> report/artifact`
- 顺序总控 smoke：
  - `gpt_basic -> gpt_explore -> openclaw_auto`
- 连续 `2` 轮稳定性检查全部通过
- project / collection / collection study task 主流程通过
- Zotero collection 导入到本地 collection 通过

这一轮顺手修复了两个真实稳定性问题：

- SQLite 在 `backend + worker` 并发读写时容易出现 `database is locked`
- 并发创建 research task 时可能发生 `task_id` 冲突

这一轮还额外补上了 demo 交付底座：

- 静态展示 Demo：
  - `scripts/seed_embodied_demo.py`
  - `scripts/demo_showcase.py --mode static`
- 动态 Showcase：
  - `scripts/demo_showcase.py --mode live`
  - `scripts/demo_showcase.py --mode all`
- Demo 主题固定为“具身智能 / Embodied AI”

## 4. 当前技术栈

### 后端

- Python 3.10+
- FastAPI / Starlette
- SQLAlchemy 2.x
- Alembic
- SQLite
- APScheduler
- httpx / requests
- pydantic / pydantic-settings
- PyMuPDF / pdfminer.six
- networkx

### 模型与研究能力

- OpenClaw：原生自治 research 流程
- GPT API：step-by-step 半自动研究流程
- Ollama：代码仍保留，但已不是当前主文档的重点

### 前端

- Vite
- React
- TypeScript
- React Flow
- TanStack Query
- Tailwind CSS
- ELK layout

### 部署与运行

- WSL / Linux VM
- Docker Compose 文件已准备
- 仓库内 WSL Node 工具链脚本

## 5. 当前仓库结构

```text
OpenClaw-for-paper-research/
├── app/
│   ├── api/                  # FastAPI 路由，默认主用 health + research
│   ├── core/                 # 配置、日志、时区工具
│   ├── domain/               # SQLAlchemy 模型、枚举、Pydantic schema
│   ├── infra/                # DB、repo、外部 client
│   ├── llm/                  # OpenClaw / GPT / Ollama 相关封装
│   ├── services/             # research 核心服务
│   └── workers/              # research worker
├── docs/
│   ├── PROJECT_OVERVIEW_ZH.md
│   ├── RESEARCH_LOCAL_QUICKSTART.md
│   ├── RESEARCH_USAGE_ZH.md
│   └── design/               # 前端示例与设计参考
├── frontend/                 # 独立前端工作台工程
├── artifacts/                # research 产物、前端打包产物
├── data/                     # 本地 SQLite 等数据
├── migrations/
├── scripts/                  # WSL / research-local 启停、构建、打包脚本
├── tests/
├── docker-compose.yml
├── Dockerfile.backend
├── requirements-research-local.txt
├── requirements.txt
└── README.md
```

与旧版本相比，结构上最重要的变化有四点：

- 新增 `frontend/` 独立前端工程
- 新增 `requirements-research-local.txt` 作为 research-only 运行依赖入口
- 新增一组 WSL 本地启动、打包、smoke 脚本
- 默认文档和入口已经切到 workbench 主线

## 6. 启动档位与应用装配

当前应用存在两个启动档位：

### 6.1 `research_local`

这是当前默认档位，也是当前文档描述的主线。

特点：

- 用于本地单用户 research 工作台
- 启动时只初始化 research 相关依赖
- 默认只注册：
  - `/api/v1/health`
  - `/api/v1/research/*`
- research API 无需 JWT，隐式绑定本地单例用户

当前 `app/main.py` 的 `research_local` 启动逻辑会初始化：

- 数据库
- LLM gateway
- `ResearchService`
- research worker 所需依赖

不会默认初始化：

- `WeComClient`
- `MessageIngestService`
- `ReminderService`
- `MobileAuthService`
- Admin / Dev / WeChat 相关 router

### 6.2 `legacy_full`

这是保留兼容档位，用于回到旧系统的全量链路。

特点：

- 恢复企业微信、提醒、移动端认证、Admin、ASR 等能力
- 恢复完整路由注册
- 启动路径仍保留，但不再是当前项目主文档的默认推荐方式

## 7. 当前运行方式

### 7.1 推荐方式：WSL / Linux VM

当前推荐的本地运行方式是：

- 后端运行在 `WSL / Linux VM`
- worker 运行在 `WSL / Linux VM`
- 前端运行在 `WSL / Linux VM`

默认本地地址：

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`
- OpenClaw gateway：`http://127.0.0.1:18789`

### 7.2 Compose 形态

仓库已经提供 `docker-compose.yml`，定义了三个服务：

- `backend`
- `worker`
- `frontend`

其中：

- `backend` 使用 `Dockerfile.backend`
- `worker` 运行 `python -m app.workers.research_worker`
- `frontend` 使用 `frontend/Dockerfile`

当前 Compose 文件已经准备好，但还没有在这台机器上完成一次完整的 `docker compose up --build` 实机验收。

## 8. 当前研究模式设计

当前系统明确支持两种研究模式。

### 8.1 `GPT Step`

这是半自动模式。

特点：

- 用户逐步推进研究流程
- 后端继续复用现有 research pipeline
- 每一步由用户显式触发
- 更适合“人来控节奏，模型辅助推进”的场景

当前这条链路继续复用：

- 创建任务
- 规划方向
- 检索方向
- 开始 exploration round
- 生成候选
- 选择候选
- 继续下一轮
- 全文处理
- 图谱构建
- 论文总结

### 8.2 `OpenClaw Auto`

这是分阶段自治模式。

特点：

- OpenClaw 负责自动推进 research
- 后端记录中间事件流
- 在 `checkpoint` 暂停，等待用户给出 guidance
- guidance 提交后继续下一阶段

当前第一版已经实现的流程骨架是：

- `start`
- `progress`
- `checkpoint`
- `guidance`
- `continue`
- `report_chunk`
- `artifact`
- `cancel`

这条链路已经具备“阶段性同步 + 用户引导后继续”的基本形态，但还不是最终成熟版 orchestrator。

## 9. 当前数据结构

### 9.1 保留的 canonical research 数据

当前继续使用的核心 research 数据表包括：

- `research_tasks`
- `research_directions`
- `research_seed_papers`
- `research_papers`
- `research_rounds`
- `research_round_candidates`
- `research_round_papers`
- `research_paper_fulltext`
- `research_citation_edges`
- `research_graph_snapshots`
- `research_search_cache`
- `research_citation_fetch_cache`
- `research_jobs`

### 9.2 任务运行字段

`ResearchTask` 现在额外记录：

- `mode`
  - `gpt_step`
  - `openclaw_auto`
- `llm_backend`
  - `gpt`
  - `openclaw`
- `llm_model`
- `auto_status`
  - `idle`
  - `running`
  - `awaiting_guidance`
  - `completed`
  - `failed`
  - `canceled`
- `last_checkpoint_id`
- `project_id`

### 9.3 新增的工作台与集合结构

这一轮新增了三类与工作台组织和集合研究相关的数据表：

- `research_projects`
  - 顶层项目分组
- `research_collections`
  - 项目级可复用论文集合
- `research_collection_items`
  - collection 中的论文条目快照

collection item 至少记录：

- 来源 `task_id`
- 关联 `paper_id`
- metadata snapshot

同一 collection 内会按 `paper_id / DOI / title_norm` 去重。

### 9.4 工作台状态与事件

当前继续使用并扩展的工作台相关数据表：

- `research_canvas_state`
  - 保存节点位置、手工节点、手工边、隐藏状态、备注、viewport、`ui`
- `research_run_events`
  - 保存 GPT / OpenClaw 的运行事件流
- `research_node_chats`
  - 保存节点级问答历史

## 10. 当前后端 API

### 10.1 保留的 research 主路径

当前继续服务于 `GPT Step` 的主路径包括：

- `POST /api/v1/research/tasks`
- `GET /api/v1/research/tasks`
- `GET /api/v1/research/tasks/{task_id}`
- 原有 `search / explore / fulltext / graph / export / summarize`

### 10.2 新增路径

#### workbench 与 project / collection

- `GET /api/v1/research/workbench/config`
- `GET /api/v1/research/projects`
- `POST /api/v1/research/projects`
- `GET /api/v1/research/projects/{project_id}`
- `GET /api/v1/research/projects/{project_id}/collections`
- `POST /api/v1/research/projects/{project_id}/collections`
- `GET /api/v1/research/collections/{collection_id}`
- `POST /api/v1/research/collections/{collection_id}/items`
- `DELETE /api/v1/research/collections/{collection_id}/items/{item_id}`
- `POST /api/v1/research/collections/{collection_id}/study`
- `POST /api/v1/research/collections/{collection_id}/summarize`
- `POST /api/v1/research/collections/{collection_id}/graph/build`

#### 画布相关

- `GET /api/v1/research/tasks/{task_id}/canvas`
- `PUT /api/v1/research/tasks/{task_id}/canvas`

#### OpenClaw Auto

- `POST /api/v1/research/tasks/{task_id}/auto/start`
- `GET /api/v1/research/tasks/{task_id}/runs/{run_id}/events`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/guidance`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/continue`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/cancel`

#### 节点问答与资产

- `POST /api/v1/research/tasks/{task_id}/nodes/{node_id}/chat`
- `GET /api/v1/research/tasks/{task_id}/papers/{paper_id}/asset`

#### Zotero

- `GET /api/v1/research/integrations/zotero/config`
- `POST /api/v1/research/integrations/zotero/import`

### 10.3 接口行为约束

当前后端已经按下面的分层原则工作：

- `graph` 返回 canonical research graph
- `canvas` 返回用户工作台状态
- 用户拖拽、手工节点、手工边、隐藏状态只写入 `canvas state`
- 系统图谱和用户工作台不直接相互覆盖
- `collection -> study task` 会优先使用 collection 作为 seed corpus

这一点很重要，因为后续要继续增强前端组织能力时，必须保证“研究结果”和“工作台视图”分层存储。

## 11. 当前前端工作台

前端已经从旧的 Python 内嵌 HTML 字符串迁移为独立工程。

### 11.1 前端定位

当前前端不再是演示型单页，而是研究工作台骨架。

主设计方向：

- 全屏三栏布局
- 卡片式节点
- 左右栏可折叠、可调宽
- 画布、详情、问答、PDF、运行日志同屏协作

### 11.2 当前主要能力

当前前端已落地的能力包括：

- project 列表
- task 列表
- collection 列表
- task 创建
- collection 创建
- 选中 paper 加入 collection
- 从 collection 创建 study task
- Zotero collection 导入
- 中间卡片画布
- 右侧详情面板
- 节点问答
- Run Timeline
- PDF / Fulltext 面板
- 画布保存和 `ui` 持久化

### 11.3 布局与性能

这一轮前端工作台补了几项重要机制：

- 默认改为真正全屏，不再使用居中小窗壳
- 左右栏折叠状态写入 `canvas.ui`
- 画布布局改用更分散的 ELK 自动布局
- 同步改成更轻的 diff patch，不再每轮都整体重建图
- 拖拽、缩放期间尽量避免远端同步“抢回去”

当前仍然存在但不影响主线可用性的点：

- 前端打包主 bundle 仍偏大
- 更细的 compare、collection 批处理、复杂布局仍未进入本轮

## 12. 检索源与外部集成

### 12.1 discovery 源

当前 workbench config 会返回 discovery providers：

- `Semantic Scholar`
- `arXiv`
- `OpenAlex`

其中：

- 默认 discovery 顺序仍以 `semantic_scholar + arxiv` 为主
- `OpenAlex` 这一轮已可作为可选 discovery 源

### 12.2 citation 源

当前 citation provider 包括：

- `Semantic Scholar`
- `OpenAlex`
- `Crossref`

### 12.3 Zotero v1

当前 Zotero 只做“读入”：

- 读取 Zotero collection / item
- 导入到本地 project collection
- 不直接写入 canonical paper 表
- 用户需要显式执行 `collection -> study task`，才会进入研究主链路

## 13. Worker 与异步处理

research worker 仍保留，并继续承担异步研究任务处理。

当前 job 类型包括：

- `plan`
- `search`
- `fulltext`
- `graph_build`
- `paper_summary`
- `auto_research`

其中：

- `GPT Step` 主要复用已有 job 流程
- `OpenClaw Auto` 使用新增的 `auto_research` 任务链

## 14. 当前已知风险与未完成项

虽然主线已经切换成功，但目前仍有几类明显的未完成项。

### 14.1 `ResearchService` 仍然偏重

虽然已经增加了新的模式和 API，但 `ResearchService` 依然是一个大文件，后续还应继续拆分为更清晰的子域服务。

### 14.2 OpenClaw Auto 仍是第一版

当前已经有事件流和 checkpoint 机制，但它更像“可运行的自治 research 骨架”，还不是最终成熟版 orchestrator。

### 14.3 前端工作台结构已定，视觉与交互仍待细化

当前前端已经具备独立工程和卡片工作台骨架，但还没有完成最终样式、对比视图、更多集合动作、更多节点交互等功能。

### 14.4 Compose 还缺一次完整实机验收

Compose 文件已经准备好，但仍需要在带 Docker 的环境中完成一次完整验收，才能把文档从“已准备”升级到“已完全验证”。

## 15. 后续开发建议

结合当前仓库状态，后续建议按这个顺序推进：

### P1：把 workbench 做成更完整的长期研究台

- 增加 collection compare
- 完善批量操作和筛选
- 优化 PDF / Fulltext 联动
- 进一步打磨 Run Timeline 和 report 展示

### P2：强化 OpenClaw Auto

- 增加更清晰的 stage 状态
- 优化 checkpoint 摘要质量
- 增强事件协议的可观测字段
- 提升中间报告组织能力

### P3：补 Compose 与 CI 验收

- 在 Docker 环境中完成 `docker compose up --build`
- 补齐更稳定的 smoke / CI
- 固化发布与版本化流程

### P4：继续拆分 research 服务

- 将 `ResearchService` 按 task / planning / search / fulltext / graph / summary / collection / auto-run 拆分
- 保持对外 API 不变，优先做低风险重构

### P5：外部生态增强

本轮已进入但未完成的外部集成方向：

- Zotero phase 2
- 更多 discovery provider
- report visual / 论文概览图
- 多用户和正式登录体系

## 16. 阅读顺序建议

如果你现在接手当前版本，建议按下面顺序阅读：

1. `README.md`
2. `docs/RESEARCH_LOCAL_QUICKSTART.md`
3. `docs/RESEARCH_USAGE_ZH.md`
4. `app/main.py`
5. `app/core/config.py`
6. `app/api/research.py`
7. `app/domain/models.py`
8. `app/domain/schemas.py`
9. `app/services/research_service.py`
10. `frontend/src/`
11. `docker-compose.yml`
12. `scripts/start_research_local_wsl.sh`
13. `scripts/start_frontend_wsl.sh`

如果只想看这轮新增主线，优先看：

1. `app/domain/models.py`
2. `app/domain/schemas.py`
3. `app/api/research.py`
4. `app/services/research_service.py`
5. `frontend/src/workbench/`

## 17. 总体结论

当前项目已经从“功能较杂的个人研究助手原型”收敛成“以 research-only 为主线的本地研究工作台”。

最关键的进展不只是又加了多少功能，而是主线已经切换清晰：

- 默认是 `research_local`
- 默认跑在 `WSL / Linux VM`
- 默认通过独立前端工作台访问
- 默认区分 `GPT Step` 与 `OpenClaw Auto`
- 默认把 canonical research graph 和用户工作台 canvas 分层存储
- 默认支持 project / collection / study task 的长期组织层

这意味着项目后续的演化方向已经比旧版本清晰很多。接下来最值得做的，不是再把 legacy 内容堆回主线，而是继续把这条 research-only 路线做实：补 Compose 验收、继续强化 OpenClaw Auto、细化工作台交互，再逐步拆解过重的 research 服务。
