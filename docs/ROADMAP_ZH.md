# 当前项目下一步优化方向

这份路线图基于当前已经跑通的主线：

- `research_local`
- `GPT Step`
- `OpenClaw Auto`
- `WSL / Linux VM`
- 独立前端工作台

## P0：继续做稳当前主链路

### 1. 前端事件同步改成更实时

当前前端主要依赖轮询。

下一步建议：

- 为 run events 增加 SSE 或 WebSocket
- checkpoint、report、artifact 到达时立即刷新
- 减少对 SQLite 的高频轮询压力

### 2. 补齐更完整的 live 测试与 CI

这轮已经补了 smoke runner，但还可以继续：

- 将 `research_live_smoke.py` 拆成更细粒度场景
- 增加 WSL 环境下的一键验收脚本
- 在 GitHub Actions 中补最小单测和静态检查

### 3. 继续压缩 SQLite 的并发风险

现在已经做了：

- `busy_timeout`
- `WAL`
- 减少 session 无意义写入
- 修复 task_id 并发碰撞

下一步仍建议：

- 把高频写热点再收敛
- 对 worker 和 API 的竞争写路径做一次梳理
- 如果后续变成多人或更高频运行，切换到 Postgres

## P1：把前端工作台做完整

### 4. 右侧详情区继续深化

建议优先补：

- 更清晰的节点摘要模板
- 节点间 compare 视图
- 更好的 `Why it matters`
- report 节点和 checkpoint 节点的专用展示

### 5. PDF / Fulltext 体验继续增强

可以继续补：

- 内嵌 PDF viewer 的页码同步
- 文本高亮和摘要定位
- Fulltext 与节点上下文联动
- `Need upload` 的交互完善

### 6. 画布交互继续打磨

下一步可以优化：

- 手工节点编辑器
- group/reference/question 节点的专用样式
- 布局自动整理
- 视口记忆与多视图切换

## P1：让 OpenClaw Auto 更像真正的自治研究流程

### 7. 扩展 checkpoint 之后的阶段编排

当前已经实现：

- start
- checkpoint
- guidance
- continue
- report_chunk
- artifact

下一步建议：

- 引入更明确的 stage 状态
- 让 OpenClaw 在多个阶段中持续扩图
- 增加阶段间总结与对比

### 8. 强化事件协议和可观测性

建议增加：

- 事件级错误码
- provider/source 标记
- 当前阶段、耗时、重试次数
- 前端时间线过滤与聚合

## P1：让 GPT Step 更适合真实研究

### 9. 丰富 step-by-step 动作

可以优先补：

- compare selected papers
- 方向收藏与集合管理
- 多轮探索中的“回退到上一轮”
- 更细粒度的 candidate 解释

### 10. 节点上下文问答更贴近研究场景

建议扩展：

- 节点级 thread 管理
- 快捷问题模板
- 引用当前 paper / round / report 的上下文增强
- 问答结果可保存为 note 节点

## P2：外部数据和文献生态接入

### 11. Zotero 接入

这是你已经明确提过的方向。

建议接入顺序：

1. 导出到 Zotero 友好的 Bib / JSON
2. 读取 Zotero collection
3. 将 Zotero 条目映射成 reference/paper 节点
4. 支持从 Zotero 反向同步注释

### 12. 更稳定的检索与引文 provider

建议补：

- provider 状态显示
- 限流与重试策略
- source provenance
- metadata 归一化

## P2：工程化和发布能力

### 13. 完成 Docker Compose 的真实验收

当前 Compose 文件已经在仓库里，但还缺完整实机验收。

建议补：

- `docker compose up --build` 全链路验证
- volume、端口、前端构建产物检查
- Compose 下的 smoke 脚本

### 14. 打包和发布标准化

建议补：

- 后端与前端版本号同步
- release 产物清单
- 一键导出部署包
- 环境变量模板分层

## 推荐的优先级顺序

最建议的下一步顺序是：

1. 前端实时事件同步
2. 更完整的 live smoke / CI
3. 继续压缩 SQLite 并发风险
4. 完善右侧详情、PDF、compare 等研究工作台交互
5. 深化 OpenClaw Auto 的阶段式自治流程
6. 再做 Zotero 接入
