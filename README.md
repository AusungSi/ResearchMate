# OpenClaw for Paper Research

一个面向本地 `WSL / Linux VM` 的单用户研究工作台。

当前默认主线已经切到 `research_local`，目标不再是提醒助手，而是把论文调研流程收敛成一个可本地部署、可持续使用、可扩展的 research workbench。

系统当前支持两种研究模式：

- `GPT Step`
  - 半自动、一步一步推进，用户显式决定下一步操作。
- `OpenClaw Auto`
  - 原生自治调研，在 `checkpoint` 暂停，等待用户补充 `guidance` 后继续。

## 当前状态

截至 `2026-04-19`，当前仓库已经验证通过：

- `backend + worker + frontend` 可在 WSL 中启动。
- 本地 OpenClaw gateway 可在 WSL 中启动并接入 workbench。
- `GPT Step` 主链路可跑通：
  - 任务创建
  - 方向规划
  - `explore/start`
  - `propose/select`
  - `graph/tree`
  - `canvas`
  - `node chat`
- `OpenClaw Auto` 主链路可跑通：
  - `start -> checkpoint -> guidance -> continue -> report/artifact`
- workbench 已支持：
  - `project`
  - 可复用 `collection`
  - 从 `collection` 创建派生 `study task`
  - 全屏三栏工作台
  - 左右栏折叠与宽度持久化
  - Zotero 本地文件导入导出 v1
- 已交付两套 demo 入口：
  - 静态展示 Demo：一键初始化“具身智能 / Embodied AI”完整工作区
  - 动态运行 Demo：顺序跑 `gpt_basic -> gpt_explore -> openclaw_auto`

## 默认访问地址

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`
- OpenClaw gateway：`http://127.0.0.1:18789`

## 快速开始

### 1. 复制配置

```bash
cp .env.example .env
```

至少建议确认这些变量：

```env
APP_PROFILE=research_local
DB_URL=sqlite:///./data/memomate.db
RESEARCH_ENABLED=true
RESEARCH_QUEUE_MODE=worker
RESEARCH_ARTIFACT_DIR=./artifacts/research
RESEARCH_SAVE_BASE_DIR=./artifacts/research/saved
RESEARCH_GPT_API_KEY=...
RESEARCH_GPT_MODEL=gpt-5.4
```

如需启用 OpenClaw Auto：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=main
```

Zotero 默认走本地文件导入导出，不需要 API Key：

1. 在 Zotero Desktop 中导出 `CSL JSON` 或 `BibTeX`
2. 在工作台左侧点击“导入 Zotero 文件”
3. 导入后会在当前项目下生成一个新的 collection
4. 可以继续 `compare / summarize / build graph / create study task`
5. task 和 collection 都支持导出为 `BibTeX / CSL JSON`

如需保留旧的 Zotero Web API 兼容模式，再配置：

```env
ZOTERO_BASE_URL=https://api.zotero.org
ZOTERO_LIBRARY_TYPE=users
ZOTERO_LIBRARY_ID=...
ZOTERO_API_KEY=...
```

### 2. 安装 research-local 依赖

```bash
python3 -m venv .venv-wsl
.venv-wsl/bin/python -m pip install -r requirements-research-local.txt
```

### 3. 启动后端与 worker

```bash
bash scripts/start_research_local_wsl.sh
```

停止：

```bash
bash scripts/stop_research_local_wsl.sh
```

### 4. 启动前端

```bash
bash scripts/install_frontend_node_wsl.sh
bash scripts/start_frontend_wsl.sh
```

停止：

```bash
bash scripts/stop_frontend_wsl.sh
```

### 5. 启动 OpenClaw gateway

```bash
bash scripts/start_openclaw_wsl.sh
```

停止：

```bash
bash scripts/stop_openclaw_wsl.sh
```

## 命令行自检

这里有两套命令，解决的是两类不同问题。

### 1. API 连通性检查

用于判断主要 HTTP 接口是否能直接打通，不依赖浏览器操作。

在 WSL 中运行：

```bash
bash scripts/run_api_connectivity_check_wsl.sh --iterations 10 --json-out artifacts/research-api-check/current.json
```

如果你是在 Windows PowerShell 里直接发起：

```powershell
wsl.exe bash -lc 'cd /mnt/d/project/OpenClaw-for-paper-research && bash scripts/run_api_connectivity_check_wsl.sh --iterations 10 --json-out artifacts/research-api-check/current.json'
```

这份检查会直接打这些接口：

- `GET /api/v1/health`
- `GET /api/v1/research/workbench/config`
- `GET /api/v1/research/projects`
- `POST /api/v1/research/projects`
- `GET /api/v1/research/projects/{project_id}`
- `GET /api/v1/research/projects/{project_id}/collections`
- `POST /api/v1/research/projects/{project_id}/collections`
- `GET /api/v1/research/collections/{collection_id}`
- `GET /api/v1/research/tasks`
- `POST /api/v1/research/tasks`
- `GET /api/v1/research/tasks/{task_id}`
- `GET /api/v1/research/tasks/{task_id}/canvas`
- `PUT /api/v1/research/tasks/{task_id}/canvas`
- `GET /api/v1/research/tasks/{task_id}/runs/{run_id}/events`
- `GET /api/v1/research/integrations/zotero/config`

说明：

- 这份检查是“接口级”检查。
- 它会顺手创建临时 project、collection、task，用于确认写接口和读接口都正常。
- 当 worker 正在持续消费任务、而底层仍是 SQLite 时，连续压测可能出现个别超时，这更像“当前本地并发环境下的可用性”而不是“接口完全不可用”。

### 2. 全链路 smoke

用于判断 research 主流程是否能完整跑通。

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

连续两轮稳定性检查：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

也可以单独跑某一条链路：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_basic
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_explore
bash scripts/run_research_live_smoke_wsl.sh --scenario openclaw_auto
```

### 3. 静态展示 Demo + 动态 Showcase

如果你要直接演示现成结果，先初始化静态 Demo：

```bash
bash scripts/run_demo_showcase_wsl.sh --mode static --json-out artifacts/demo/showcase-static.json
```

如果你要现场跑一遍动态流程：

```bash
bash scripts/run_demo_showcase_wsl.sh --mode live --json-out artifacts/demo/showcase-live.json
```

如果你想把两者一起准备好：

```bash
bash scripts/run_demo_showcase_wsl.sh --mode all --json-out artifacts/demo/showcase-all.json
```

这套脚本默认主题固定为“具身智能 / Embodied AI”，并会：

- 为静态展示写入可直接打开的 demo project / task / collection / compare / artifact 数据
- 为动态展示顺序调用现有 live smoke 场景
- 在 `artifacts/demo/` 下输出 JSON 结果，方便复盘和现场说明

## 日常使用入口

推荐阅读顺序：

- [docs/RESEARCH_LOCAL_QUICKSTART.md](docs/RESEARCH_LOCAL_QUICKSTART.md)
  - WSL 启动、OpenClaw 启停、API 自检、smoke 命令
- [docs/RESEARCH_USAGE_ZH.md](docs/RESEARCH_USAGE_ZH.md)
  - 用户使用说明书，包含 `project / task / collection / GPT Step / OpenClaw Auto / Zotero`
- [docs/DEMO_STEPS.md](docs/DEMO_STEPS.md)
  - 静态展示 Demo 与动态 Showcase 的演示顺序
- [docs/PROJECT_OVERVIEW_ZH.md](docs/PROJECT_OVERVIEW_ZH.md)
  - 当前架构、数据结构、接口与改造进度
- [docs/ROADMAP_ZH.md](docs/ROADMAP_ZH.md)
  - 下一步优化方向
- [docs/README.md](docs/README.md)
  - `docs/` 文档索引

## 当前工作台能力

### 研究组织

- 顶层 `project`
- 研究任务 `task`
- 可复用命名论文集合 `collection`
- 从 `collection` 创建派生 `study task`

### 研究模式

- `GPT Step`
  - 明确动作链，逐步推进
- `OpenClaw Auto`
  - 原生自治研究 + checkpoint 引导

### 工作台

- 独立前端工程 `frontend/`
- 全屏卡片式画布
- 左右栏折叠与宽度持久化
- 节点详情、Context Chat、Run Timeline、PDF / Fulltext
- collection 侧栏和 collection detail

### 外部源

- discovery：
  - `Semantic Scholar`
  - `arXiv`
  - `OpenAlex`
- citation：
  - `Semantic Scholar`
  - `OpenAlex`
  - `Crossref`
- integration：
  - Zotero v1 默认走本地文件导入导出
  - 旧的 Web API 导入仅保留为兼容模式

## 仓库结构

```text
app/                  FastAPI 后端与 research 服务
frontend/             React 工作台
docs/                 中文文档与设计说明
scripts/              WSL 启停、构建、打包、API 自检、smoke 脚本
tests/                后端测试
artifacts/            研究报告、导出文件、前端打包产物、检查结果
data/                 本地 SQLite 数据
```

## 说明

- 旧的企业微信、提醒、移动端认证、Admin、ASR、自建通知链路仍保留在代码中，但默认不进入 `research_local` 启动链路。
- `research_local` 下 research API 默认绑定单例本地用户，无需 JWT。
- 当前环境仍以 SQLite 为主；如果后续需要更高的并发稳定性，优先考虑迁移到 PostgreSQL。
