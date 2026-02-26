# MemoMate

MemoMate 是一个本地优先（Self-hosted）的企业微信智能备忘录助手。  
你可以像聊天一样发送文字或语音，系统自动理解意图、生成待确认操作、落库并按时提醒。

---

## 项目定位

传统备忘录的问题是“录入重、提醒被动”。MemoMate 的目标是：

- 低摩擦录入：通过企业微信直接说人话，不填表单
- 本地隐私优先：后端、数据库、模型可在本机运行
- 可替换能力层：LLM/ASR 均预留 local / external provider 切换
- 可演示闭环：新增 -> 确认 -> 查询 -> 删除 -> 到点提醒

---

## 当前能力（V1）

- 企业微信双向消息：`GET /wechat` 验签，`POST /wechat` 入站处理
- 文本提醒闭环：意图解析、二次确认、SQLite 持久化、调度推送
- 语音转文字：优先使用企业微信 `Recognition`，否则走本地 ASR
- 幂等去重：同一 `msg_id` 重试不会重复执行业务动作
- Provider 抽象：Intent LLM、Reply LLM、ASR 均支持配置切换与回退
- 可观测接口：`/api/v1/health` 与 `/api/v1/capabilities`

---

## 技术栈

- Backend: FastAPI + Uvicorn
- DB: SQLite + SQLAlchemy
- Scheduler: APScheduler
- WeCom SDK: wechatpy + 自定义 client
- LLM: Ollama（默认 `qwen3:8b`）
- ASR: faster-whisper + FFmpeg
- Tunnel: Cloudflare Tunnel（quick 或 named）

---

## 核心流程

1. 企业微信回调进入 `/wechat`
2. 服务快速 ACK（200），后台异步处理消息
3. 入站消息按 `msg_id` 去重
4. 语音消息转写为文本（Recognition 或本地 ASR）
5. LLM 解析意图（add/query/delete/update）
6. 写操作进入待确认状态，用户回复“确认/取消”
7. 确认后写入提醒，APScheduler 周期扫描并触发推送

---

## 目录结构

```text
app/
  api/           # wechat, mobile, health 接口
  core/          # 配置、日志、时区
  domain/        # 枚举、ORM 模型、schema
  infra/         # DB 与仓储、WeCom client
  llm/           # prompt、ollama client、provider
  services/      # 业务服务（intent/asr/reminder/...）
  workers/       # 调度派发
scripts/         # 启动与隧道脚本
tests/           # 单元与集成测试
docs/            # 演示文档
```

---

## 快速开始

### 1. 环境准备

- Python（建议 3.10+）
- FFmpeg（语音转写必需）
- Ollama（本地 LLM）
- Cloudflared（需要企业微信公网回调时）

### 2. 安装依赖

```powershell
pip install -r requirements.txt
```

### 3. 配置环境变量

```powershell
copy .env.example .env
```

至少补齐以下企业微信配置：

- `WECOM_TOKEN`
- `WECOM_AES_KEY`
- `WECOM_CORP_ID`
- `WECOM_AGENT_ID`
- `WECOM_SECRET`

### 4. 启动方式

- 一键先测再启（推荐开发态）：

```powershell
.\scripts\one_click_start_and_test.ps1
```

- 启动后端 + tunnel：

```powershell
.\scripts\start_all.ps1
```

- 仅启动后端：

```powershell
.\scripts\start_backend.ps1
```

---

## 企业微信回调地址

### quick tunnel（临时域名）

- 每次启动 URL 都会变化，适合本地临时调试

### named tunnel（固定域名）

- 首次配置一次，后续 URL 稳定
- 可使用：

```powershell
.\scripts\one_click_test.ps1
```

或手动：

```powershell
.\scripts\setup_named_tunnel.ps1 -Hostname memomate.yourdomain.com
```

---

## API 总览

- `GET /wechat` 企业微信 URL 验签
- `POST /wechat` 企业微信消息入口（文本/语音）
- `GET /api/v1/health` 健康检查
- `GET /api/v1/capabilities` 当前 provider 能力映射
- `POST /api/v1/auth/pair` 移动端配对换 token
- `POST /api/v1/auth/refresh` 刷新 token
- `GET/POST/PATCH/DELETE /api/v1/reminders` 提醒管理
- `GET /api/v1/calendar` 日历视图
- `POST /api/v1/asr/transcribe` 本地语音转文字（Bearer + multipart）

---

## 测试与演示

- 运行测试：

```powershell
python -m pytest -q
```

- 本地 smoke（不依赖企业微信）：

```powershell
python .\scripts\smoke_intent_flow.py
```

- 开发演示步骤见：

`docs/DEMO_STEPS.md`

---

## 常见问题

- `cloudflared` 在 VSCode 终端不可用：使用 `.\cloudflared.exe` 或确认 PATH
- `faster-whisper is not installed`：执行 `pip install -r requirements.txt`
- 企业微信发不出消息 `errcode 60020`：检查企业可信 IP 白名单
- `address already in use :8000`：结束占用进程或修改 `APP_PORT`

---

## 安全说明

- `.env`、数据库、缓存、`cloudflared.exe` 已在 `.gitignore` 中排除
- 请勿把真实密钥提交到仓库
