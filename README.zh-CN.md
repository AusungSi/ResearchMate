<div align="center">
  <img src="docs/design/logo.png" alt="ResearchMate logo" width="220" />

  # ResearchMate

  **一个面向论文调研的本地研究工作台，强调持续推进，而不是一次性出结果。**

  <p>
    <a href="./README.md">English</a> | 简体中文
  </p>

  <p>
    <img alt="Local-first" src="https://img.shields.io/badge/local--first-WSL%20%2F%20Linux-0f766e?style=flat-square" />
    <img alt="Frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-2563eb?style=flat-square" />
    <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI%20%2B%20Worker-1d4ed8?style=flat-square" />
    <img alt="Modes" src="https://img.shields.io/badge/modes-GPT%20Step%20%2B%20OpenClaw%20Auto-0891b2?style=flat-square" />
  </p>
</div>

## 项目简介

`ResearchMate` 是一个**本地运行、单用户使用**的论文研究系统，面向持续性的文献调研与研究工作流。

它围绕一个核心判断展开：

> 很多 AI 调研工具擅长给出一次结果，但不擅长**继承研究进度并持续推进**

系统不把文献调研当成“一次 prompt + 一份报告”，而是组织成一个**有状态的研究工作台**，包含：

- `project`：长期研究主题
- `task`：具体研究任务
- `collection`：可复用论文集合
- `canvas`：用户自己的工作画布
- `run events`：过程事件流
- `artifacts / exports / assets`：结构化产出与资产

当前默认运行形态是 `research_local + WSL / Linux VM`，包含 React 工作台、FastAPI 后端、后台 worker，以及可选的 OpenClaw gateway。

## 为什么要做这个项目

人工智能领域的文献变化极快：

- 新论文持续出现
- 顶会和期刊投稿量不断增长
- 同一问题会迅速分化出多条路线
- 传统文献调研会在搜索、筛选、整理和记录上消耗大量时间

现有工具已经很有帮助，但很多产品底层仍然更接近：

- 一次请求
- 一次运行
- 一份结果

如果用户后续还想继续、改方向、围绕一部分论文开分支，或者继承前一次调研进度，流程往往会重新开始。

这个项目关注的正是缺失的那一层：**持续推进的研究过程**。

## 它和常见工具有什么不同

### 1. 持续研究，而不是一次性报告

这个系统面向的是**多步、长期、可继续的研究过程**，而不只是“一次性生成一份报告”。

你可以：

- 先规划方向
- 按方向逐步检索
- 沿某个分支继续探索
- 比较选中的论文
- 构建图谱快照
- 隔一段时间再回来继续推进

### 2. 一个系统里同时支持两种研究模式

#### `GPT Step`

半自动、用户主导的研究模式。

- 明确的 step-by-step 动作链
- 用户决定下一步做什么
- 适合精细控制、边看边改的研究过程

#### `OpenClaw Auto`

分阶段自治研究模式。

- 代理自主探索
- 中间结果同步回工作台
- 在 `checkpoint` 暂停
- 收到用户 `guidance` 后继续

因此它同时具备“用户强控制”和“代理强自治”两种能力。

### 3. 真正的工作台，而不只是聊天框

当前前端是一个三栏研究工作台：

- **左侧**：项目、任务、collection 与控制入口
- **中间**：卡片式研究画布
- **右侧**：详情、对话、运行时间线、PDF / Fulltext / 资产

这比单轮聊天更贴近真实研究者的工作方式。

### 4. 研究图谱与用户画布分层

这是当前系统很重要的架构选择：

- `canonical graph` 保存研究结构本身
- `canvas state` 保存用户自己的布局、备注和工作表达

这意味着用户可以拖拽、隐藏、加注释、重排结构，而不会覆盖系统研究结果本身。

### 5. 能和已有研究生态协同

目标不是替代所有研究工具。

目标是补上**文献收集**和**研究执行**之间缺失的那一段工作流。

当前已经支持或接入：

- Zotero 本地导入导出
- Semantic Scholar
- arXiv
- OpenAlex
- Crossref

## 当前功能概览

### 研究组织层

- 顶层 `project`
- 研究任务 `task`
- 可复用论文集合 `collection`
- 从 `collection` 派生新的研究任务

### GPT Step 主流程

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

### OpenClaw Auto 主流程

- 启动自治研究
- 同步进度 / 节点 / 边 / 论文
- 在 `checkpoint` 暂停
- 提交 `guidance`
- 继续阶段性探索
- 查看报告片段和 artifact

### 前端工作台体验

- 全屏 React 工作台
- 左右栏可折叠
- 卡片式节点画布
- 节点详情
- Markdown 对话
- PDF / Fulltext / 资产面板
- 运行时间线
- 画布持久化

### 论文与资产层

- PDF 资产
- Fulltext 状态
- 导出历史
- `figure` 主图提取资产
- `visual` 模板展示图资产

## 演示能力

当前仓库已经支持两种 demo 形式。

### 静态展示 Demo

一个围绕 **Embodied AI / 具身智能** 的完整静态演示工作区，可直接用于展示。

其中包含：

- 一个 demo project
- 一条完成的 `GPT Step` 任务
- 一条完成的 `OpenClaw Auto` 任务
- 一个可复用 collection
- compare / checkpoint / artifact / export 示例
- 真实论文节点与缓存资产

### 动态运行 Demo

一套可现场运行的动态展示链路：

- `gpt_basic`
- `gpt_explore`
- `openclaw_auto`

### Demo 命令

```bash
bash scripts/run_demo_showcase_wsl.sh --mode static --json-out artifacts/demo/showcase-static.json
bash scripts/run_demo_showcase_wsl.sh --mode live --json-out artifacts/demo/showcase-live.json
bash scripts/run_demo_showcase_wsl.sh --mode all --json-out artifacts/demo/showcase-all.json
```

## 快速开始

### 1. 复制环境配置

```bash
cp .env.example .env
```

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

如果你要启用 `OpenClaw Auto`，再补这些：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=main
```

### 2. 安装 research 运行环境

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

### 5. 启动 OpenClaw Gateway

```bash
bash scripts/start_openclaw_wsl.sh
```

停止：

```bash
bash scripts/stop_openclaw_wsl.sh
```

### 6. 默认本地地址

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`
- OpenClaw gateway：`http://127.0.0.1:18789`

## 验证与 Smoke

### API 连通性检查

```bash
bash scripts/run_api_connectivity_check_wsl.sh --iterations 10 --json-out artifacts/research-api-check/current.json
```

这套检查适合验证：

- workbench 配置接口
- project / collection 接口
- task 接口
- canvas 读写
- run events 接口
- Zotero 配置接口

### 研究主链路 Smoke

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

连续两轮稳定性检查：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

分别跑单个场景：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_basic
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_explore
bash scripts/run_research_live_smoke_wsl.sh --scenario openclaw_auto
```

## 典型研究流程

### GPT Step

1. 创建项目
2. 创建 `GPT Step` 任务
3. 规划方向
4. 检索一个方向
5. 开始探索轮次
6. 生成并选择候选
7. 构建图谱
8. 处理全文
9. 总结论文
10. 导出结果

### OpenClaw Auto

1. 创建 `OpenClaw Auto` 任务
2. 启动自治研究
3. 等待 `checkpoint`
4. 提交 `guidance`
5. 继续探索
6. 查看报告片段和 artifacts

### 基于 Collection 的流程

1. 导入论文到 collection
2. 查看 collection 详情
3. 比较或总结 collection
4. 从 collection 派生新的 `study task`
5. 从这组 seed papers 继续推进研究

## 仓库结构

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

## 当前状态

截至当前 `research_local` 主线：

- backend + worker + frontend 可在 WSL 中运行
- 本地 OpenClaw gateway 可启动并接入
- `GPT Step` 主流程已经打通
- `OpenClaw Auto` 分阶段流程已经打通
- project / collection / study task 已可用
- Zotero 本地导入导出 v1 已可用
- 静态与动态 demo 入口都已准备好

## 文档入口

### 建议先看

- [docs/RESEARCH_LOCAL_QUICKSTART.md](docs/RESEARCH_LOCAL_QUICKSTART.md)
  - 启动、停止、smoke 与 demo 命令
- [docs/RESEARCH_USAGE_ZH.md](docs/RESEARCH_USAGE_ZH.md)
  - project / task / collection / GPT Step / OpenClaw Auto / Zotero 使用说明
- [docs/PROJECT_OVERVIEW_ZH.md](docs/PROJECT_OVERVIEW_ZH.md)
  - 当前项目总览、架构状态、API 与数据结构摘要

### 更多文档

- [docs/RESEARCH_ARCH.md](docs/RESEARCH_ARCH.md)
- [docs/DEMO_STEPS.md](docs/DEMO_STEPS.md)
- [docs/ROADMAP_ZH.md](docs/ROADMAP_ZH.md)
- [docs/PPT_SHOWCASE_ADVANTAGES_ZH.md](docs/PPT_SHOWCASE_ADVANTAGES_ZH.md)
- [docs/SHOWCASE_REPORT_DRAFT_ZH.md](docs/SHOWCASE_REPORT_DRAFT_ZH.md)
- [docs/README.md](docs/README.md)

## README 设计说明

这版 README 参考了很多热门开源仓库常见的首页结构：

- 顶部 Hero 区
- 先讲清楚它是什么、为什么存在
- 先亮点后实现细节
- Quick Start 放前面
- 文档入口清晰
- demo 和验证入口单独明确给出

这样既方便第一次进入仓库的读者，也适合展示、汇报和答辩场景。

## 后续方向

近期主要优化方向：

- 继续优化前端工作台体验
- 强化 OpenClaw Auto 的阶段推进和报告组织
- 补强 collection compare 与可复用研究分支
- 在真实 Docker 环境中完成 Compose 验证
- 继续拆分过重的 research service 逻辑

## 备注

- `research_local` 是当前默认主线。
- 旧的 WeCom / reminder / mobile auth / admin 链路仍保留在代码里，但默认运行时已经软下线。
- 本地模式下 research API 默认不需要 JWT。
- 当前默认数据库是 SQLite；如果后续更强调并发稳定性，PostgreSQL 是下一步优先选择。
