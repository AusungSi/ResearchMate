# Research Workbench 使用说明

这份文档面向当前默认主线：`research_local`。

目标读者是已经把系统跑起来，接下来要实际使用工作台完成研究任务的人。

## 1. 进入系统

默认地址：

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`

当前 `research_local` 下不需要 JWT。

你只要把后端、worker、前端跑起来，就可以直接进入工作台。

## 2. 两种研究模式

### 2.1 `GPT Step`

这是半自动模式。

适合这些场景：

- 你希望自己控制研究节奏
- 你想逐步筛方向、逐步深入
- 你不希望模型连续跑太多步

它的特点是：

- 创建任务后先规划方向
- 由你决定先探索哪个方向
- 由你决定何时生成 candidates
- 由你决定选择哪个 candidate 进入下一轮
- 节点问答只回答当前节点上下文，不会接管整个研究流程

### 2.2 `OpenClaw Auto`

这是分阶段自治模式。

适合这些场景：

- 你希望 OpenClaw 先自动跑出第一版研究图谱
- 你更关注 checkpoint 之后的引导，而不是每一步都手动点按钮
- 你需要中间事件流、阶段报告和产物文件

它的特点是：

- 启动后会自动推进
- 在 `checkpoint` 暂停
- 你提交 guidance 后继续
- 最终会产生阶段报告与 artifact

## 3. GPT Step 的推荐操作顺序

### 3.1 创建任务

输入 topic，选择：

- 模式：`GPT Step`
- 后端：`GPT`
- 模型：例如 `gpt-5.4`

创建成功后，worker 会自动处理规划任务。

### 3.2 等待方向规划

任务创建后，系统会生成若干研究方向。

这一阶段你主要关注：

- 方向名称是否合理
- 查询词是否贴题
- 有没有明显缺失的重要路线

### 3.3 开始第一轮探索

选择某个方向后，触发：

- `Explore next`

系统会创建 round，并开始为这一轮做检索。

### 3.4 生成候选方向

当你想继续深入时，使用：

- `Generate candidates`

适合给出的反馈包括：

- 更偏方法
- 更偏评测
- 更偏可解释性
- 更偏系统工程

### 3.5 选择下一轮

从 candidates 中选择一个，进入子 round。

这时你可以继续：

- 深挖
- 转向
- 收敛

### 3.6 使用右侧面板

右侧面板主要用于：

- 查看节点详情
- 看 `Why it matters`
- 进行 `Context Chat`
- 查看 PDF / Fulltext
- 看运行日志

## 4. OpenClaw Auto 的推荐操作顺序

### 4.1 创建任务

创建 task 时选择：

- 模式：`OpenClaw Auto`
- 后端：`OpenClaw`
- 模型：例如 `openclaw:main`

### 4.2 启动自动研究

启动后，OpenClaw 会先产出：

- topic 节点
- direction 节点
- 边关系
- 第一版 checkpoint

### 4.3 等待 checkpoint

在第一个 checkpoint 到来之前，不需要手动继续点下一步。

此时重点关注：

- 图谱是否已经形成合理骨架
- 有没有遗漏你关心的研究路线
- 报告摘要是否符合预期

### 4.4 提交 guidance

建议 guidance 写法保持直接：

- 请优先关注某个方向
- 请补充某类论文
- 请更强调评估/系统/应用
- 请给出阶段性结论与下一步建议

当前首版 guidance 是自由文本，不需要 DSL。

### 4.5 查看阶段报告和产物

继续运行后，系统会生成：

- `report_chunk`
- `artifact`

artifact 默认会写到：

```text
artifacts/research/<task_id>/runs/<run_id>/
```

## 5. 工作台上的常见对象

### 5.1 系统节点

- `topic`
- `direction`
- `round`
- `paper`
- `checkpoint`
- `report`

### 5.2 手工节点

- `note`
- `group`
- `reference`
- `question`

### 5.3 画布规则

- 系统节点不能真删除，只能隐藏或补充注释
- 手工节点和手工边可以自己增删
- 用户拖拽、备注、颜色、隐藏状态都保存到 `canvas state`
- `canvas state` 不会直接覆盖 canonical graph

## 6. PDF、全文和产物

### 6.1 PDF / Fulltext

当论文已有 PDF 时：

- 可以在右侧打开 PDF
- 或者通过资产接口直接访问

如果没有 PDF：

- 页面会显示 `Need upload`

### 6.2 导出目录

研究相关产物默认在：

```text
artifacts/research/
```

保存论文、阶段报告、导出结果也都会落在这里。

## 7. API Key 在哪里填

### 7.1 GPT

在 `.env` 中填写：

```env
RESEARCH_GPT_API_KEY=你的_key
RESEARCH_GPT_MODEL=gpt-5.4
RESEARCH_GPT_BASE_URL=https://api.openai.com/v1
```

### 7.2 OpenClaw

如果你已经在 WSL 里装好 OpenClaw，并启用了本地 gateway：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=你的_gateway_token
OPENCLAW_AGENT_ID=main
```

## 8. 推荐的日常检查命令

### 8.1 跑完整 smoke

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

### 8.2 跑双轮稳定性

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

### 8.3 只检查 OpenClaw Auto

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario openclaw_auto
```

## 9. 当前已验证进度

截至 `2026-04-18`，已经验证通过：

- `gpt_basic`
- `gpt_explore`
- `openclaw_auto`
- 顺序全链路 `gpt_basic -> gpt_explore -> openclaw_auto`
- 连续 `2` 轮稳定性检查

同时已经修复并验证：

- SQLite 高频读写下的锁冲突问题明显缓解
- 并发建任务时的 `task_id` 冲突问题已消除

## 10. 常见问题

### 10.1 PowerShell 里中文偶尔乱码

这通常是终端编码问题，不影响真实的 API 逻辑和数据库落库。

### 10.2 WSL 会打印 localhost / NAT 警告

当前实测不影响：

- 前端访问
- 后端访问
- OpenClaw gateway 访问

### 10.3 为什么没有企业微信/提醒/移动端功能

因为当前默认主线是 `research_local`。

这些 legacy 功能代码还在，但默认 soft-disable，不进入当前主运行链路。
