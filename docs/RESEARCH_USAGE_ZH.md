# Research Workbench 用户使用说明书

更新时间：2026-04-21

这份文档面向当前默认主线 `research_local`。
目标是把“这个工具现在能做什么、怎么做、做完会看到什么结果”一次讲清楚，方便你自己使用，也方便拿给别人演示。

如果你还没有启动系统，先看：

- [RESEARCH_LOCAL_QUICKSTART.md](RESEARCH_LOCAL_QUICKSTART.md)

如果你想先准备可展示的演示数据，再开始使用，先看：

- [DEMO_STEPS.md](DEMO_STEPS.md)

## 1. 系统是什么

当前项目是一个本地单用户研究工作台，核心目标是围绕论文做持续调研，而不是一次性搜索。

系统目前有两种研究模式：

- `GPT Step`
  - 半自动模式。
  - 由你决定什么时候规划方向、检索方向、继续探索、生成候选、构建图谱、处理全文。
- `OpenClaw Auto`
  - 分阶段自治模式。
  - 启动后自动推进，在 `checkpoint` 暂停，等待你提交 `guidance` 后继续。

系统默认运行在本地：

- 前端工作台：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:8000`
- OpenClaw gateway：`http://127.0.0.1:18789`

当前 `research_local` 下不需要 JWT 登录。只要后端、worker、前端已经启动，就可以直接进入工作台。

## 2. 你会看到的核心对象

### 2.1 Project

`project` 是顶层研究分组。

适合这些场景：

- 同时维护多个主题
- 把不同方向的研究任务隔离开
- 在同一个主题下维护多个 task 和多个 collection

你能做的事：

- 新建 project
- 切换当前 project
- 查看当前 project 下的任务列表
- 查看当前 project 下的 collection 列表
- 查看项目概览、最近任务、最近运行情况、provider 状态

结果：

- 新建的 task、collection 会自动归属到当前 project
- 切换 project 后，左侧任务和 collection 列表会跟着切换

### 2.2 Task

`task` 是一次具体的研究流程。

一个 task 至少包含这些信息：

- 研究主题 `topic`
- 模式 `mode`
- 后端 `llm_backend`
- 模型 `llm_model`
- 当前状态 `status`
- 自动研究状态 `auto_status`

你能做的事：

- 直接根据主题创建 task
- 从 collection 派生新的 study task
- 在任务内持续累积方向、轮次、论文、图谱、报告、资产、导出记录

结果：

- 任务会成为画布、时间线、节点问答、全文处理、导出等能力的承载单元

### 2.3 Collection

`collection` 是项目级、可复用、可命名的论文集合。

它不是临时选中状态，也不是画布分组。
它保存的是论文条目的快照信息，典型包括：

- `paper_id`
- 来源任务 `task_id`
- 标题
- 作者
- 年份
- venue
- DOI
- URL
- source
- 一部分元数据快照

你能做的事：

- 手工创建 collection
- 从当前任务中选中多篇论文加入 collection
- 从 Zotero 导出的本地文件导入为 collection
- 对 collection 生成摘要、构建集合图谱、做 compare
- 从 collection 派生新的 study task
- 导出 collection 为 `BibTeX / CSL JSON`

结果：

- 你可以把某个方向筛出的论文沉淀成一个长期可复用的论文集合
- 之后继续从这个集合出发做新的研究分支

## 3. 当前界面结构

工作台是三栏结构：

- 左侧边栏
  - 项目概览
  - 新建任务
  - 项目列表
  - Collection 列表
  - 任务列表
  - 快捷动作
  - Provider 状态
- 中间画布
  - 卡片式研究节点
  - 节点连线
  - 多选、拖拽、缩放、框选
  - 手工节点和手工连线
- 右侧边栏
  - `展示信息`
  - `对话`

右侧 `展示信息` 页会显示：

- 当前节点摘要
- 当前节点动作
- 论文资产和论文展示图
- 完整结构化摘要
- 任务导出
- Collection 详情
- Run Timeline
- PDF / Fulltext 面板

右侧 `对话` 页会显示：

- 手动选择的对话对象
- 节点类型对应的快捷问题
- 问答历史
- 将回答保存为节点的入口

## 4. 功能总览

下面这张表是当前版本的功能总清单。

| 功能 | 入口 | 使用方法 | 结果 |
| --- | --- | --- | --- |
| 新建项目 | 左侧 `项目列表` | 输入项目名，点击 `创建` | 新项目出现在左侧列表，后续 task 和 collection 可归属到它 |
| 新建研究任务 | 左侧 `新建研究任务` | 输入 topic，选择模式、后端、模型，点击创建 | 当前 project 下新增 task，并开始进入研究流程 |
| GPT Step 方向规划 | 左侧 `快捷动作` 或任务创建后自动触发 | 点击 `1. 规划方向` | 生成方向节点 |
| 检索方向 | 方向节点详情 | 点击 `检索方向` | 对该方向发起检索，画布增加论文或轮次相关内容 |
| 继续探索 | 方向节点详情 | 点击 `继续探索` | 创建新一轮 round |
| 生成候选方向 | round 节点详情 | 选择动作类型后点击 `生成候选方向` | 得到候选分支列表 |
| 选择候选进入下一轮 | round 节点详情 | 点击某个候选的 `选择这个候选` | 进入下一轮探索 |
| 继续下一轮 | round 节点详情 | 输入下一轮意图，点击 `继续下一轮` | 生成新的探索轮次 |
| 构建图谱 | 方向节点、round 节点、左侧快捷动作 | 点击 `构建图谱` | 生成或更新 canonical graph |
| 全文处理 | 左侧快捷动作、PDF / Fulltext 面板 | 点击 `处理全文` 或 `开始全文处理` | 尝试抓取/解析 PDF 与全文文本 |
| 保存论文 | 论文节点详情 | 点击 `保存论文` | 论文进入本地保存状态 |
| 生成结构化摘要 | 论文节点详情 | 点击 `生成结构化摘要` | 优先基于全文生成结构化摘要，失败时回退到摘要 |
| 打开 PDF | 论文节点详情 | 点击 `打开 PDF` | 在浏览器新标签打开 PDF |
| 下载 PDF | 论文节点详情 | 点击 `下载 PDF` | 下载 PDF 文件 |
| 论文主图/展示图 | 论文节点详情、PDF / Fulltext 面板 | 查看 `Main Figure` / `Paper Visual`，必要时点击 `重建展示图` | 有图 PDF 优先展示主图，无图时展示模板图 |
| 节点问答 | 右侧 `对话` | 选择对话对象，输入问题或点击快捷问题 | 生成围绕该节点上下文的回答 |
| 保存问答结果为节点 | 右侧 `对话` | 在某条回答下点击保存按钮 | 把回答保存为笔记、报告、问题或参考节点 |
| 比较多篇论文 | 底部快捷条 | 多选至少两篇论文，点击 `Compare` | 生成 compare 报告 |
| 保存 compare 结果为节点 | Compare 面板 | 点击 `保存为笔记节点` 或 `保存为报告节点` | compare 内容写入画布手工节点 |
| 加入 Collection | 底部快捷条 | 多选论文后点击 `加入 Collection` | 当前论文加入现有或新建 collection |
| 从选中文献派生研究 | 底部快捷条 | 多选论文后点击 `派生研究任务` | 先加入 collection，再派生新的 study task |
| Collection 摘要 | Collection 详情 | 点击 `生成摘要` | 更新该 collection 的摘要文本 |
| Collection compare | Collection 详情 | 至少两条条目后点击 `Compare` | 生成集合级 compare 报告 |
| Collection 图谱 | Collection 详情 | 点击 `构建集合图谱` | 生成集合级图结构 |
| 从 Collection 派生任务 | Collection 详情 | 点击 `派生 Study Task` | 创建新的 study task |
| 导出任务 | 右侧任务概览 | 点击 `导出 MD / BibTeX / CSL JSON / JSON` | 生成导出文件，写入任务导出历史 |
| 导出 Collection | Collection 详情 | 点击 `导出 BibTeX / 导出 CSL JSON` | 生成 collection 导出文件，写入导出历史 |
| 本地 Zotero 导入 | 左侧 Collection 区块 | 点击 `导入 Zotero 文件`，上传 `CSL JSON / BibTeX` | 在当前 project 下创建 imported collection |
| OpenClaw Auto 启动 | 左侧快捷动作或自动模式任务 | 点击 `启动 OpenClaw Auto` | 自动研究开始运行 |
| Checkpoint guidance | 右侧时间线 | 在 guidance 输入框输入引导并提交 | OpenClaw 在 checkpoint 后继续推进 |
| 取消自动研究 | 右侧时间线 | 点击 `停止本次运行` | 当前自动研究 run 结束 |
| 手工节点 | 底部快捷条 | 点击 `添加笔记 / 添加问题 / 添加参考 / 添加分组` | 画布上新增手工节点 |
| 手工连线 | 中间画布 | 从一个节点拖出连接到另一个节点 | 保存一条手工连线 |
| 删除节点 | 右侧详情或键盘 Delete | 删除手工节点，或隐藏系统节点 | 手工节点被删除，系统节点仅从当前画布隐藏 |
| 缩放/拖拽/框选 | 中间画布 | 鼠标拖动、滚轮、框选 | 调整浏览视图和选择范围 |

## 5. 启动后怎么开始一次研究

### 5.1 启动服务

在 WSL 中执行：

```bash
bash scripts/start_research_local_wsl.sh
bash scripts/start_frontend_wsl.sh
```

如果你要体验 OpenClaw Auto，再执行：

```bash
bash scripts/start_openclaw_wsl.sh
```

预期结果：

- 后端可访问：`http://127.0.0.1:8000/api/v1/health`
- 前端可访问：`http://127.0.0.1:5173`
- 如果 OpenClaw 已启动，gateway 可用

### 5.2 创建一个 Project

操作：

1. 打开左侧 `项目列表`
2. 输入项目名
3. 点击 `创建`

推荐命名方式：

- 按研究主题命名，如 `具身智能`
- 按阶段命名，如 `2026Q2 VLA 调研`

结果：

- 新项目出现在左侧列表
- 它会成为当前激活项目
- 后续创建的 task 和 collection 默认归属到它

### 5.3 创建一个 GPT Step 任务

操作：

1. 在左侧 `新建研究任务`
2. 输入研究主题
3. 模式选择 `GPT Step`
4. 后端选择 `GPT API`
5. 模型填写，例如 `gpt-5.4`
6. 点击 `创建研究任务`

结果：

- 左侧任务列表新增一个 task
- 右侧任务概览开始出现状态变化
- 如果 worker 正常工作，会开始进入方向规划

## 6. GPT Step 模式怎么用

`GPT Step` 适合你自己控制研究节奏。

推荐顺序如下。

#### 6.1 规划方向

入口：

- 左侧 `快捷动作 > 1. 规划方向`

操作：

- 点击后等待 worker 完成

结果：

- 画布上出现若干 `direction` 节点
- 每个方向节点包含标题和摘要说明

#### 6.2 检索方向

入口：

- 选中一个方向节点
- 右侧 `展示信息 > 方向动作 > 检索方向`

操作：

- 点击 `检索方向`

结果：

- 为该方向发起论文检索
- 成功时会出现论文节点、轮次节点或后续可探索内容
- 如果 provider 限流、超时或无结果，状态条会给出反馈

#### 6.3 继续探索

入口：

- 方向节点详情

操作：

- 点击 `继续探索`

结果：

- 会创建一个新的 `round` 节点
- 后续候选生成、下一轮推进都围绕这个 round 继续

#### 6.4 生成候选方向

入口：

- round 节点详情

操作：

1. 选择动作类型
   - `扩展邻近方向`
   - `深入当前方向`
   - `切换研究视角`
   - `收敛核心问题`
2. 可选填写反馈文本
3. 点击 `生成候选方向`

结果：

- round 节点下方出现候选列表
- 每个候选会给出名称、query 和理由

#### 6.5 选择候选

入口：

- round 节点详情中的候选卡片

操作：

- 点击 `选择这个候选`

结果：

- 该候选会成为下一轮推进的基础
- 任务的研究主线继续向该候选分支延展

#### 6.6 继续下一轮

入口：

- round 节点详情底部

操作：

1. 输入下一轮探索意图
2. 点击 `继续下一轮`

结果：

- 创建新的研究轮次
- 适合把当前结果收敛成下一轮更明确的目标

#### 6.7 构建图谱

入口：

- 左侧 `快捷动作 > 3. 构建图谱`
- 方向节点详情
- round 节点详情

作用：

- 把已检索、已探索、已汇总的内容组织成 canonical graph

结果：

- 画布连线更完整
- 主题、方向、轮次、论文之间的关系更清晰

#### 6.8 处理全文

入口：

- 左侧 `快捷动作 > 4. 处理全文`
- 右侧 `PDF / Fulltext` 面板

作用：

- 尝试获取论文 PDF
- 解析全文文本
- 为摘要、图片提取、资产预览提供基础

结果：

- 成功时会看到 PDF、TXT、Markdown 等资产
- 右侧全文状态会显示解析状态、质量分、解析器、字符数

#### 6.9 论文级动作

选中一个 `paper` 节点后，可在右侧使用：

- `打开 PDF`
  - 在新标签打开 PDF
- `下载 PDF`
  - 下载 PDF 文件
- `去聊天里分析`
  - 切换到右侧对话页，并预填针对这篇论文的问题
- `保存论文`
  - 把该论文标记为本地保存
- `生成结构化摘要`
  - 生成详细的结构化总结
- `重建展示图`
  - 重新尝试生成主图或模板图

结果：

- 卡片摘要会更完整
- 右侧会出现完整结构化摘要
- 有 PDF 的论文可能出现 `Main Figure`
- 无主图时会出现 `Paper Visual`

#### 6.10 导出任务结果

入口：

- 右侧任务概览顶部

可导出格式：

- `MD`
- `BibTeX`
- `CSL JSON`
- `JSON`

结果：

- 系统会生成对应导出文件
- 文件写入任务导出历史
- 右侧可查看最近导出记录和下载链接

## 7. OpenClaw Auto 模式怎么用

`OpenClaw Auto` 适合做分阶段自治调研演示。

前提：

- `.env` 已配置 OpenClaw 相关变量
- `scripts/start_openclaw_wsl.sh` 已启动 gateway

#### 7.1 创建任务

操作：

1. 左侧新建任务
2. 模式选择 `OpenClaw Auto`
3. 后端选择 `OpenClaw`
4. 模型填写 gateway 中可用的 agent/model 名称

结果：

- 任务创建完成
- 该任务可进入自动研究模式

#### 7.2 启动自动研究

入口：

- 左侧快捷动作中的 `启动 OpenClaw Auto`

结果：

- 自动研究 run 启动
- 右侧 `Run Timeline` 开始出现事件
- 画布逐步增加方向、论文、checkpoint、report 等节点

#### 7.3 等待 Checkpoint

结果：

- 系统先自动推进
- 到达第一个 `checkpoint` 后进入 `awaiting_guidance`
- 右侧时间线会明确显示“等待你的引导”

#### 7.4 提交 Guidance

入口：

- 右侧 `Run Timeline` guidance 输入框

建议写法：

- 优先扩展某个分支
- 补充高质量全文证据
- 更关注方法、评测或系统部署
- 要求给出阶段性结论和下一步建议

结果：

- guidance 会记录到 guidance 历史
- 提交后可继续自动研究

#### 7.5 继续或取消自动研究

入口：

- `继续自动研究`
- `停止本次运行`

结果：

- 继续：OpenClaw 在上一个 checkpoint 的基础上继续推进
- 停止：当前 run 结束，但任务和已产生的结果保留

#### 7.6 你会看到什么输出

OpenClaw Auto 当前会在右侧显示：

- 按阶段分组的运行日志
- 最新 checkpoint 摘要
- 最近报告摘录
- artifacts 列表
- guidance 历史

画布中常见节点：

- `topic`
- `direction`
- `paper`
- `checkpoint`
- `report`

## 8. Collection 怎么用

### 8.1 Collection 存的是什么

Collection 存的是“论文集合”，不是节点集合，也不是整张画布。

更准确地说，它存的是项目级的论文条目快照，用来做：

- 复用
- 比较
- 派生研究
- 导出
- 与 Zotero 本地文件互通

### 8.2 如何把论文加入 Collection

方法一：从画布多选论文加入。

操作：

1. 在中间画布多选论文节点
2. 使用底部快捷条 `加入 Collection`

多选方式：

- 直接拖框框选
- 按住 `Ctrl`、`Shift` 或 `Meta` 再点选

注意：

- 只有 `paper` 节点能加入 collection
- 方向、轮次、手工节点不会加入 collection

结果：

- 如果当前没有激活 collection，系统会先创建一个新的 collection
- 选中的论文会写入这个 collection

方法二：导入 Zotero 本地文件。

结果：

- 直接在当前 project 下生成一个 imported collection

### 8.3 Collection 详情页能做什么

选中左侧某个 collection 后，右侧会显示：

- 集合摘要
- 集合条目列表
- 搜索框
- 当前页全选
- 移除选中
- 导出历史

可执行动作：

- `生成摘要`
- `派生 Study Task`
- `构建集合图谱`
- `Compare`
- `导出 BibTeX`
- `导出 CSL JSON`

结果：

- 摘要：得到集合级说明
- 派生任务：从这个集合出发创建新研究任务
- 集合图谱：把 collection 里的论文关系组织成轻量图
- Compare：生成集合级比较报告
- 导出：生成可下载文件，并写入导出历史

### 8.4 从 Collection 派生 Study Task

适合这些场景：

- 你已经筛出一批高质量论文，想从这批论文继续拓展
- 你不想再从一个大而泛的 topic 重新检索
- 你想把某个 collection 变成新的研究分支

结果：

- 新 task 的 `seed corpus` 会优先来自 collection
- 后续仍然可以继续走 GPT Step 或 OpenClaw Auto

## 9. 画布怎么用

### 9.1 画布中的节点类型

系统节点：

- `topic`
- `direction`
- `round`
- `paper`
- `checkpoint`
- `report`

手工节点：

- `note`
- `question`
- `reference`
- `group`

### 9.2 画布基础操作

你可以直接在画布上做这些操作：

- 拖拽节点
- 鼠标滚轮缩放
- 拖动画布平移
- 框选多个节点
- 多选多个论文节点
- 删除节点
- 添加手工节点
- 手工连线

结果：

- 系统会自动把手工节点、手工连线、位置、隐藏状态、备注等写入 `canvas state`
- 刷新页面后，这些状态会继续保留

### 9.3 删除节点的规则

手工节点：

- 会被真正删除
- 与它相连的手工连线也会被一起移除

系统节点：

- 不会删除研究主数据
- 只会从当前画布中隐藏

这意味着：

- 你可以放心整理展示布局
- 但系统研究结果本身不会因为误删而彻底丢失

### 9.4 手工节点怎么加

入口：

- 中间画布下方快捷条

支持：

- `添加笔记`
- `添加问题`
- `添加参考`
- `添加分组`

结果：

- 会在画布中新增一个手工节点
- 适合沉淀你自己的判断、解释、补充问题和讲解结构

## 10. 节点问答怎么用

### 10.1 对话页入口

右侧边栏顶部有两个标签：

- `展示信息`
- `对话`

切换到 `对话` 后，聊天会占据整个右侧边栏。

### 10.2 问答不是自动绑定右侧选中节点

当前聊天页采用“手动指定对话对象”的方式。

操作：

1. 切换到 `对话`
2. 在顶部下拉框中选择一个节点
3. 点击快捷问题，或手动输入问题
4. 点击 `提问`

结果：

- 系统只围绕该节点的上下文回答
- 不会直接接管整条研究流程

### 10.3 节点类型不同，快捷问题也不同

例如：

- `paper`
  - 这篇论文解决什么问题
  - 核心方法是什么
  - 关键证据和实验结论是什么
  - 有哪些局限和风险
- `direction`
  - 这个方向的核心价值是什么
  - 下一步最值得补哪些论文
- `checkpoint`
  - 这个 checkpoint 已经确认了什么
  - 现在该给什么 guidance

### 10.4 问答结果可以直接保存到画布

每条回答下可以保存为：

- 笔记节点
- 报告节点
- 问题节点
- 参考节点

结果：

- 你的问答内容会沉淀成手工工作台节点
- 便于后续排版、讲解和继续研究

## 11. Compare 怎么用

### 11.1 任务内比较多篇论文

操作：

1. 在画布中多选至少两篇 `paper`
2. 点击底部快捷条 `Compare`

结果：

- 右侧会出现 compare 报告
- 报告内容包含：
  - `overview`
  - `共同点`
  - `差异点`
  - `建议下一步`

你还可以：

- 保存为笔记节点
- 保存为报告节点

### 11.2 Collection compare

操作：

1. 打开一个至少有两条论文的 collection
2. 点击 `Compare`

结果：

- 得到集合级 compare 报告
- 更适合做主题对比或方向对比

## 12. 论文资产、全文与展示图

### 12.1 资产类型

当前论文可能有这些资产：

- `pdf`
- `txt`
- `md`
- `bib`
- `figure`
- `visual`

含义：

- `figure`
  - 从 PDF 提取出的主图候选
- `visual`
  - 当论文没有可提取主图时生成的模板展示图

### 12.2 结构化摘要规则

论文摘要分成两层：

- 卡片层
  - 精简摘要
- 详情层
  - 完整结构化摘要

生成顺序：

1. 优先使用 fulltext
2. 如果 fulltext 不可用，则回退 abstract
3. 如果仍然不足，则回退已有简述字段

结果：

- 右侧会标出摘要来源
- 你能知道它是“基于全文”还是“基于摘要”

### 12.3 PDF / Fulltext 面板能做什么

入口：

- 选中论文节点后，右侧下方 `PDF / Fulltext`

可执行动作：

- 开始全文处理
- 重试全文处理
- 重建展示图
- 上传 PDF
- 预览 PDF
- 打开资产
- 下载资产

结果：

- 如果全文处理成功，会看到更完整的论文资产
- 如果 PDF 缺失，也可以手动上传补齐

## 13. Zotero 本地导入导出

当前 Zotero 主路径已经改为“本地文件导入导出优先”。

这意味着默认不需要 Zotero API Key，也不依赖在线 Web API。

### 13.1 支持什么格式

导入：

- `CSL JSON`
- `BibTeX`

导出：

- task：`MD / BibTeX / CSL JSON / JSON`
- collection：`BibTeX / CSL JSON`

### 13.2 如何导入

操作：

1. 在 Zotero Desktop 中导出文件
2. 回到工作台左侧 `Collections`
3. 点击 `导入 Zotero 文件`
4. 选择文件

结果：

- 会在当前 project 下创建一个新的 imported collection
- 条目会按 `paper_id / DOI / title_norm` 去重

### 13.3 如何导出

Task 导出：

- 右侧任务概览顶部

Collection 导出：

- Collection 详情页

结果：

- 系统生成导出文件
- 导出记录会保留在导出历史里

## 14. 运行状态、反馈与常见结果说明

工作台大多数动作都会在顶部状态条给出反馈。

常见状态：

- 已提交
- 已在队列中
- 已有结果，无需重复
- 缺少前置条件
- 执行失败

常见例子：

- `方向规划已提交`
- `已有方向结果，无需重复规划`
- `当前任务还没有论文，无法执行全文处理`
- `论文检索已在队列中，无需重复提交`

## 15. Demo 与演示入口

如果你要直接演示，不想从零开始建任务，可以使用内置 demo。

### 15.1 静态展示 Demo

命令：

```bash
bash scripts/run_demo_showcase_wsl.sh --mode static
```

结果：

- 初始化一个可直接打开展示的工作区
- 内容围绕“具身智能 / Embodied AI”
- 包含 project、task、collection、compare、checkpoint、artifact、PDF/fulltext、导出历史、画布布局

### 15.2 动态演示 Demo

命令：

```bash
bash scripts/run_demo_showcase_wsl.sh --mode live
```

结果：

- 会顺序跑动态演示流程
- 主要覆盖：
  - `gpt_basic`
  - `gpt_explore`
  - `openclaw_auto`

### 15.3 一次准备完整演示环境

命令：

```bash
bash scripts/run_demo_showcase_wsl.sh --mode all
```

结果：

- 同时准备静态展示和动态流程

## 16. 自检与 smoke

### 16.1 API 连通性检查

命令：

```bash
bash scripts/run_api_connectivity_check_wsl.sh --iterations 10 --json-out artifacts/research-api-check/current.json
```

作用：

- 检查核心 research API 是否可访问
- 会创建临时 project、collection、task 用于验证读写接口

结果：

- 生成一份 JSON 检查结果

### 16.2 真实流程 smoke

命令：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

或连续跑两轮：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

作用：

- 验证 GPT Step 和 OpenClaw Auto 主链路能否跑通

## 17. 推荐使用顺序

如果你是第一次使用，建议按这个顺序上手：

1. 启动后端、worker、前端
2. 创建一个新的 project
3. 在这个 project 下创建一个 `GPT Step` task
4. 完成一次方向规划
5. 对一个方向执行 `检索方向`
6. 选中多篇论文，加入 collection
7. 对 collection 做 compare 或派生新的 study task
8. 再创建一个 `OpenClaw Auto` task
9. 跑到 checkpoint，提交一次 guidance
10. 打开一篇论文的 PDF、全文和展示图
11. 导出任务结果

## 18. 当前版本的重要规则

- 只有 `paper` 节点能加入 collection
- Collection 存的是论文条目快照，不是整张画布
- 手工节点可以真正删除，系统节点只会从当前画布隐藏
- 节点问答只围绕当前节点上下文回答，不接管整个研究流程
- `OpenClaw Auto` 必须依赖可用的本地 gateway
- 论文检索结果会受 provider 配置、限流、超时和第三方源可用性影响
- 结构化摘要优先基于全文，全文缺失时回退摘要

## 19. 常见问题

### 19.1 为什么我点了检索方向但没有马上出现论文

可能原因：

- worker 还在处理
- 外部 provider 限流或超时
- 当前方向没有返回足够有效的候选论文

建议：

- 看顶部状态条
- 看右侧 Run Timeline
- 看左侧 Provider 状态

### 19.2 为什么加入 Collection 按钮是灰色的

因为当前没有选中可加入的 `paper` 节点。

请确认：

- 选中的是论文节点，不是方向或 round
- 当前至少选中一篇 paper
- 多选时使用框选或 `Ctrl/Shift/Meta`

### 19.3 为什么删除系统节点后数据还在

这是设计如此。
系统节点删除的实际行为是“从当前画布隐藏”，不是删除研究主数据。

### 19.4 为什么某些论文没有 PDF

因为全文抓取并不保证所有来源都能拿到 PDF。
你可以：

- 先执行全文处理
- 仍然缺失时手动上传 PDF

### 19.5 为什么 OpenClaw Auto 不能用

通常是因为：

- OpenClaw gateway 没启动
- `.env` 中 `OPENCLAW_*` 没配好
- 本地 agent/model 名称不匹配

## 20. 这份文档适合什么时候看

- 想从零开始使用当前工作台时
- 想弄清 project / task / collection 的区别时
- 想演示 GPT Step 或 OpenClaw Auto 时
- 想把 Zotero 本地文件导入工作台时
- 想确认某个按钮点了之后应该看到什么结果时

如果你现在的目标是“先跑起来”，请看 [RESEARCH_LOCAL_QUICKSTART.md](RESEARCH_LOCAL_QUICKSTART.md)。
如果你的目标是“直接演示一套完整案例”，请看 [DEMO_STEPS.md](DEMO_STEPS.md)。
