# Research Local Quick Start

## 目标

- 默认运行档位：`research_local`
- 默认目标环境：`WSL / Linux VM`
- 默认开发形态：`backend + worker + frontend`
- 默认入口：
  - 前端工作台：`http://127.0.0.1:5173`
  - 后端 API：`http://127.0.0.1:8000`
  - OpenClaw gateway：`http://127.0.0.1:18789`

## 当前已验证通过的本地链路

基于 `2026-04-19` 的最新联调结果，已经验证通过：

- WSL 中启动 `backend + worker`
- WSL 中安装本地 Node 工具链并启动前端 `Vite dev server`
- WSL 中安装并启动本地 OpenClaw gateway
- 前端通过 `/api` 代理访问本机 WSL 后端
- `GPT Step` 的：
  - 任务创建
  - worker 自动消费
  - canvas 读写
  - node chat
  - `explore/start -> propose -> select -> graph`
- `OpenClaw Auto` 的：
  - `start -> checkpoint -> guidance -> continue -> report/artifact`
- `project / collection / study task`：
  - 项目创建
  - collection 创建
  - paper 加入 collection
  - 从 collection 创建派生 study task
- Zotero v1 导入：
  - 导入 Zotero collection / item 到本地 collection
- 顺序全链路：
  - `gpt_basic -> gpt_explore -> openclaw_auto`

## WSL 前置条件

建议 WSL 至少有这些工具：

```bash
python3
python3-venv
python3-pip
curl
tar
```

如果当前 WSL 缺少 `python3-venv` 或 `pip`，可以先用用户态方式补齐：

```bash
curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
python3 /tmp/get-pip.py --user --break-system-packages
~/.local/bin/pip install --user virtualenv --break-system-packages
```

## 1. 准备 `.env`

先复制：

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

如果要启用 `OpenClaw Auto`：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=main
```

如果要启用 Zotero 导入：

```env
ZOTERO_BASE_URL=https://api.zotero.org
ZOTERO_LIBRARY_TYPE=users
ZOTERO_LIBRARY_ID=...
ZOTERO_API_KEY=...
```

如果你想把 `OpenAlex` 加入 discovery 默认源，可以额外配置：

```env
RESEARCH_SOURCES_DEFAULT=semantic_scholar,arxiv,openalex
```

## 2. 后端和 worker

创建 WSL Python 环境：

```bash
~/.local/bin/virtualenv .venv-wsl
```

安装 research-local 依赖：

```bash
.venv-wsl/bin/python -m pip install -r requirements-research-local.txt
```

启动：

```bash
bash scripts/start_research_local_wsl.sh
```

停止：

```bash
bash scripts/stop_research_local_wsl.sh
```

## 3. OpenClaw WSL 启停

如果你已经在 WSL 中装好了 OpenClaw，并在 `.env` 中填写了：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=main
```

可以直接用仓库里的脚本管理 gateway。

启动：

```bash
bash scripts/start_openclaw_wsl.sh
```

停止：

```bash
bash scripts/stop_openclaw_wsl.sh
```

## 4. 前端迁移到 WSL

这一轮已经补了无 `sudo` 的 WSL 前端方案。

### 4.1 安装 WSL 本地 Node

脚本会把 Node 下载到仓库内的 `.wsl-tools/`，不污染系统环境：

```bash
bash scripts/install_frontend_node_wsl.sh
```

默认版本来自 [frontend/.nvmrc](/d:/project/OpenClaw-for-paper-research/frontend/.nvmrc)。

### 4.2 启动前端

```bash
bash scripts/start_frontend_wsl.sh
```

停止：

```bash
bash scripts/stop_frontend_wsl.sh
```

### 4.3 构建前端

```bash
bash scripts/build_frontend_wsl.sh
```

产物目录：

```text
frontend/dist
```

### 4.4 打包前端

```bash
bash scripts/package_frontend_wsl.sh
```

打包输出：

```text
artifacts/releases/research-workbench-v<version>-<timestamp>.tar.gz
```

## 5. 启动后先做健康检查

浏览器或命令行访问：

```bash
curl http://127.0.0.1:8000/api/v1/health
```

重点确认：

- `db_ok`
- `profile=research_local`
- 后端没有直接报错退出

## 6. API 连通性检查

如果你想先单独确认“接口通不通”，而不是直接跑整条 research 流程，推荐使用：

```bash
bash scripts/run_api_connectivity_check_wsl.sh --iterations 10 --json-out artifacts/research-api-check/current.json
```

这份检查的目标是：

- 确认基础健康接口正常
- 确认 workbench 配置接口正常
- 确认 project / collection / task / canvas / run events / zotero config 这些核心接口可以直接访问

它和 live smoke 的区别是：

- `api_connectivity_check`
  - 偏接口级别
  - 更适合排查“接口有没有通”
- `research_live_smoke`
  - 偏完整业务链路
  - 更适合排查“研究流程能不能完整跑通”

补充说明：

- 这份检查会创建临时 project、collection、task。
- 当 worker 正在持续消费任务，而底层数据库仍是 SQLite 时，连续压测可能出现少量超时。
- 如果你要做更稳定的长期演示，建议后续迁移到 PostgreSQL。

## 7. Live Smoke

已提供：

- `scripts/research_live_smoke.py`
- `scripts/run_research_live_smoke_wsl.sh`

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

如果你希望保留 JSON 结果：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2 --json-out artifacts/research-live-smoke/all-2x.json
```

## 8. 初次启动后建议验证的功能

进入前端之后，建议按这个顺序试：

1. 创建一个 `project`
2. 在 `project` 下创建一个 `GPT Step` task
3. 等方向规划完成后，对某个 `direction` 开始 `explore`
4. 选中几篇 `paper`，加入 `collection`
5. 从 `collection` 创建一个新的 `study task`
6. 创建一个 `OpenClaw Auto` task 并走到 `checkpoint`
7. 提交一段 `guidance`，再继续到阶段报告
8. 如果配置了 Zotero，再导入一个 collection

## 9. 当前核心接口

- `GET /api/v1/research/workbench/config`
- `GET /api/v1/research/projects`
- `POST /api/v1/research/projects`
- `GET /api/v1/research/projects/{project_id}`
- `GET /api/v1/research/projects/{project_id}/collections`
- `POST /api/v1/research/projects/{project_id}/collections`
- `GET /api/v1/research/collections/{collection_id}`
- `POST /api/v1/research/collections/{collection_id}/items`
- `POST /api/v1/research/collections/{collection_id}/study`
- `POST /api/v1/research/collections/{collection_id}/summarize`
- `POST /api/v1/research/collections/{collection_id}/graph/build`
- `GET /api/v1/research/tasks`
- `POST /api/v1/research/tasks`
- `GET /api/v1/research/tasks/{task_id}`
- `GET /api/v1/research/tasks/{task_id}/canvas`
- `PUT /api/v1/research/tasks/{task_id}/canvas`
- `GET /api/v1/research/integrations/zotero/config`
- `POST /api/v1/research/integrations/zotero/import`

## 10. 兼容说明

- `legacy_full` 仍保留
- 旧 PowerShell / Conda / legacy 路由没有删除，只是不再默认参与启动
