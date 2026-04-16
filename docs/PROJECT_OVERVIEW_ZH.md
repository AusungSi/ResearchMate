# OpenClaw for Paper Research 项目说明文档

生成时间：2026-04-16
文档状态：已同步到当前 `research_local` 重构进度

## 1. 当前项目定位

当前仓库已经不再以“企业微信提醒助手”作为默认主线，而是转向一个本地运行的单用户研究工作台。

当前默认目标形态是：

- 运行环境：`WSL / Linux VM`
- 默认部署档位：`research_local`
- 默认使用方式：本地启动后，通过浏览器访问前端工作台
- 核心能力：围绕论文研究任务进行规划、检索、探索、全文处理、图谱构建、报告输出和工作台组织

项目当前的真实目标可以概括为一句话：

> 一个运行在本地 Linux 环境中的 research-only 研究系统，支持半自动的 `GPT Step` 模式，以及分阶段自治的 `OpenClaw Auto` 模式，并通过独立前端工作台承载卡片化研究过程。

## 2. 当前阶段结论

这轮重构之后，仓库已经进入“research-only 主线已跑通，legacy 功能软下线”的状态。

已经完成的核心变化：

- 默认启动档位改为 `research_local`
- `research` API 在本地档位下不再依赖 JWT
- 旧的企业微信、提醒、移动端认证、Admin、自建通知、ASR 链路默认不参与启动
- 引入了独立前端工程 `frontend/`
- 增加了 `GPT Step` 和 `OpenClaw Auto` 两种研究模式
- 增加了 `canvas state`、`run events`、`node chat` 相关数据结构和 API
- 补充了 WSL 下前后端启动、构建、打包脚本

当前仍然保留但不是默认主线的内容：

- 企业微信入口
- 提醒和确认流
- 移动端 JWT 配对与提醒 API
- Admin / Dev 页面
- 本地语音转写链路
- 原内嵌 `research_ui`

这些内容没有被删除，但只有在 `legacy_full` 档位下才会重新进入启动链路。

## 3. 当前技术栈

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

- OpenClaw：用于原生自治式 research 流程
- GPT API：用于 step-by-step 半自动研究流程
- Ollama：仍保留在代码中，但不再是当前主线文档的重点

### 前端

- Vite
- React
- TypeScript
- React Flow
- Tailwind CSS
- TanStack Query

### 部署与运行

- WSL / Linux VM
- Docker Compose
- 仓库内 WSL Node 工具链脚本

## 4. 当前仓库结构

```text
OpenClaw-for-paper-research/
├── app/
│   ├── api/                  # FastAPI 路由，默认主用 health + research
│   ├── core/                 # 配置、日志、时区工具
│   ├── domain/               # SQLAlchemy 模型、枚举、Pydantic schema
│   ├── infra/                # DB、repo、外部 client
│   ├── llm/                  # OpenClaw / Ollama / GPT 相关封装
│   ├── services/             # research 核心服务
│   └── workers/              # research worker
├── docs/
│   ├── PROJECT_OVERVIEW_ZH.md
│   ├── RESEARCH_LOCAL_QUICKSTART.md
│   ├── README.md
│   └── design/              # 前端示例与设计参考
├── frontend/                # 独立前端工作台工程
├── artifacts/               # research 产物、前端打包产物
├── data/                    # 本地 SQLite 等数据
├── migrations/
├── scripts/                 # WSL / research-local 启停、构建、打包脚本
├── tests/
├── docker-compose.yml
├── Dockerfile.backend
├── requirements-research-local.txt
├── requirements.txt
└── README.md
```

与旧版本相比，当前结构上最重要的变化有三点：

- 新增 `frontend/` 独立前端工程
- 新增 `requirements-research-local.txt` 作为 research-only 运行依赖入口
- 新增一组 WSL 本地启动与打包脚本

## 5. 启动档位与应用装配

当前应用存在两个启动档位：

### 5.1 `research_local`

这是当前默认档位，也是当前文档描述的主线。

特点：

- 默认用于本地单用户 research 工作台
- 启动时只初始化 research 相关依赖
- 默认只注册：
  - `/api/v1/health`
  - `/api/v1/research/*`
- research API 无需 JWT，隐式绑定本地单例用户

当前 `app/main.py` 的 `research_local` 启动逻辑会初始化：

- 数据库
- `OpenClawClient`
- `ResearchService`

不会默认初始化：

- `WeComClient`
- `SchedulerService`
- `MessageIngestService`
- `ReminderService`
- `MobileAuthService`
- Admin / Dev / WeChat 相关 router

### 5.2 `legacy_full`

这是保留兼容档位，用于回到旧系统的全量链路。

特点：

- 恢复企业微信、提醒、移动端认证、Admin、ASR 等能力
- 恢复完整路由注册
- 启动路径仍保留，但不再是当前项目主文档的默认推荐方式

## 6. 当前运行方式

## 6.1 推荐方式：WSL / Linux VM

当前推荐的本地运行方式是：

- 后端运行在 WSL / Linux VM
- worker 运行在 WSL / Linux VM
- 前端运行在 WSL / Linux VM

默认本地地址：

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`

## 6.2 Compose 形态

仓库已经提供 `docker-compose.yml`，定义了三个服务：

- `backend`
- `worker`
- `frontend`

其中：

- `backend` 使用 `Dockerfile.backend`
- `worker` 运行 `python -m app.workers.research_worker`
- `frontend` 使用 `frontend/Dockerfile`

当前 Compose 文件已经准备好，但在这台机器上还没有完成一次完整的 `docker compose up --build` 实机验收，原因是当时环境中没有可用 Docker。

## 6.3 WSL 前端工具链

为了避免系统级安装依赖，仓库里已经补了 WSL 前端脚本：

- `scripts/install_frontend_node_wsl.sh`
- `scripts/start_frontend_wsl.sh`
- `scripts/stop_frontend_wsl.sh`
- `scripts/build_frontend_wsl.sh`
- `scripts/package_frontend_wsl.sh`

Node 会安装到仓库内的 `.wsl-tools/`，不污染系统全局环境。

## 7. 当前 research 模式设计

当前系统明确支持两种研究模式。

### 7.1 `GPT Step`

这是半自动模式。

特点：

- 用户逐步推进研究流程
- 后端沿用现有 research pipeline
- 每一步由用户显式触发
- 更适合“人来控节奏，模型辅助推进”的场景

当前这条链路仍然复用了原有 research 主体能力，例如：

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

### 7.2 `OpenClaw Auto`

这是分阶段自治模式。

特点：

- OpenClaw 负责自动推进 research
- 后端记录中间事件流
- 在 checkpoint 暂停，等待用户给出 guidance
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

这条链路已经具备“阶段性同步 + 用户引导后继续”的基本形态，但还不是最终完整版自治编排。

## 8. 当前 research 数据结构

## 8.1 保留的 canonical research 数据

当前保留并继续使用的核心 research 数据表包括：

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
- `research_sessions`

## 8.2 新增的任务运行字段

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

## 8.3 新增的数据表

本轮新增了三类与工作台和自动运行相关的数据表：

- `research_canvas_state`
  - 保存用户工作台状态
  - 包括节点位置、手工节点、手工边、隐藏状态、备注、viewport 等
- `research_run_events`
  - 保存 GPT / OpenClaw 的运行事件流
- `research_node_chats`
  - 保存节点级问答历史

## 9. 当前后端 API

## 9.1 保留的 research 主路径

当前仍然保留并继续服务于 `GPT Step` 模式的主路径包括：

- `POST /api/v1/research/tasks`
- `GET /api/v1/research/tasks`
- `GET /api/v1/research/tasks/{task_id}`
- 原有 `search / explore / fulltext / graph / export / summarize` 路径

## 9.2 新增路径

### 画布相关

- `GET /api/v1/research/tasks/{task_id}/canvas`
- `PUT /api/v1/research/tasks/{task_id}/canvas`

### OpenClaw Auto 相关

- `POST /api/v1/research/tasks/{task_id}/auto/start`
- `GET /api/v1/research/tasks/{task_id}/runs/{run_id}/events`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/guidance`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/continue`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/cancel`

### 节点问答与资产

- `POST /api/v1/research/tasks/{task_id}/nodes/{node_id}/chat`
- `GET /api/v1/research/tasks/{task_id}/papers/{paper_id}/asset`

## 9.3 当前接口行为约束

当前后端已经按下面的分层原则工作：

- `graph` 返回 canonical research graph
- `canvas` 返回用户工作台状态
- 用户拖拽、手工节点、手工边、隐藏状态只写入 `canvas state`
- 系统图谱和用户工作台不直接互相覆盖

这点很重要，因为后续要做更强的前端组织能力时，必须保证“研究结果”和“工作台视图”分层存储。

## 10. 当前前端工作台

前端已经从旧的 Python 内嵌 HTML 字符串迁移为独立工程。

## 10.1 前端定位

当前前端不再是演示型单页，而是研究工作台骨架。

主设计方向：

- 三栏布局
- 卡片式节点
- 工作台化而不是单纯图节点化
- 节点详情、上下文问答、PDF / 全文、运行日志同屏协作

## 10.2 当前主要能力

当前前端已经落地的骨架能力包括：

- 任务创建
- 模式切换
- 研究任务列表
- 中间卡片画布
- 右侧详情面板
- 节点问答
- Run Log 查看
- 画布保存
- 前端 API 代理到本地后端

## 10.3 视觉方向

当前视觉方向参考 `docs/design/前端示例.canvas`，已确定的方向包括：

- 浅色工作台背景
- 大圆角白色主容器
- 卡片式节点，不再使用圆点式节点
- slate 基色搭配 blue / green / violet / amber badge
- 柔和阴影和较轻的边线

这一轮已经把结构和 design token 方向定住，但还没有进入最终视觉精修阶段。后续如果继续补示例样式，前端会在现有组件结构上继续细化。

## 11. 当前 worker 与异步处理

Research worker 仍然保留，并继续承担异步研究任务处理。

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

## 12. 软下线内容

下面这些内容目前是“保留代码，但不进入默认链路”的状态：

- 企业微信 webhook
- 提醒服务与确认流
- 移动端认证
- Admin 页面与接口
- Dev token 页面
- 本地 ASR 入口
- 原内嵌 `research_ui`

如果未来要彻底清理仓库，可以进一步做两件事：

- 从默认文档和 README 中继续弱化这些内容
- 将 legacy 模块迁到更明确的 `legacy/` 目录或独立分支

## 13. 当前已验证状态

基于 2026-04-16 的本地联调结果，已经验证通过：

- WSL 中启动 `backend + worker`
- WSL 中安装本地 Node 工具链并启动前端
- 前端通过 `/api` 代理访问 WSL 后端
- `GPT Step` 任务创建和 worker 自动消费
- `canvas` 的读写
- `node chat` 落库
- `OpenClaw Auto` 的 `start -> checkpoint -> guidance -> continue -> report/artifact`
- 前端打包产物生成

当前尚未完成的验收：

- Docker Compose 在当前机器上的完整实机联调
- 配置真实 OpenClaw 后的完整自治质量验证
- 更完整的前端样式还原和交互细化

## 14. 当前风险与欠缺

虽然主线已经切换成功，但目前仍有几类明显的未完成项。

### 14.1 `ResearchService` 仍然偏重

虽然这轮已经加了新的模式和 API，但 `ResearchService` 仍然是一个大文件，后续还应继续拆分为更清晰的子域服务。

### 14.2 OpenClaw Auto 仍是第一版

当前已经有事件流和 checkpoint 机制，但它更像“可运行的自治 research 骨架”，还不是最终成熟版 orchestrator。

### 14.3 前端工作台结构已定，视觉仍待细化

当前前端已经具备独立工程和卡片工作台骨架，但还没有完成最终样式、对比视图、集合管理、更多节点交互等功能。

### 14.4 Compose 还缺一次完整实机验证

Compose 文件已经准备好，但在当前机器上仍需要一次带 Docker 的完整验收，才能把文档从“已准备”升级到“已完全验证”。

## 15. 后续开发计划

结合当前仓库状态，后续建议继续按这个顺序推进。

### P1：运行链路补齐

- 在 WSL / Linux VM 中完成 `docker compose up --build` 的实机验收
- 校验前端、后端、worker、volume、SQLite、artifacts 全链路
- 补齐 Compose 相关故障排查文档

### P2：OpenClaw Auto 强化

- 对接真实 OpenClaw 环境变量和代理能力
- 提升中间事件质量
- 优化 checkpoint 的摘要质量和引导反馈逻辑
- 明确阶段报告格式

### P3：前端工作台继续深化

- 更完整地还原设计参考样式
- 增加更多卡片动作
- 完善节点分组、筛选、组织和比较体验
- 打磨 PDF / Fulltext / Run Log 面板

### P4：研究服务拆分

- 将 `ResearchService` 拆成 task / planning / search / fulltext / graph / summary / export / auto-run 子域
- 保持 API 行为不变，优先做低风险重构

### P5：外部集成

本轮明确不做，但已经是后续候选方向：

- Zotero
- 飞书
- 多用户
- 正式登录权限体系

## 16. 阅读顺序建议

如果你现在接手当前版本，建议按下面顺序阅读：

1. `README.md`
2. `docs/RESEARCH_LOCAL_QUICKSTART.md`
3. `app/main.py`
4. `app/core/config.py`
5. `app/api/research.py`
6. `app/domain/models.py`
7. `app/domain/schemas.py`
8. `app/services/research_service.py`
9. `frontend/package.json`
10. `frontend/src/`
11. `docker-compose.yml`
12. `scripts/start_research_local_wsl.sh`
13. `scripts/start_frontend_wsl.sh`

如果只想看 OpenClaw Auto 相关，可以重点看：

1. `app/domain/enums.py`
2. `app/domain/models.py`
3. `app/domain/schemas.py`
4. `app/api/research.py`
5. `app/services/research_service.py`
6. `app/infra/repos.py`

## 17. 总体结论

当前项目已经从“功能较杂的个人研究助手原型”收敛成“以 research-only 为主线的本地研究工作台”。

最关键的进展不是又加了多少功能，而是主线已经切换清楚：

- 默认是 `research_local`
- 默认跑在 `WSL / Linux VM`
- 默认通过独立前端工作台访问
- 默认区分 `GPT Step` 与 `OpenClaw Auto`
- 默认把 canonical research graph 和用户工作台 canvas 分层存储

这意味着项目后续的演化方向已经比旧版本清晰很多。接下来最值得做的，不是再把 legacy 内容堆回主线，而是继续把这条 research-only 路线做实：补 Compose 验收、加强 OpenClaw Auto、细化前端工作台、再逐步拆解过重的 research 服务。
