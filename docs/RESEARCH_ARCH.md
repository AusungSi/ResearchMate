# Research Architecture

## 1. 当前目标

当前调研模块采用“本地 workbench 主导”的 research-only 架构：

- 前端 workbench：项目、任务、collection、画布、节点问答、运行时间线
- 后端 research API：检索、去重、全文解析、图构建、collection study、Zotero 导入
- worker：异步执行 research job 和 OpenClaw Auto 任务链
- OpenClaw gateway：原生自治式 research 模式的执行入口

旧的企业微信、提醒和移动端链路仍在代码里，但不进入当前 `research_local` 主运行链路。

## 2. 三层数据结构

### 2.1 canonical research

这层保存“研究事实”：

- `research_tasks`
- `research_directions`
- `research_rounds`
- `research_round_candidates`
- `research_papers`
- `research_round_papers`
- `research_paper_fulltext`
- `research_citation_edges`
- `research_graph_snapshots`
- `research_jobs`

### 2.2 workbench state

这层保存“用户如何组织和查看研究”：

- `research_canvas_state`
  - 节点位置
  - 手工节点
  - 手工边
  - 隐藏状态
  - 备注
  - viewport
  - UI 状态
- `research_node_chats`
  - 节点级上下文问答
- `research_run_events`
  - GPT / OpenClaw 运行事件流

原则：

- canonical research graph 不直接被前端手工编辑覆盖
- 用户拖拽、隐藏、注释、栏位状态只写入 canvas state

### 2.3 organization layer

这层保存“长期组织结构”：

- `research_projects`
- `research_collections`
- `research_collection_items`

作用：

- 用 project 管多个 task
- 用 collection 管一组论文
- 用 collection 创建派生 study task

## 3. 两种研究模式

### 3.1 GPT Step

特点：

- 用户一步一步决定下一步动作
- 继续复用原有 research pipeline
- 适合人工控节奏的研究流程

常见动作：

1. 创建 task
2. 规划方向
3. 开始 explore round
4. 生成 candidates
5. 选择下一轮
6. 构建 graph / fulltext / summary

### 3.2 OpenClaw Auto

特点：

- OpenClaw 自行推进第一阶段研究
- 在 `checkpoint` 暂停并等待 guidance
- 后端落库事件流并同步到前端

当前事件协议包括：

- `progress`
- `node_upsert`
- `edge_upsert`
- `paper_upsert`
- `checkpoint`
- `report_chunk`
- `artifact`
- `error`

## 4. 异步执行模型

1. API 写入 `research_jobs`
2. worker claim 任务并设置 `worker_id + lease_until`
3. 长任务通过 heartbeat 延长 lease
4. 成功进入 `done`
5. 失败进入 retry 或 `failed`
6. lease 过期任务可被其它 worker reclaim

当前 job 类型包括：

- `plan`
- `search`
- `fulltext`
- `graph_build`
- `paper_summary`
- `auto_research`

## 5. collection study 机制

collection 不直接替代 task。

当前采取的策略是：

1. 用户在一个 project 下积累 collection
2. 从 collection 创建新的 study task
3. 新 task 的 seed corpus 优先来自 collection item
4. 之后继续复用原有 GPT Step 或 OpenClaw Auto 链路

这能避免再造一套平行任务体系，同时保留 collection 的复用价值。

## 6. 检索与引文源

### discovery

- `semantic_scholar`
- `arxiv`
- `openalex`

说明：

- 默认 discovery 顺序仍以 `semantic_scholar + arxiv` 为主
- `openalex` 已可作为可选 discovery provider

### citation

- `semantic_scholar`
- `openalex`
- `crossref`

规则：

- 单源失败不终止任务
- 使用缓存降低重复抓取
- DOI 优先归一化，标题归一化兜底

## 7. Zotero v1

当前 Zotero 只做“读入”：

- 读取 Zotero collection / item
- 映射到本地 project collection
- 不直接写入 canonical paper 表

后续如果用户需要继续研究，明确通过 `collection -> study task` 进入主研究链路。

## 8. 配置要点

- `APP_PROFILE=research_local`
- `RESEARCH_QUEUE_MODE=worker`
- `RESEARCH_GPT_API_KEY`
- `OPENCLAW_ENABLED`
- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_AGENT_ID`
- `RESEARCH_SOURCES_DEFAULT`
- `RESEARCH_CITATION_SOURCES_DEFAULT`
- `ZOTERO_LIBRARY_TYPE`
- `ZOTERO_LIBRARY_ID`
- `ZOTERO_API_KEY`
