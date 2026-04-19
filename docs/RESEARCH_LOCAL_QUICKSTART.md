# Research Local Quick Start

## 目标

- 默认运行档位：`research_local`
- 默认目标环境：`WSL / Linux VM`
- 默认开发形态：`backend + worker + frontend` 全部跑在 WSL
- 默认入口：
  - 前端工作台：`http://127.0.0.1:5173`
  - 后端 API：`http://127.0.0.1:8000`
  - OpenClaw gateway：`http://127.0.0.1:18789`

## 当前已验证的本地链路

基于 `2026-04-19` 的最新联调结果，已经验证通过：

- WSL 中启动 `backend + worker`
- WSL 中安装独立 Node 工具链并启动前端 `Vite dev server`
- WSL 中安装并启动本地 OpenClaw gateway
- 前端通过 `/api` 代理访问本机 WSL 后端
- `gpt_step` 的：
  - 任务创建
  - worker 自动消费
  - canvas 读写
  - node chat
  - `explore/start -> propose -> select -> graph`
- `openclaw_auto` 的：
  - `start -> checkpoint -> guidance -> continue -> report/artifact`
- project / collection / study task：
  - 项目创建
  - collection 创建
  - paper 加入 collection
  - 从 collection 创建派生 study task
- Zotero v1 导入：
  - 导入 Zotero collection / item 到本地 collection
- 顺序全链路：
  - `gpt_basic -> gpt_explore -> openclaw_auto`
- 连续 `2` 轮 smoke 稳定性检查全部通过

本轮同时验证并修复：

- SQLite 在 `backend + worker` 并发访问时的锁冲突明显缓解
- 并发建任务时的 `task_id` 冲突已修复
- 画布布局和保存逻辑改成更轻的增量同步

尚未在这台机器上验证：

- `docker compose up --build`
  - 原因：当前环境没有可用 Docker

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

最少建议确认这些变量：

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

如果要启用 OpenClaw Auto：

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

如果你想把 OpenAlex 加入 discovery 默认源，可以额外配置：

```env
RESEARCH_SOURCES_DEFAULT=semantic_scholar,arxiv,openalex
```

## 2. 后端和 Worker

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

这轮已经补了无 sudo 的 WSL 前端方案。

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

## 5. 前端开发说明

当前 `frontend/vite.config.ts` 已配置：

- `/api -> http://127.0.0.1:8000`

所以前端 dev server 可以直接代理到 WSL 后端。

补充说明：

- `frontend/node_modules` 是平台相关目录
- 如果你在 WSL 里执行过 `npm ci` 或 `npm install`，这份依赖目录就是 Linux 版本
- 如果后续要回到 Windows 原生执行前端命令，需要先删除 `frontend/node_modules` 再重新安装

## 6. 当前默认行为

- 只注册 `health` 和 `research` 主路由
- `research_local` 下 research API 默认绑定单例本地用户，无需 JWT
- 企业微信、提醒、移动端认证、Admin、ASR、自建通知链路默认 soft-disable
- `gpt_step` 继续使用现有 step-by-step research API
- `openclaw_auto` 使用：
  - `auto/start`
  - `checkpoint`
  - `guidance`
  - `continue`
- workbench 当前支持：
  - 项目分组
  - 可复用 collection
  - 左右栏折叠
  - 全屏画布
  - collection study task
  - Zotero v1 导入

## 7. Live Smoke 流程

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

1. 创建一个 project
2. 在 project 下创建一个 `GPT Step` task
3. 等方向规划完成后，对某个 direction 开始 explore
4. 选中几篇 paper，加入 collection
5. 从 collection 创建一个新的 study task
6. 创建一个 `OpenClaw Auto` task 并走到 checkpoint
7. 提交一段 guidance，再继续到阶段报告
8. 如果配置了 Zotero，再导入一个 collection

## 9. 当前核心接口

- `GET /api/v1/research/workbench/config`
- `GET /api/v1/research/projects`
- `POST /api/v1/research/projects`
- `GET /api/v1/research/projects/{project_id}/collections`
- `POST /api/v1/research/projects/{project_id}/collections`
- `GET /api/v1/research/collections/{collection_id}`
- `POST /api/v1/research/collections/{collection_id}/items`
- `POST /api/v1/research/collections/{collection_id}/study`
- `POST /api/v1/research/collections/{collection_id}/summarize`
- `POST /api/v1/research/collections/{collection_id}/graph/build`
- `GET /api/v1/research/integrations/zotero/config`
- `POST /api/v1/research/integrations/zotero/import`

## 10. 兼容说明

- `legacy_full` 仍保留
- 旧 PowerShell / Conda / legacy 路由没有删除，只是不再默认参与启动
