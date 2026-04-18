# OpenClaw for Paper Research

一个面向本地 `WSL / Linux VM` 的单用户研究工作台。

当前主线已经切到 `research_local`，核心目标是把论文调研过程统一到一个本地可运行的工作台里，支持两种模式：

- `GPT Step`
  - 半自动，用户逐步决定下一步研究动作。
- `OpenClaw Auto`
  - 分阶段自治运行，在 `checkpoint` 暂停并等待用户补充 guidance。

## 当前状态

截至 `2026-04-18`，当前仓库已经完成并验证：

- WSL 中运行 `backend + worker + frontend`
- WSL 中安装并启动本地 OpenClaw gateway
- `GPT Step` live smoke：
  - `gpt_basic`
  - `gpt_explore`
- `OpenClaw Auto` live smoke：
  - `start -> checkpoint -> guidance -> continue -> report/artifact`
- 总控 smoke 脚本顺序跑通：
  - `gpt_basic -> gpt_explore -> openclaw_auto`
  - 连续 `2` 轮全部通过

这轮还补了两个稳定性修复：

- SQLite 在 `backend + worker` 同时访问时启用更友好的 `busy_timeout / WAL`
- `task_id` 改为时间戳加短随机后缀，避免并发创建任务时撞 ID

## 默认访问地址

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`
- OpenClaw gateway：`http://127.0.0.1:18789`

## 文档入口

- [docs/RESEARCH_LOCAL_QUICKSTART.md](docs/RESEARCH_LOCAL_QUICKSTART.md)
  - WSL 启动、OpenClaw 启停、smoke 命令
- [docs/RESEARCH_USAGE_ZH.md](docs/RESEARCH_USAGE_ZH.md)
  - 日常使用说明，包含 GPT Step 和 OpenClaw Auto
- [docs/PROJECT_OVERVIEW_ZH.md](docs/PROJECT_OVERVIEW_ZH.md)
  - 当前架构、数据结构、接口与重构进度
- [docs/ROADMAP_ZH.md](docs/ROADMAP_ZH.md)
  - 下一步优化方向
- [docs/README.md](docs/README.md)
  - `docs/` 文档索引

## 快速开始

### 1. 复制配置

```bash
cp .env.example .env
```

至少确认这些变量：

```env
APP_PROFILE=research_local
DB_URL=sqlite:///./data/memomate.db
RESEARCH_ENABLED=true
RESEARCH_QUEUE_MODE=worker
RESEARCH_GPT_API_KEY=...
RESEARCH_GPT_MODEL=gpt-5.4
```

如果要启用真实 OpenClaw：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=main
```

### 2. 安装 research-local 依赖

```bash
python3 -m venv .venv-wsl
.venv-wsl/bin/python -m pip install -r requirements-research-local.txt
```

### 3. 启动后端和 worker

```bash
bash scripts/start_research_local_wsl.sh
```

### 4. 启动前端

```bash
bash scripts/install_frontend_node_wsl.sh
bash scripts/start_frontend_wsl.sh
```

### 5. 启动 OpenClaw gateway

如果你已经在 WSL 中装好了 OpenClaw：

```bash
bash scripts/start_openclaw_wsl.sh
```

停止：

```bash
bash scripts/stop_openclaw_wsl.sh
```

## Smoke 测试

单独跑某条链路：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_basic
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_explore
bash scripts/run_research_live_smoke_wsl.sh --scenario openclaw_auto
```

顺序跑完整主链路：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

连续跑两轮稳定性检查：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

脚本会输出 JSON 摘要，并在有 `--json-out` 时保存到文件。

## 当前推荐使用方式

### GPT Step

适合需要人工控节奏的调研：

1. 创建 task
2. 等待方向规划
3. 选择方向开始 explore
4. 生成 candidates
5. 选择下一轮
6. 需要时查看图谱、PDF、node chat

### OpenClaw Auto

适合让 OpenClaw 自行跑第一阶段研究：

1. 创建 `openclaw_auto` task
2. 启动 auto run
3. 等待 checkpoint
4. 输入 guidance
5. 继续自动研究
6. 查看阶段报告和 artifact

## 关键脚本

- `scripts/start_research_local_wsl.sh`
- `scripts/stop_research_local_wsl.sh`
- `scripts/start_frontend_wsl.sh`
- `scripts/stop_frontend_wsl.sh`
- `scripts/start_openclaw_wsl.sh`
- `scripts/stop_openclaw_wsl.sh`
- `scripts/research_live_smoke.py`
- `scripts/run_research_live_smoke_wsl.sh`

## 仓库结构

```text
app/                  FastAPI 后端与 research 服务
frontend/             React 工作台
docs/                 中文文档与设计说明
scripts/              WSL 启停、构建、打包、smoke 脚本
tests/                主要后端测试
artifacts/            研究报告、导出文件、前端打包产物
data/                 本地 SQLite 数据
```

## 说明

- 旧的企业微信、提醒、移动端认证、Admin、ASR 链路仍保留在代码里，但默认不进入 `research_local` 启动链路。
- 当前最值得优先阅读的文档是：
  - [docs/RESEARCH_LOCAL_QUICKSTART.md](docs/RESEARCH_LOCAL_QUICKSTART.md)
  - [docs/RESEARCH_USAGE_ZH.md](docs/RESEARCH_USAGE_ZH.md)
  - [docs/PROJECT_OVERVIEW_ZH.md](docs/PROJECT_OVERVIEW_ZH.md)
