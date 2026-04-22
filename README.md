<div align="center">
  <img src="docs/design/logo.png" alt="OpenClaw for Paper Research logo" width="220" />

  # OpenClaw for Paper Research

  **A local research workbench for papers - built for continuous exploration, not one-shot reports.**  
  **一个面向论文调研的本地研究工作台，强调持续推进，而不是一次性出结果。**

  <p>
    <img alt="Local-first" src="https://img.shields.io/badge/local--first-WSL%20%2F%20Linux-0f766e?style=flat-square" />
    <img alt="Frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-2563eb?style=flat-square" />
    <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI%20%2B%20Worker-1d4ed8?style=flat-square" />
    <img alt="Modes" src="https://img.shields.io/badge/modes-GPT%20Step%20%2B%20OpenClaw%20Auto-0891b2?style=flat-square" />
  </p>
</div>

## Overview / 项目简介

`OpenClaw for Paper Research` is a **local, single-user research system** for paper exploration and literature workflows.  
`OpenClaw for Paper Research` 是一个**本地运行、单用户使用**的论文研究系统，面向持续性的文献调研与研究工作流。

It is designed around one core idea: most AI research tools are good at generating a single result, but weak at **carrying research progress forward**.  
它围绕一个核心判断展开：很多 AI 调研工具擅长给出一次结果，但不擅长**继承研究进度并持续推进**。

Instead of treating literature review as one prompt and one report, this project turns it into a **stateful workbench** with:

- `project` for long-running research themes
- `task` for concrete study flows
- `collection` for reusable paper sets
- `canvas` for the user's working view
- `run events` for process visibility
- `artifacts / exports / assets` for structured outputs

对应地，系统把论文调研组织成一套持续状态：

- `project`：长期研究主题
- `task`：具体研究任务
- `collection`：可复用论文集合
- `canvas`：用户自己的工作画布
- `run events`：过程事件流
- `artifacts / exports / assets`：结构化产出与资产

Current default runtime is `research_local` on `WSL / Linux VM`, with a React workbench, FastAPI backend, background worker, and optional OpenClaw gateway.  
当前默认运行形态是 `research_local + WSL / Linux VM`，包含 React 工作台、FastAPI 后端、后台 worker，以及可选的 OpenClaw gateway。

## Why This Exists / 为什么要做这个项目

AI literature changes fast:

- new papers appear every day
- conference and journal submissions keep rising
- the same topic quickly branches into multiple lines
- traditional literature review burns time on repeated search, filtering, note taking, and re-organization

人工智能领域的文献变化极快：

- 新论文持续出现
- 顶会和期刊投稿量不断增长
- 同一问题会迅速分化出多条路线
- 传统文献调研会在搜索、筛选、整理和记录上消耗大量时间

Existing tools already help, but most of them still look like:

- one request
- one run
- one result

现有工具已经很有帮助，但很多产品底层仍然更接近：

- 一次请求
- 一次运行
- 一份结果

If the user wants to continue later, change direction, branch into a subset of papers, or inherit previous progress, the workflow often resets.  
如果用户后续还想继续、改方向、围绕一部分论文开分支，或者继承前一次调研进度，流程往往会重新开始。

This project focuses on the missing layer: **continuous research progression**.  
这个项目关注的正是缺失的那一层：**持续推进的研究过程**。

## What Makes It Different / 它和常见工具有什么不同

### 1. Continuous Research, Not Just One-Shot Reports / 持续研究，而不是一次性报告

This system is built for **multi-step, long-running research**, not only "generate a report once".  
它面向的是**多步、长期、可继续的研究过程**，而不只是“一次性生成一份报告”。

You can:

- plan directions
- search one direction at a time
- continue an exploration branch
- compare selected papers
- build graph snapshots
- come back later and keep going

你可以：

- 先规划方向
- 按方向逐步检索
- 沿某个分支继续探索
- 比较选中的论文
- 构建图谱快照
- 隔一段时间再回来继续推进

### 2. Two Research Modes in One System / 一个系统里同时支持两种研究模式

#### `GPT Step`

Half-automatic, user-guided research.  
半自动、用户主导的研究模式。

- explicit step-by-step actions
- user decides what to do next
- suitable for careful, controlled exploration

- 明确的 step-by-step 动作链
- 用户决定下一步做什么
- 适合精细控制、边看边改的研究过程

#### `OpenClaw Auto`

Autonomous staged research.  
分阶段自治研究模式。

- agent explores by itself
- syncs intermediate results back to the workbench
- pauses at `checkpoint`
- continues after user `guidance`

- 代理自主探索
- 中间结果同步回工作台
- 在 `checkpoint` 暂停
- 收到用户 `guidance` 后继续

This gives the project both high user control and high agent autonomy.  
因此它同时具备“用户强控制”和“代理强自治”两种能力。

### 3. A Real Workbench, Not Just a Chat Box / 真正的工作台，而不只是聊天框

The current frontend is a three-pane research workspace:

- **left**: projects, tasks, collections, controls
- **center**: card-based research canvas
- **right**: detail panel, chat, run timeline, PDF / fulltext / assets

当前前端是一个三栏研究工作台：

- **左侧**：项目、任务、collection 与控制入口
- **中间**：卡片式研究画布
- **右侧**：详情、对话、运行时间线、PDF / Fulltext / 资产

That makes it much closer to how real research work happens.  
这比单轮聊天更贴近真实研究者的工作方式。

### 4. Canonical Graph and User Canvas Are Separated / 研究图谱与用户画布分层

This is one of the key architecture choices:

- `canonical graph` stores research structure
- `canvas state` stores user layout and working annotations

这是当前系统很重要的架构选择：

- `canonical graph` 保存研究结构本身
- `canvas state` 保存用户自己的布局、备注和工作表达

So the user can drag nodes, hide nodes, add notes, and reorganize the workspace without overwriting the system's research graph.  
这意味着用户可以拖拽、隐藏、加注释、重排结构，而不会覆盖系统研究结果本身。

### 5. Works With Existing Research Ecosystems / 能和已有研究生态协同

The goal is not to replace every research tool.  
目标不是替代所有研究工具。

The goal is to connect the missing workflow between **paper collection** and **research execution**.  
目标是补上**文献收集**和**研究执行**之间缺失的那一段工作流。

Current integrations and sources include:

- Zotero local import / export
- Semantic Scholar
- arXiv
- OpenAlex
- Crossref

当前已经支持或接入：

- Zotero 本地导入导出
- Semantic Scholar
- arXiv
- OpenAlex
- Crossref

## Current Feature Set / 当前功能概览

### Research Organization / 研究组织层

- top-level `project`
- research `task`
- reusable paper `collection`
- `collection -> study task` workflow

- 顶层 `project`
- 研究任务 `task`
- 可复用论文集合 `collection`
- 从 `collection` 派生新的研究任务

### GPT Step Flow / GPT Step 主流程

- create task
- plan directions
- search a direction
- start explore round
- generate candidates
- select candidates
- continue next round
- build graph
- process fulltext
- summarize paper
- export results

- 创建任务
- 规划方向
- 检索方向
- 开始探索轮次
- 生成候选
- 选择候选
- 继续下一轮
- 构建图谱
- 处理全文
- 总结论文
- 导出结果

### OpenClaw Auto Flow / OpenClaw Auto 主流程

- start autonomous run
- sync progress / nodes / edges / papers
- pause at `checkpoint`
- submit `guidance`
- continue staged exploration
- view report chunks and artifacts

- 启动自治研究
- 同步进度 / 节点 / 边 / 论文
- 在 `checkpoint` 暂停
- 提交 `guidance`
- 继续阶段性探索
- 查看报告片段和 artifact

### Workbench UX / 前端工作台体验

- full-screen React workbench
- collapsible left / right panels
- card-based node canvas
- node detail view
- markdown chat
- PDF / fulltext / asset panel
- run timeline
- canvas persistence

- 全屏 React 工作台
- 左右栏可折叠
- 卡片式节点画布
- 节点详情
- Markdown 对话
- PDF / Fulltext / 资产面板
- 运行时间线
- 画布持久化

### Paper / Asset Layer / 论文与资产层

- PDF assets
- fulltext status
- export history
- `figure` asset for extracted main figure
- `visual` asset for fallback paper visual

- PDF 资产
- Fulltext 状态
- 导出历史
- `figure` 主图提取资产
- `visual` 模板展示图资产

## Demo / 演示能力

This repository already supports two demo modes.  
当前仓库已经支持两种 demo 形式。

### Static Demo / 静态展示 Demo

A fully prepared **Embodied AI** workspace for direct presentation.  
一个围绕 **Embodied AI / 具身智能** 的完整静态演示工作区，可直接用于展示。

It includes:

- one demo project
- one completed `GPT Step` task
- one completed `OpenClaw Auto` task
- one reusable collection
- compare / checkpoint / artifact / export examples
- real paper nodes and cached assets

其中包含：

- 一个 demo project
- 一条完成的 `GPT Step` 任务
- 一条完成的 `OpenClaw Auto` 任务
- 一个可复用 collection
- compare / checkpoint / artifact / export 示例
- 真实论文节点与缓存资产

### Live Demo / 动态运行 Demo

A sequential smoke showcase for real execution:

- `gpt_basic`
- `gpt_explore`
- `openclaw_auto`

一套可现场运行的动态展示链路：

- `gpt_basic`
- `gpt_explore`
- `openclaw_auto`

### Demo Commands / Demo 命令

```bash
bash scripts/run_demo_showcase_wsl.sh --mode static --json-out artifacts/demo/showcase-static.json
bash scripts/run_demo_showcase_wsl.sh --mode live --json-out artifacts/demo/showcase-live.json
bash scripts/run_demo_showcase_wsl.sh --mode all --json-out artifacts/demo/showcase-all.json
```

## Quick Start / 快速开始

### 1. Copy Environment File / 复制环境配置

```bash
cp .env.example .env
```

At minimum, check these values:  
至少确认这些配置项：

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

If you want `OpenClaw Auto`, also configure:  
如果你要启用 `OpenClaw Auto`，再补这些：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=main
```

### 2. Install Research Runtime / 安装 research 运行环境

```bash
python3 -m venv .venv-wsl
.venv-wsl/bin/python -m pip install -r requirements-research-local.txt
```

### 3. Start Backend and Worker / 启动后端与 worker

```bash
bash scripts/start_research_local_wsl.sh
```

Stop / 停止：

```bash
bash scripts/stop_research_local_wsl.sh
```

### 4. Start Frontend / 启动前端

```bash
bash scripts/install_frontend_node_wsl.sh
bash scripts/start_frontend_wsl.sh
```

Stop / 停止：

```bash
bash scripts/stop_frontend_wsl.sh
```

### 5. Start OpenClaw Gateway / 启动 OpenClaw Gateway

```bash
bash scripts/start_openclaw_wsl.sh
```

Stop / 停止：

```bash
bash scripts/stop_openclaw_wsl.sh
```

### 6. Default Local URLs / 默认本地地址

- Frontend workbench: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8000`
- OpenClaw gateway: `http://127.0.0.1:18789`

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`
- OpenClaw gateway：`http://127.0.0.1:18789`

## Validation and Smoke / 验证与 Smoke

### API Connectivity Check / API 连通性检查

```bash
bash scripts/run_api_connectivity_check_wsl.sh --iterations 10 --json-out artifacts/research-api-check/current.json
```

This is useful for verifying:  
这套检查适合验证：

- workbench config
- project / collection APIs
- task APIs
- canvas read / write
- run events API
- Zotero config API

- workbench 配置接口
- project / collection 接口
- task 接口
- canvas 读写
- run events 接口
- Zotero 配置接口

### Research Live Smoke / 研究主链路 Smoke

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

Run two rounds for stability / 连续两轮稳定性检查：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

Run single scenarios / 分别跑单个场景：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_basic
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_explore
bash scripts/run_research_live_smoke_wsl.sh --scenario openclaw_auto
```

## Typical Research Workflow / 典型研究流程

### GPT Step

1. Create a project  
   创建项目
2. Create a `GPT Step` task  
   创建 `GPT Step` 任务
3. Plan directions  
   规划方向
4. Search one direction  
   检索一个方向
5. Start explore round  
   开始探索轮次
6. Generate and select candidates  
   生成并选择候选
7. Build graph  
   构建图谱
8. Process fulltext  
   处理全文
9. Summarize selected papers  
   总结论文
10. Export results  
    导出结果

### OpenClaw Auto

1. Create a task in `OpenClaw Auto` mode  
   创建 `OpenClaw Auto` 任务
2. Start autonomous research  
   启动自治研究
3. Wait for `checkpoint`  
   等待 `checkpoint`
4. Submit `guidance`  
   提交 `guidance`
5. Continue exploration  
   继续探索
6. Inspect report chunks and artifacts  
   查看报告片段和 artifacts

### Collection-Driven Workflow / 基于 Collection 的流程

1. Import papers into a collection  
   导入论文到 collection
2. Review collection details  
   查看 collection 详情
3. Compare or summarize the collection  
   比较或总结 collection
4. Create a new `study task` from the collection  
   从 collection 派生新的 `study task`
5. Continue exploration from the seed corpus  
   从这组 seed papers 继续推进研究

## Repository Structure / 仓库结构

```text
app/                  FastAPI backend, domain logic, services, workers
frontend/             React + TypeScript workbench
docs/                 project docs, architecture, usage, roadmap, showcase material
scripts/              WSL startup, smoke, demo, packaging helpers
tests/                backend tests
artifacts/            research outputs, saved files, demo outputs
data/                 local SQLite database
output/               generated docs and deliverables
```

```text
app/                  FastAPI 后端、领域逻辑、服务与 worker
frontend/             React + TypeScript 工作台
docs/                 项目文档、架构、用法、路线图、展示材料
scripts/              WSL 启动、smoke、demo、打包辅助脚本
tests/                后端测试
artifacts/            研究输出、保存文件与 demo 产物
data/                 本地 SQLite 数据库
output/               生成的文档与交付物
```

## Current Status / 当前状态

As of the current `research_local` mainline:

- backend + worker + frontend run in WSL
- local OpenClaw gateway can be started and used
- `GPT Step` main flow is connected
- `OpenClaw Auto` staged flow is connected
- project / collection / study task flow is available
- Zotero local import / export v1 is available
- static and live demo entry points are available

截至当前 `research_local` 主线：

- backend + worker + frontend 可在 WSL 中运行
- 本地 OpenClaw gateway 可启动并接入
- `GPT Step` 主流程已经打通
- `OpenClaw Auto` 分阶段流程已经打通
- project / collection / study task 已可用
- Zotero 本地导入导出 v1 已可用
- 静态与动态 demo 入口都已准备好

## Documentation / 文档入口

### Start Here / 建议先看

- [docs/RESEARCH_LOCAL_QUICKSTART.md](docs/RESEARCH_LOCAL_QUICKSTART.md)
  - setup, start / stop, smoke, demo commands
  - 启动、停止、smoke 与 demo 命令
- [docs/RESEARCH_USAGE_ZH.md](docs/RESEARCH_USAGE_ZH.md)
  - user guide for project / task / collection / GPT Step / OpenClaw Auto / Zotero
  - project / task / collection / GPT Step / OpenClaw Auto / Zotero 使用说明
- [docs/PROJECT_OVERVIEW_ZH.md](docs/PROJECT_OVERVIEW_ZH.md)
  - current project overview, architecture state, API and data model summary
  - 当前项目总览、架构状态、API 与数据结构摘要

### More Docs / 更多文档

- [docs/RESEARCH_ARCH.md](docs/RESEARCH_ARCH.md)
- [docs/DEMO_STEPS.md](docs/DEMO_STEPS.md)
- [docs/ROADMAP_ZH.md](docs/ROADMAP_ZH.md)
- [docs/PPT_SHOWCASE_ADVANTAGES_ZH.md](docs/PPT_SHOWCASE_ADVANTAGES_ZH.md)
- [docs/SHOWCASE_REPORT_DRAFT_ZH.md](docs/SHOWCASE_REPORT_DRAFT_ZH.md)
- [docs/README.md](docs/README.md)

## Design Notes / README 设计说明

This README follows a common pattern used by many popular open-source repositories:

- strong hero section
- short "what it is / why it exists"
- highlights before implementation details
- quick start near the top
- clear docs index
- demo and validation entry points

这版 README 参考了很多热门开源仓库常见的首页结构：

- 顶部 Hero 区
- 先讲清楚它是什么、为什么存在
- 先亮点后实现细节
- Quick Start 放前面
- 文档入口清晰
- demo 和验证入口单独明确给出

That makes the repository easier to scan for both first-time visitors and presentation audiences.  
这样既方便第一次进入仓库的读者，也适合展示、汇报和答辩场景。

## Roadmap Direction / 后续方向

Near-term improvement directions:

- continue refining the frontend workbench experience
- strengthen OpenClaw Auto stage handling and report organization
- improve collection compare and reusable research branches
- validate Docker Compose on a real Docker environment
- continue splitting heavy research service logic into clearer subdomains

近期主要优化方向：

- 继续优化前端工作台体验
- 强化 OpenClaw Auto 的阶段推进和报告组织
- 补强 collection compare 与可复用研究分支
- 在真实 Docker 环境中完成 Compose 验证
- 继续拆分过重的 research service 逻辑

## Notes / 备注

- `research_local` is the current default mainline.  
  `research_local` 是当前默认主线。
- Legacy WeCom / reminder / mobile auth / admin paths are retained in code but **soft-disabled** from the default runtime.  
  旧的 WeCom / reminder / mobile auth / admin 链路仍保留在代码里，但默认运行时已经软下线。
- Research APIs in local mode do **not** require JWT.  
  本地模式下 research API 默认不需要 JWT。
- SQLite is the current default database. If higher concurrency becomes a priority, PostgreSQL should be the next step.  
  当前默认数据库是 SQLite；如果后续更强调并发稳定性，PostgreSQL 是下一步优先选择。
