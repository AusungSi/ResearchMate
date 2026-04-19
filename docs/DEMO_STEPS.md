# Workbench 演示步骤

## 1. 启动后端与 worker

在 WSL 中执行：

```bash
bash scripts/start_research_local_wsl.sh
```

预期结果：

- 后端监听 `http://127.0.0.1:8000`
- worker 已启动并开始轮询 research job

## 2. 启动前端

如果还没有装过 WSL Node 工具链，先执行：

```bash
bash scripts/install_frontend_node_wsl.sh
```

然后启动前端：

```bash
bash scripts/start_frontend_wsl.sh
```

默认访问：

- `http://127.0.0.1:5173`

## 3. 如果演示 OpenClaw Auto，再启动 gateway

```bash
bash scripts/start_openclaw_wsl.sh
```

预期：

- gateway 健康检查可访问
- `.env` 中已配置 `OPENCLAW_ENABLED=true`

## 4. 健康检查

浏览器或命令行访问：

```bash
curl http://127.0.0.1:8000/api/v1/health
```

重点确认：

- `db_ok`
- `research_enabled`
- `profile=research_local`

## 5. GPT Step 演示流程

进入前端工作台后，按顺序操作：

1. 创建一个 project，例如：`多模态医学影像`
2. 在这个 project 下创建一个 `GPT Step` task
3. 输入 topic，例如：`ultrasound report generation hallucination`
4. 等待方向规划完成
5. 对一个 direction 点击 `继续探索`
6. 生成候选并选择下一轮
7. 选中几篇 paper，加入一个新的 collection
8. 从 collection 创建派生 study task

演示重点：

- project / task / collection 的组织层
- GPT Step 的显式动作链
- 右侧详情、Context Chat、Run Timeline、PDF / Fulltext

## 6. OpenClaw Auto 演示流程

在同一个 project 下再创建一个新 task，选择：

- 模式：`OpenClaw Auto`
- 后端：`OpenClaw`

按顺序操作：

1. 创建 task
2. 启动自动研究
3. 等待 `checkpoint`
4. 在右侧或节点动作中提交 guidance
5. 继续自动研究
6. 查看阶段报告和 artifact

演示重点：

- 事件流逐步落到画布
- `checkpoint -> guidance -> continue` 闭环
- report / artifact 在右侧的展示

## 7. Zotero v1 演示流程

如果 `.env` 已配置 Zotero：

1. 在左侧 project 区域使用导入入口
2. 输入或选择要导入的 Zotero collection
3. 完成导入
4. 查看本地 collection 明细
5. 从该 collection 创建新的 study task

演示重点：

- Zotero 作为“集合输入层”
- 导入后不直接污染 canonical graph
- 仍通过 collection 进入主研究链路

## 8. 可选命令行 smoke

如果要在演示前做快速验收：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

如果要跑双轮稳定性：

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

## 9. 演示时建议强调的点

- 当前默认主线已经是 `research_local`
- research API 无需 JWT
- workbench 已支持 project / collection / study task
- GPT Step 与 OpenClaw Auto 都已打通
- OpenClaw 当前是“可运行的第一版自治研究链路”
- Docker Compose 文件已准备，但还缺真实 Docker 环境验收
