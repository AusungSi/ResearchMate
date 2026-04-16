# Research Local Quick Start

## 目标

- 默认运行档位：`research_local`
- 默认目标环境：`WSL / Linux VM`
- 默认开发形态：`backend + worker + frontend` 全部跑在 WSL
- 默认入口：
  - 前端工作台：`http://127.0.0.1:5173`
  - 后端 API：`http://127.0.0.1:8000`

## 当前已验证的本地链路

基于 2026-04-16 的实际联调结果，已经验证通过：

- WSL 中启动 `backend + worker`
- WSL 中安装独立 Node 工具链并启动前端 `Vite dev server`
- 前端通过 `/api` 代理访问本机 WSL 后端
- `gpt_step` 的任务创建、worker 自动消费、canvas 读写、node chat
- `openclaw_auto` 的 `start -> checkpoint -> guidance -> continue -> report/artifact`

尚未在这台机器上验证：

- `docker compose up --build`
  - 原因：当前 Windows 和 WSL 都没有可用 Docker

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

## 后端和 Worker

1. 创建 WSL Python 环境：

```bash
~/.local/bin/virtualenv .venv-wsl
```

2. 安装 research-local 依赖：

```bash
.venv-wsl/bin/python -m pip install -r requirements-research-local.txt
```

3. 启动：

```bash
bash scripts/start_research_local_wsl.sh
```

4. 停止：

```bash
bash scripts/stop_research_local_wsl.sh
```

## 前端迁移到 WSL

这轮已经补了无 sudo 的 WSL 前端方案。

### 1. 安装 WSL 本地 Node

脚本会把 Node 下载到仓库内的 `.wsl-tools/`，不污染系统环境：

```bash
bash scripts/install_frontend_node_wsl.sh
```

默认版本来自 [frontend/.nvmrc](/d:/project/OpenClaw-for-paper-research/frontend/.nvmrc)。

### 2. 启动前端

```bash
bash scripts/start_frontend_wsl.sh
```

停止：

```bash
bash scripts/stop_frontend_wsl.sh
```

### 3. 构建前端

```bash
bash scripts/build_frontend_wsl.sh
```

产物目录：

```text
frontend/dist
```

### 4. 打包前端

```bash
bash scripts/package_frontend_wsl.sh
```

打包输出：

```text
artifacts/releases/research-workbench-v<version>-<timestamp>.tar.gz
```

包内会包含：

- `dist/`
- `nginx.conf`
- `package.json`
- `RESEARCH_LOCAL_QUICKSTART.md`

## 前端开发说明

当前 `frontend/vite.config.ts` 已配置：

- `/api -> http://127.0.0.1:8000`

所以前端 dev server 可以直接代理到 WSL 后端。

另外这轮把 `frontend/package.json` 的脚本改成了显式调用本地 `node_modules`：

- `npm run dev`
- `npm run build`
- `npm run preview`

这样可以避免部分 Windows / PowerShell 环境下找不到 `tsc` 的问题。

补充说明：

- `frontend/node_modules` 是平台相关目录
- 如果你在 WSL 里执行过 `npm ci`，这份依赖目录就是 Linux 版本
- 如果后续又想回到 Windows 原生执行前端命令，需要先删除 `frontend/node_modules` 再重新 `npm install`

## 可选环境变量

最少建议确认这些变量：

```env
APP_PROFILE=research_local
DB_URL=sqlite:///./data/memomate.db
RESEARCH_ENABLED=true
RESEARCH_QUEUE_MODE=worker
RESEARCH_ARTIFACT_DIR=./artifacts/research
RESEARCH_SAVE_BASE_DIR=./artifacts/research/saved
```

如果要启用 GPT API：

```env
RESEARCH_GPT_API_KEY=...
RESEARCH_GPT_MODEL=gpt-5.4-mini
RESEARCH_GPT_BASE_URL=https://api.openai.com/v1
```

如果要启用真实 OpenClaw：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=...
OPENCLAW_AGENT_ID=...
OPENCLAW_GATEWAY_TOKEN=...
```

## 当前默认行为

- 只注册 `health` 和 `research` 主路由
- `research_local` 下 research API 默认绑定单例本地用户，无需 JWT
- 企业微信、提醒、移动端认证、Admin、ASR、自建通知链路默认 soft-disable
- `gpt_step` 继续使用现有 step-by-step research API
- `openclaw_auto` 使用：
  - `auto/start`
  - `checkpoint`
  - `guidance`
  - `continue`

## 核心接口

- `POST /api/v1/research/tasks`
- `GET /api/v1/research/tasks`
- `GET /api/v1/research/tasks/{task_id}`
- `GET /api/v1/research/tasks/{task_id}/canvas`
- `PUT /api/v1/research/tasks/{task_id}/canvas`
- `POST /api/v1/research/tasks/{task_id}/nodes/{node_id}/chat`
- `POST /api/v1/research/tasks/{task_id}/auto/start`
- `GET /api/v1/research/tasks/{task_id}/runs/{run_id}/events`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/guidance`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/continue`
- `POST /api/v1/research/tasks/{task_id}/runs/{run_id}/cancel`

## 模式说明

### `gpt_step`

- 半自动
- 用户显式决定下一步动作
- 更适合逐步收敛方向、人工控制研究路线

### `openclaw_auto`

- 阶段式自动运行
- 第一阶段先生成 topic/direction 图谱并停在 checkpoint
- 用户提交 guidance 后继续生成阶段报告和产物
- 如果本地没有接入真实 OpenClaw，目前会输出保守 fallback report，保证联调可继续

## 本次实测补充

- 当前 WSL 会打印一条 localhost / NAT 警告，但不影响访问
- SQLite 在 worker 写入期间对高频读写比较敏感，所以前端轮询接口应尽量避免无意义写操作
- 当前仓库已经补了前端 WSL 脚本，不再依赖 Windows Node 才能跑开发环境

## 兼容说明

- `legacy_full` 仍保留
- 旧 PowerShell / Conda / legacy 路由没有删除，只是不再默认参与启动
