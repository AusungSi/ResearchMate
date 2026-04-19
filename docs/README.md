# Docs Index

## Core Docs

- `RESEARCH_LOCAL_QUICKSTART.md`
  - `research_local` 模式的 WSL / Linux VM 启动、构建、打包、API 自检说明
- `RESEARCH_USAGE_ZH.md`
  - 当前 research workbench 的用户使用说明书，包含 `project / collection / GPT Step / OpenClaw Auto / Zotero`
- `PROJECT_OVERVIEW_ZH.md`
  - 中文项目总览，适合快速接手和理解当前模块边界
- `ROADMAP_ZH.md`
  - 当前项目下一步改进与优化方向
- `RESEARCH_ARCH.md`
  - research 数据模型、队列和图谱相关架构说明
- `DEMO_STEPS.md`
  - 本地演示流程和操作顺序
- `LLM_TUNING.md`
  - LLM 行为调优和提示词实验说明

## Design References

- `design/前端示例.canvas`
  - 前端视觉和工作台交互参考样例

## Notes

- `docs/` 目录保留为主要文档入口
- `design/` 子目录只放视觉参考和交互样例，避免继续占用仓库根目录
- 当前主线默认围绕 `research_local` 展开，legacy 内容不再作为文档主入口
- 命令行验证建议分成两类：
  - `run_api_connectivity_check_wsl.sh`
    - 接口连通性检查
  - `run_research_live_smoke_wsl.sh`
    - 完整研究链路 smoke
