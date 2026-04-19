# Research Workbench 使用说明

这份文档面向当前默认主线：`research_local`。

目标读者是已经把系统跑起来，接下来要实际使用工作台完成研究任务的人。

## 1. 进入系统

默认地址：

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`

当前 `research_local` 下不需要 JWT。

你只要把后端、worker、前端跑起来，就可以直接进入工作台。

## 2. 先理解三个核心对象

### 2.1 项目 `project`

project 是顶层研究分组。

适合这些场景：

- 同时调研多个主题
- 把不同任务按主题隔开
- 为同一研究方向维护多个 task 和多个 collection

当前工作台左侧已经支持：

- 创建 project
- 切换当前 project
- 查看 project 下的 tasks
- 查看 project 下的 collections

### 2.2 研究任务 `task`

task 是一次实际运行的研究流程。

当前支持两类：

- `GPT Step`
- `OpenClaw Auto`

task 可以来自：

- 直接输入 topic 创建
- 从 collection 创建派生 study task

### 2.3 论文集合 `collection`

collection 是项目级、可复用、可命名的论文集合。

它不是临时选择，而是长期保留的组织层。

你可以：

- 从当前任务中选中多篇 paper 加入 collection
- 手动新建空 collection
- 从 collection 创建 study task
- 对 collection 做总结和图谱构建

## 3. 两种研究模式

### 3.1 `GPT Step`

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

### 3.2 `OpenClaw Auto`

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

## 4. 推荐操作顺序

### 4.1 从 project 开始

建议先在左侧创建一个新的 project。

这样后面创建的 task 和 collection 会更清晰，不会全堆在默认项目里。

### 4.2 创建一个 `GPT Step` task

输入 topic，选择：

- 模式：`GPT Step`
- 后端：`GPT`
- 模型：例如 `gpt-5.4`

创建成功后，worker 会自动处理规划任务。

### 4.3 等待方向规划

任务创建后，系统会生成若干研究方向。

这一阶段你主要关注：

- 方向名称是否合理
- 查询词是否贴题
- 有没有明显缺失的重要路线

### 4.4 开始第一轮探索

选择某个方向后，触发：

- `继续探索`

系统会创建 round，并开始为这一轮做检索。

### 4.5 生成候选方向

当你想继续深入时，使用：

- `生成候选`

适合给出的反馈包括：

- 更偏方法
- 更偏评测
- 更偏可解释性
- 更偏系统工程

### 4.6 选择下一轮

从 candidates 中选择一个，进入子 round。

这时你可以继续：

- 深挖
- 转向
- 收敛

## 5. collection 的推荐用法

### 5.1 从任务里收集论文

当你在画布上选中了多篇 `paper` 节点后，可以：

- 加入现有 collection
- 新建 collection 并加入

当前只允许 `paper` 节点进入 collection。

### 5.2 从 collection 创建派生研究任务

当一个 collection 已经积累到足够的论文后，可以：

- 点击 `基于集合继续调研`

这会创建一个新的 study task。

这个 task 的 seed corpus 会优先来自 collection，而不只是依赖重新检索 topic。

适合这些场景：

- 对一组相关论文继续扩展
- 从某个筛选过的小集合出发做更深一轮研究
- 对比不同 collection 派生出的研究路线

### 5.3 collection 级动作

当前 collection detail 支持：

- `总结集合`
- `基于集合继续调研`
- `构建集合图谱`

## 6. OpenClaw Auto 的推荐操作顺序

### 6.1 创建任务

创建 task 时选择：

- 模式：`OpenClaw Auto`
- 后端：`OpenClaw`
- 模型：例如 `openclaw:main`

### 6.2 启动自动研究

启动后，OpenClaw 会先产出：

- topic 节点
- direction 节点
- 边关系
- 第一版 checkpoint

### 6.3 等待 checkpoint

在第一个 checkpoint 到来之前，不需要手动继续点下一步。

此时重点关注：

- 图谱是否已经形成合理骨架
- 有没有遗漏你关心的研究路线
- 报告摘要是否符合预期

### 6.4 提交 guidance

建议 guidance 写法保持直接：

- 请优先关注某个方向
- 请补充某类论文
- 请更强调评估/系统/应用
- 请给出阶段性结论与下一步建议

当前首版 guidance 是自由文本，不需要 DSL。

### 6.5 查看阶段报告和产物

继续运行后，系统会生成：

- `report_chunk`
- `artifact`

artifact 默认会写到：

```text
artifacts/research/<task_id>/runs/<run_id>/
```

## 7. Zotero v1 导入

当前 Zotero 只做第一阶段的“读入”。

它的行为是：

- 读取 Zotero collection / item
- 映射到本地 project 下的 collection
- 不直接污染 canonical paper 表

推荐顺序：

1. 在 `.env` 中配置 Zotero
2. 在工作台左侧使用导入入口
3. 选择要导入的 Zotero collection
4. 导入后检查本地 collection
5. 再从这个 collection 创建 study task

当前还不支持：

- 双向同步
- 将本地注释写回 Zotero
- 实时监听 Zotero 变化

## 8. 画布与三栏工作台

### 8.1 当前布局

工作台默认是全屏三栏：

- 左侧：project / task / collection / provider 状态
- 中间：卡片式研究画布
- 右侧：详情、Context Chat、Run Timeline、PDF / Fulltext

### 8.2 折叠与宽度

当前支持：

- 左栏折叠
- 右栏折叠
- 左右栏宽度持久化

这些状态会保存在 `canvas.ui` 里，刷新后仍保留。

### 8.3 画布规则

- 系统节点不能真删除，只能隐藏或补充注释
- 手工节点和手工边可以自己增删
- 用户拖拽、备注、颜色、隐藏状态都保存到 `canvas state`
- `canvas state` 不会直接覆盖 canonical graph

### 8.4 当前节点类型

系统节点：

- `topic`
- `direction`
- `round`
- `paper`
- `checkpoint`
- `report`

手工节点：

- `note`
- `group`
- `reference`
- `question`

## 9. 右侧面板怎么用

右侧面板主要用于：

- 查看节点详情
- 看 `Why it matters`
- 进行 `Context Chat`
- 查看 PDF / Fulltext
- 看运行日志
- 查看 collection 详情

其中：

- `Context Chat` 只基于当前节点上下文
- `Run Timeline` 在 OpenClaw 模式下会显示阶段事件
- `PDF / Fulltext` 在无资产时会显示缺失状态

## 10. PDF、全文和产物

### 10.1 PDF / Fulltext

当论文已有 PDF 时：

- 可以在右侧打开 PDF
- 或者通过资产接口直接访问

如果没有 PDF：

- 页面会显示 `Need upload`

### 10.2 导出目录

研究相关产物默认在：

```text
artifacts/research/
```

保存论文、阶段报告、导出结果也都会落在这里。

## 11. API Key 在哪里填

### 11.1 GPT

在 `.env` 中填写：

```env
RESEARCH_GPT_API_KEY=你的_key
RESEARCH_GPT_MODEL=gpt-5.4
RESEARCH_GPT_BASE_URL=https://api.openai.com/v1
```

### 11.2 OpenClaw

如果你已经在 WSL 里装好 OpenClaw，并启用了本地 gateway：

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=你的_gateway_token
OPENCLAW_AGENT_ID=main
```

### 11.3 Zotero

如果要启用 Zotero 导入：

```env
ZOTERO_BASE_URL=https://api.zotero.org
ZOTERO_LIBRARY_TYPE=users
ZOTERO_LIBRARY_ID=你的_library_id
ZOTERO_API_KEY=你的_api_key
```

## 12. 推荐的日常检查命令

### 12.1 跑完整 smoke

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

### 12.2 跑双轮稳定性

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

### 12.3 只检查 OpenClaw Auto

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario openclaw_auto
```

## 13. 当前已验证进度

截至 `2026-04-19`，已经验证通过：

- `gpt_basic`
- `gpt_explore`
- `openclaw_auto`
- 顺序全链路 `gpt_basic -> gpt_explore -> openclaw_auto`
- 连续 `2` 轮稳定性检查
- project / collection / study task 主流程
- Zotero 导入到本地 collection

同时已经修复并验证：

- SQLite 高频读写下的锁冲突问题明显缓解
- 并发建任务时的 `task_id` 冲突问题已消除

## 14. 常见问题

### 14.1 PowerShell 里中文偶尔乱码

这通常是终端编码问题，不影响真实的 API 逻辑和数据库落库。

### 14.2 WSL 会打印 localhost / NAT 警告

当前实测不影响：

- 前端访问
- 后端访问
- OpenClaw gateway 访问

### 14.3 为什么没有企业微信/提醒/移动端功能

因为当前默认主线是 `research_local`。

这些 legacy 功能代码还在，但默认 soft-disable，不进入当前主运行链路。
