from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import orjson
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.enums import (
    ResearchActionType,
    ResearchAutoStatus,
    ResearchGraphBuildStatus,
    ResearchGraphViewType,
    ResearchLLMBackend,
    ResearchPaperFulltextStatus,
    ResearchRoundStatus,
    ResearchRunEventType,
    ResearchRunMode,
    ResearchTaskStatus,
)
from app.domain.models import ResearchCollection, ResearchCollectionItem, ResearchProject, ResearchTask
from app.infra.repos import (
    ResearchCanvasStateRepo,
    ResearchCompareReportRepo,
    ResearchCollectionItemRepo,
    ResearchCollectionRepo,
    ResearchDirectionRepo,
    ResearchExportRecordRepo,
    ResearchGraphSnapshotRepo,
    ResearchPaperFulltextRepo,
    ResearchPaperRepo,
    ResearchProjectRepo,
    ResearchRoundCandidateRepo,
    ResearchRoundPaperRepo,
    ResearchRoundRepo,
    ResearchRunEventRepo,
    ResearchSeedPaperRepo,
    ResearchTaskRepo,
)
from app.services.research_service import ResearchService


DEMO_PROJECT_KEY = "demo-embodied-ai"
DEMO_COLLECTION_ID = "collection-demo-embodied-core"
DEMO_GPT_TASK_ID = "demo-gpt-embodied"
DEMO_AUTO_TASK_ID = "demo-auto-embodied"
DEMO_AUTO_RUN_ID = "run-demo-embodied-auto"


def seed_embodied_ai_demo(
    db: Session,
    *,
    user_id: int,
    service: ResearchService,
    root_dir: Path | None = None,
) -> dict:
    settings = get_settings()
    project_root = (root_dir or Path.cwd()).resolve()
    artifact_root = Path(settings.research_artifact_dir).expanduser().resolve()
    save_root = Path(settings.research_save_base_dir).expanduser().resolve()
    artifact_root.mkdir(parents=True, exist_ok=True)
    save_root.mkdir(parents=True, exist_ok=True)

    project_repo = ResearchProjectRepo(db)
    task_repo = ResearchTaskRepo(db)
    collection_repo = ResearchCollectionRepo(db)

    project = project_repo.get_by_project_key(user_id, DEMO_PROJECT_KEY)
    gpt_task = task_repo.get_by_task_id(DEMO_GPT_TASK_ID, user_id=user_id)
    auto_task = task_repo.get_by_task_id(DEMO_AUTO_TASK_ID, user_id=user_id)
    collection = collection_repo.get_by_collection_id(user_id=user_id, collection_id=DEMO_COLLECTION_ID)

    if project and gpt_task and auto_task and collection:
      return _summary(project=project, gpt_task=gpt_task, auto_task=auto_task, collection=collection, initialized=False)

    if project is None:
        now = datetime.now(timezone.utc)
        project = project_repo.create(
            ResearchProject(
                project_key=DEMO_PROJECT_KEY,
                user_id=user_id,
                name="具身智能 Demo 工作区",
                description="用于静态展示的完整研究工作区，包含 GPT Step、OpenClaw Auto、Collection、Compare、PDF 和 Artifact。",
                is_default=False,
                created_at=now,
                updated_at=now,
            )
        )

    if gpt_task is None:
        gpt_task = _create_task(
            db,
            project_id=project.id,
            user_id=user_id,
            task_id=DEMO_GPT_TASK_ID,
            topic="具身智能中的世界模型、视觉语言动作模型与数据效率",
            mode=ResearchRunMode.GPT_STEP,
            backend=ResearchLLMBackend.GPT,
            model=settings.research_gpt_model or "gpt-5.4",
            status=ResearchTaskStatus.DONE,
            auto_status=ResearchAutoStatus.IDLE,
            constraints={
                "sources": ["semantic_scholar", "arxiv", "openalex"],
                "top_n": 8,
                "focus": "Embodied AI demo",
            },
            created_at=datetime.now(timezone.utc) - timedelta(hours=3),
        )
        _seed_gpt_task(
            db,
            service=service,
            user_id=user_id,
            task=gpt_task,
            artifact_root=artifact_root,
            save_root=save_root,
            project_root=project_root,
        )

    if auto_task is None:
        auto_task = _create_task(
            db,
            project_id=project.id,
            user_id=user_id,
            task_id=DEMO_AUTO_TASK_ID,
            topic="具身智能自治调研：世界模型与机器人操作的多阶段证据链",
            mode=ResearchRunMode.OPENCLAW_AUTO,
            backend=ResearchLLMBackend.OPENCLAW,
            model=settings.openclaw_agent_id or "main",
            status=ResearchTaskStatus.DONE,
            auto_status=ResearchAutoStatus.COMPLETED,
            constraints={
                "sources": ["semantic_scholar", "arxiv", "openalex"],
                "top_n": 10,
                "focus": "OpenClaw auto demo",
            },
            last_checkpoint_id="cp-embodied-stage-1",
            created_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        _seed_auto_task(
            db,
            service=service,
            user_id=user_id,
            task=auto_task,
            artifact_root=artifact_root,
            project_root=project_root,
        )

    if collection is None:
        now = datetime.now(timezone.utc)
        collection = collection_repo.create(
            ResearchCollection(
                collection_id=DEMO_COLLECTION_ID,
                project_id=project.id,
                name="具身智能核心论文集",
                description="聚合 GPT Step 与 OpenClaw Auto 两条演示任务中的代表性论文。",
                source_type="demo_seed",
                source_ref="embodied-ai-static-demo",
                summary_text="这个 collection 聚焦三条主线：世界模型、视觉语言动作模型，以及数据效率 / sim2real 泛化。",
                created_at=now,
                updated_at=now,
            )
        )
        _seed_collection(
            db,
            project=project,
            collection=collection,
            gpt_task=gpt_task,
            auto_task=auto_task,
        )

    project.updated_at = datetime.now(timezone.utc)
    db.add(project)
    db.flush()
    return _summary(project=project, gpt_task=gpt_task, auto_task=auto_task, collection=collection, initialized=True)


def _summary(*, project: ResearchProject, gpt_task: ResearchTask, auto_task: ResearchTask, collection: ResearchCollection, initialized: bool) -> dict:
    return {
        "initialized": initialized,
        "project_id": project.project_key,
        "project_name": project.name,
        "collection_id": collection.collection_id,
        "tasks": [
            {"task_id": gpt_task.task_id, "topic": gpt_task.topic, "mode": gpt_task.mode.value},
            {"task_id": auto_task.task_id, "topic": auto_task.topic, "mode": auto_task.mode.value},
        ],
    }


def _create_task(
    db: Session,
    *,
    project_id: int,
    user_id: int,
    task_id: str,
    topic: str,
    mode: ResearchRunMode,
    backend: ResearchLLMBackend,
    model: str,
    status: ResearchTaskStatus,
    auto_status: ResearchAutoStatus,
    constraints: dict,
    created_at: datetime,
    last_checkpoint_id: str | None = None,
) -> ResearchTask:
    row = ResearchTask(
        task_id=task_id,
        user_id=user_id,
        project_id=project_id,
        topic=topic,
        constraints_json=orjson.dumps(constraints).decode("utf-8"),
        mode=mode,
        llm_backend=backend,
        llm_model=model,
        auto_status=auto_status,
        last_checkpoint_id=last_checkpoint_id,
        status=status,
        created_at=created_at,
        updated_at=created_at,
    )
    return ResearchTaskRepo(db).create(row)


def _seed_gpt_task(
    db: Session,
    *,
    service: ResearchService,
    user_id: int,
    task: ResearchTask,
    artifact_root: Path,
    save_root: Path,
    project_root: Path,
) -> None:
    directions = ResearchDirectionRepo(db).replace_for_task(
        task,
        [
            {
                "name": "世界模型与可规划性",
                "queries": ["embodied ai world model planning", "robot world model decision making"],
                "exclude_terms": ["survey"],
            },
            {
                "name": "视觉语言动作模型与数据效率",
                "queries": ["vision language action embodied data efficiency", "robotics foundation model adaptation"],
                "exclude_terms": ["benchmark only"],
            },
            {
                "name": "sim2real、泛化与安全约束",
                "queries": ["embodied ai sim2real generalization safety", "robot policy transfer uncertainty"],
                "exclude_terms": [],
            },
        ],
    )
    paper_repo = ResearchPaperRepo(db)
    world_model_papers = paper_repo.replace_direction_papers(
        directions[0],
        [
            _paper(
                "paper:gpt:wm-core",
                "World Models for Embodied Planning",
                ["A. Researcher", "B. Systems"],
                2025,
                "ICLR",
                "10.1000/demo-wm-core",
                "https://example.com/demo/wm-core",
                "Using compact latent world models to improve long-horizon embodied planning.",
                "Combines latent dynamics with model-predictive control.",
                source="semantic_scholar",
            ),
            _paper(
                "paper:gpt:wm-memory",
                "Memory-Augmented Embodied World Models",
                ["C. Robotics", "D. Agent"],
                2024,
                "NeurIPS",
                "10.1000/demo-wm-memory",
                "https://example.com/demo/wm-memory",
                "Adds persistent memory to embodied world models for partial observability.",
                "Hybrid memory tokens reduce failure on long manipulation tasks.",
                source="openalex",
            ),
        ],
    )
    vlm_papers = paper_repo.replace_direction_papers(
        directions[1],
        [
            _paper(
                "paper:gpt:vla-bridge",
                "Bridging Vision-Language-Action Models and Robot Skill Libraries",
                ["E. Multimodal", "F. Control"],
                2025,
                "CoRL",
                "10.1000/demo-vla-bridge",
                "https://example.com/demo/vla-bridge",
                "Studies how VLA models can call into structured skill libraries.",
                "Uses policy routing to lower data needs during deployment.",
                source="arxiv",
            ),
            _paper(
                "paper:gpt:vla-efficient",
                "Data-Efficient Fine-Tuning for Embodied VLA Models",
                ["G. Adapter", "H. Policy"],
                2024,
                "RSS",
                "10.1000/demo-vla-efficient",
                "https://example.com/demo/vla-efficient",
                "Explores adapters and offline data reuse for embodied VLA systems.",
                "Adapter-style updates preserve zero-shot generality while lowering sample cost.",
                source="semantic_scholar",
            ),
        ],
    )
    generalization_papers = paper_repo.replace_direction_papers(
        directions[2],
        [
            _paper(
                "paper:gpt:sim2real-safe",
                "Safe Sim2Real Transfer for Embodied Agents",
                ["I. Safety", "J. Transfer"],
                2025,
                "ICRA",
                "10.1000/demo-sim2real-safe",
                "https://example.com/demo/sim2real-safe",
                "Covers uncertainty-aware sim2real transfer and runtime safety checks.",
                "Combines policy confidence estimation with deployment guards.",
                source="openalex",
            ),
            _paper(
                "paper:gpt:generalization",
                "Generalization Gaps in Embodied Foundation Policies",
                ["K. Eval", "L. Shift"],
                2024,
                "arXiv",
                "10.1000/demo-generalization",
                "https://example.com/demo/generalization",
                "Analyzes why embodied foundation policies fail under long-tail shifts.",
                "Benchmarks distribution shift, object variation and control latency.",
                source="arxiv",
            ),
        ],
    )
    for direction, papers in zip(directions, [world_model_papers, vlm_papers, generalization_papers], strict=True):
        ResearchDirectionRepo(db).update_papers_count(direction, len(papers))

    ResearchSeedPaperRepo(db).replace_for_task(
        task.id,
        [
            _seed_from_paper(paper)
            for paper in [world_model_papers[0], world_model_papers[1], vlm_papers[0], generalization_papers[0]]
        ],
    )

    round_repo = ResearchRoundRepo(db)
    round_one = round_repo.create(
        task_id=task.id,
        direction_index=1,
        parent_round_id=None,
        depth=1,
        action=ResearchActionType.EXPAND.value,
        feedback_text="先建立世界模型路线，再观察它和 VLA 路线之间的边界。",
        query_terms=["embodied world model", "planning", "robot memory"],
        status=ResearchRoundStatus.DONE.value,
    )
    candidates = ResearchRoundCandidateRepo(db).replace_for_round(
        round_one.id,
        [
            {
                "name": "世界模型中的记忆与部分可观测性",
                "queries": ["embodied world model memory partial observability"],
                "reason": "补齐长程依赖和隐藏状态建模。",
            },
            {
                "name": "世界模型与 VLA 的接口设计",
                "queries": ["world model vision language action interface robotics"],
                "reason": "连接高层规划与动作执行。",
            },
        ],
    )
    ResearchRoundCandidateRepo(db).mark_selected(candidates[0])
    round_two = round_repo.create(
        task_id=task.id,
        direction_index=1,
        parent_round_id=round_one.id,
        depth=2,
        action=ResearchActionType.DEEPEN.value,
        feedback_text="继续观察记忆模块如何影响规划稳定性和样本效率。",
        query_terms=["world model memory", "latent planning stability"],
        status=ResearchRoundStatus.DONE.value,
    )
    ResearchRoundPaperRepo(db).replace_for_round(round_id=round_one.id, rows=world_model_papers, role="seed")
    ResearchRoundPaperRepo(db).replace_for_round(round_id=round_two.id, rows=[world_model_papers[1], vlm_papers[0]], role="seed")

    saved_dir = save_root / task.task_id
    fulltext_dir = artifact_root / task.task_id / "fulltext"
    export_dir = artifact_root / task.task_id
    saved_dir.mkdir(parents=True, exist_ok=True)
    fulltext_dir.mkdir(parents=True, exist_ok=True)
    export_dir.mkdir(parents=True, exist_ok=True)

    demo_paper = world_model_papers[0]
    pdf_path = fulltext_dir / "world-models-demo.pdf"
    txt_path = fulltext_dir / "world-models-demo.txt"
    md_path = saved_dir / "world-models-demo.md"
    bib_path = saved_dir / "world-models-demo.bib"
    pdf_path.write_bytes(_build_demo_pdf("Embodied AI Demo PDF"))
    txt_path.write_text(
        "Embodied AI demo fulltext.\n\nSection 1: world models.\nSection 2: planning stability.\nSection 3: memory and partial observability.\n",
        encoding="utf-8",
    )
    md_path.write_text("# World Models for Embodied Planning\n\n- Key idea: latent world model\n- Why it matters: improves long-horizon planning\n", encoding="utf-8")
    bib_path.write_text("@article{demo_wm_core,\n  title={World Models for Embodied Planning}\n}\n", encoding="utf-8")

    fulltext_row = ResearchPaperFulltextRepo(db).upsert(
        task_id=task.id,
        paper_id=demo_paper.paper_id,
        source_url=demo_paper.url,
        status=ResearchPaperFulltextStatus.PARSED.value,
        pdf_path=str(pdf_path),
        text_path=str(txt_path),
        text_chars=txt_path.read_text(encoding="utf-8").__len__(),
        parser="demo_seed",
        quality_score=0.91,
        sections_json=orjson.dumps({"intro": "world model", "findings": "stable planning"}).decode("utf-8"),
        parsed_at=datetime.now(timezone.utc) - timedelta(hours=2),
        fetched_at=datetime.now(timezone.utc) - timedelta(hours=2, minutes=10),
    )
    service._safe_build_paper_visual_assets(task=task, paper=demo_paper, fulltext=fulltext_row)
    paper_repo.mark_saved(demo_paper, md_path=str(md_path), bib_path=str(bib_path))
    paper_repo.update_key_points(
        demo_paper,
        status="done",
        source="demo_seed",
        key_points="1. 通过潜在世界模型提升长程规划。\n2. 记忆模块缓解部分可观测性。\n3. 适合作为后续 compare 的基线论文。",
    )

    report_path = export_dir / "report.md"
    json_path = export_dir / "papers.json"
    report_path.write_text(
        "# 具身智能 GPT Step Demo\n\n## 主要结论\n- 世界模型路线适合解释规划能力。\n- VLA 路线更适合说明数据效率与技能调用。\n",
        encoding="utf-8",
    )
    json_path.write_text(
        orjson.dumps(
            {
                "task_id": task.task_id,
                "topic": task.topic,
                "papers": [paper.paper_id for paper in world_model_papers + vlm_papers + generalization_papers],
            },
            option=orjson.OPT_INDENT_2,
        ).decode("utf-8"),
        encoding="utf-8",
    )
    ResearchExportRecordRepo(db).create(task_id=task.id, project_id=task.project_id, fmt="md", output_path=str(report_path), status="success")
    ResearchExportRecordRepo(db).create(task_id=task.id, project_id=task.project_id, fmt="json", output_path=str(json_path), status="success")

    compare_row = ResearchCompareReportRepo(db).create(
        report_id="compare-demo-embodied-gpt",
        project_id=task.project_id,
        task_id=task.id,
        collection_id=None,
        scope="task",
        title="世界模型 vs VLA：具身智能路线对比",
        focus="architecture and data efficiency",
        overview="世界模型路线更偏长期规划与可解释状态建模；VLA 路线更偏统一感知-动作接口和少样本适配。",
        common_points=[
            "都依赖高质量多模态数据。",
            "都需要在真实机器人场景中验证泛化能力。",
        ],
        differences=[
            "世界模型更强调显式可规划性。",
            "VLA 更强调统一接口和迁移效率。",
        ],
        recommended_next_steps=[
            "继续补齐记忆模块和长时规划证据。",
            "对比 adapter 微调和世界模型增强策略。",
        ],
        items=[_compare_item(world_model_papers[0]), _compare_item(vlm_papers[0])],
    )

    _create_gpt_step_events(
        db,
        task=task,
        steps=[
            ("task_created", "任务已创建", "已初始化静态 GPT Step Demo。", "done", {"project": DEMO_PROJECT_KEY}),
            ("plan_completed", "方向规划完成", "已生成 3 个具身智能研究方向。", "done", {"directions": 3}),
            ("search_completed", "论文检索完成", "已收集世界模型、VLA 与 sim2real 路线的代表论文。", "done", {"papers": 6}),
            ("exploration_started", "探索轮次已创建", "围绕世界模型方向创建了第 1 轮探索。", "done", {"round_id": round_one.id}),
            ("candidates_generated", "候选方向已生成", "已给出面向记忆模块与接口设计的候选方向。", "done", {"candidate_count": 2}),
            ("candidate_selected", "候选方向已选中", "已选择“世界模型中的记忆与部分可观测性”继续深入。", "done", {"selected_candidate_id": candidates[0].id}),
            ("next_round_created", "下一轮探索已创建", "已进入第 2 轮探索，聚焦规划稳定性与记忆模块。", "done", {"round_id": round_two.id}),
            ("citation_graph_completed", "图谱构建完成", "已生成演示用 citation graph。", "done", {"node_count": 8, "edge_count": 9}),
            ("fulltext_completed", "全文处理完成", "已解析核心论文全文并生成 PDF/TXT 资产。", "done", {"parsed": 1}),
            ("paper_summary_completed", "论文要点已生成", "已为核心世界模型论文生成要点。", "done", {"paper_id": demo_paper.paper_id}),
        ],
    )

    citation_nodes = [
        {"id": f"topic:{task.task_id}", "type": "topic", "label": task.topic},
        {"id": "paper:gpt:wm-core", "type": "paper", "label": "World Models for Embodied Planning"},
        {"id": "paper:gpt:wm-memory", "type": "paper", "label": "Memory-Augmented Embodied World Models"},
        {"id": "paper:gpt:vla-bridge", "type": "paper", "label": "Bridging Vision-Language-Action Models and Robot Skill Libraries"},
    ]
    citation_edges = [
        {"source": f"topic:{task.task_id}", "target": "paper:gpt:wm-core", "type": "seed"},
        {"source": "paper:gpt:wm-core", "target": "paper:gpt:wm-memory", "type": "cites"},
        {"source": "paper:gpt:vla-bridge", "target": "paper:gpt:wm-core", "type": "related"},
    ]
    ResearchGraphSnapshotRepo(db).upsert_snapshot(
        task_id=task.id,
        direction_index=None,
        round_id=round_two.id,
        view_type=ResearchGraphViewType.CITATION.value,
        depth=2,
        nodes=citation_nodes,
        edges=citation_edges,
        stats={"node_count": len(citation_nodes), "edge_count": len(citation_edges), "source": "demo_seed"},
        status=ResearchGraphBuildStatus.DONE.value,
    )

    graph = service.get_graph_snapshot(
        db,
        user_id=user_id,
        task_id=task.task_id,
        view=ResearchGraphViewType.TREE.value,
        include_papers=True,
        paper_limit=12,
    )
    state = service._default_canvas_from_graph(task_id=task.task_id, graph=graph)
    state["nodes"].extend(
        [
            {
                "id": "report:demo:gpt-compare",
                "type": "report",
                "position": {"x": 1420, "y": 180},
                "data": {
                    "label": compare_row.title,
                    "summary": compare_row.overview,
                    "userNote": "这个报告节点用于静态 demo，方便现场直接展示 compare 结果。",
                },
                "hidden": False,
            },
            {
                "id": "note:demo:gpt-next-step",
                "type": "note",
                "position": {"x": 1420, "y": 470},
                "data": {
                    "label": "下一步展示建议",
                    "summary": "先展示 compare 节点，再点开核心论文 PDF，最后切到 OpenClaw Auto 时间线。",
                },
                "hidden": False,
            },
        ]
    )
    state["edges"].extend(
        [
            {
                "id": "manual:gpt:compare-link",
                "source": world_model_papers[0].paper_id,
                "target": "report:demo:gpt-compare",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "compare result"},
                "hidden": False,
            },
            {
                "id": "manual:gpt:note-link",
                "source": f"topic:{task.task_id}",
                "target": "note:demo:gpt-next-step",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "demo note"},
                "hidden": False,
            },
        ]
    )
    state["ui"] = {**state["ui"], "left_sidebar_width": 340, "right_sidebar_width": 460, "layout_mode": "elk_layered"}
    ResearchCanvasStateRepo(db).upsert(task.id, state)


def _seed_auto_task(
    db: Session,
    *,
    service: ResearchService,
    user_id: int,
    task: ResearchTask,
    artifact_root: Path,
    project_root: Path,
) -> None:
    directions = ResearchDirectionRepo(db).replace_for_task(
        task,
        [
            {
                "name": "自治发现的高价值方向",
                "queries": ["embodied ai autonomous research world model manipulation"],
                "exclude_terms": [],
            },
            {
                "name": "机器人操作中的证据链补强",
                "queries": ["robot manipulation evidence chain multimodal planning"],
                "exclude_terms": [],
            },
        ],
    )
    paper_repo = ResearchPaperRepo(db)
    auto_papers = paper_repo.replace_direction_papers(
        directions[0],
        [
            _paper(
                "paper:auto:planner",
                "Autonomous Planning Graphs for Embodied Agents",
                ["M. Auto", "N. Planning"],
                2025,
                "ICRA",
                "10.1000/demo-auto-planner",
                "https://example.com/demo/auto-planner",
                "Investigates planner-first autonomous research for embodied agents.",
                "Combines graph search with evidence aggregation.",
                source="semantic_scholar",
            ),
            _paper(
                "paper:auto:bench",
                "Embodied Evaluation Checkpoints for Open Research Agents",
                ["O. Eval", "P. Trace"],
                2024,
                "CoRL",
                "10.1000/demo-auto-bench",
                "https://example.com/demo/auto-bench",
                "Defines staged checkpoints for autonomous embodied research loops.",
                "Improves interpretability of autonomous runs.",
                source="openalex",
            ),
        ],
    )
    bridge_papers = paper_repo.replace_direction_papers(
        directions[1],
        [
            _paper(
                "paper:auto:evidence",
                "Evidence Chains for Robot Manipulation Research",
                ["Q. Bridge", "R. Execution"],
                2025,
                "RSS",
                "10.1000/demo-auto-evidence",
                "https://example.com/demo/auto-evidence",
                "Organizes multimodal evidence into checkpoints and artifact outputs.",
                "Stage-aware summaries help users guide the next autonomous phase.",
                source="arxiv",
            ),
        ],
    )
    for direction, papers in zip(directions, [auto_papers, bridge_papers], strict=True):
        ResearchDirectionRepo(db).update_papers_count(direction, len(papers))

    artifact_dir = artifact_root / task.task_id / "runs" / DEMO_AUTO_RUN_ID
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_file = artifact_dir / "stage_report.md"
    artifact_file.write_text(
        "# OpenClaw Auto Demo Artifact\n\n## Stage Summary\n- Built initial embodied research graph\n- Waited for user guidance\n- Continued to strengthen evidence chain\n",
        encoding="utf-8",
    )
    artifact_path = artifact_file.relative_to(project_root).as_posix()

    event_repo = ResearchRunEventRepo(db)
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.PROGRESS,
        payload={"message": "auto research started", "phase": "stage_1"},
        seq=1,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.NODE_UPSERT,
        payload={
            "id": "direction:auto:stage-1",
            "type": "direction",
            "label": "世界模型 + 机器人操作证据链",
            "summary": "OpenClaw 在阶段 1 将世界模型与操作任务证据链连接起来。",
            "direction_index": 1,
        },
        seq=2,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.PAPER_UPSERT,
        payload={
            "id": auto_papers[0].paper_id,
            "type": "paper",
            "label": auto_papers[0].title,
            "summary": auto_papers[0].abstract,
            "year": auto_papers[0].year,
            "source": auto_papers[0].source,
            "venue": auto_papers[0].venue,
            "direction_index": 1,
        },
        seq=3,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.EDGE_UPSERT,
        payload={
            "source": f"topic:{task.task_id}",
            "target": auto_papers[0].paper_id,
            "type": "seed",
            "weight": 1,
        },
        seq=4,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.CHECKPOINT,
        payload={
            "checkpoint_id": "cp-embodied-stage-1",
            "title": "Stage 1 checkpoint: 初版研究图谱已建立",
            "summary": "当前已经串起世界模型、VLA 与机器人操作证据链，建议下一阶段补强实验与全文证据。",
            "suggested_next_steps": ["补全文证据", "增加 compare 视角", "确认高价值引用链"],
            "graph_delta_summary": "新增 1 个方向节点、2 篇关键论文和 1 条主题连线。",
            "report_excerpt": "初版图谱显示世界模型与操作证据链是最值得继续扩展的主线。",
        },
        seq=5,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.PROGRESS,
        payload={
            "kind": "user_guidance",
            "text": "继续补强证据链，优先说明世界模型与真实机器人操作的连接方式。",
            "tags": ["demo", "guidance"],
            "message": "guidance received",
            "phase": "stage_2",
        },
        seq=6,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.REPORT_CHUNK,
        payload={
            "title": "Stage 2 report",
            "summary": "第二阶段完成后，系统将世界模型、操作任务和评测基准串联成更清晰的证据链。",
            "content": "OpenClaw 建议下一步把 compare 结果与 PDF/fulltext 资产一起展示，方便现场讲解。",
            "report_excerpt": "阶段 2 重点补强了全文证据与评测接口。",
        },
        seq=7,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.ARTIFACT,
        payload={
            "kind": "stage_report",
            "title": "Embodied AI stage report",
            "path": artifact_path,
        },
        seq=8,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.PROGRESS,
        payload={"message": "auto research completed", "phase": "complete", "status": ResearchAutoStatus.COMPLETED.value},
        seq=9,
    )

    ResearchGraphSnapshotRepo(db).upsert_snapshot(
        task_id=task.id,
        direction_index=None,
        round_id=None,
        view_type=ResearchGraphViewType.CITATION.value,
        depth=2,
        nodes=[
            {"id": f"topic:{task.task_id}", "type": "topic", "label": task.topic},
            {"id": auto_papers[0].paper_id, "type": "paper", "label": auto_papers[0].title},
            {"id": bridge_papers[0].paper_id, "type": "paper", "label": bridge_papers[0].title},
        ],
        edges=[
            {"source": f"topic:{task.task_id}", "target": auto_papers[0].paper_id, "type": "seed"},
            {"source": auto_papers[0].paper_id, "target": bridge_papers[0].paper_id, "type": "supports"},
        ],
        stats={"node_count": 3, "edge_count": 2, "source": "demo_seed"},
        status=ResearchGraphBuildStatus.DONE.value,
    )

    graph = service.get_graph_snapshot(
        db,
        user_id=user_id,
        task_id=task.task_id,
        view=ResearchGraphViewType.TREE.value,
        include_papers=True,
        paper_limit=12,
    )
    state = service._default_canvas_from_graph(task_id=task.task_id, graph=graph)
    state["nodes"].append(
        {
            "id": "note:demo:auto-stage",
            "type": "note",
            "position": {"x": 1360, "y": 320},
            "data": {
                "label": "OpenClaw 展示提示",
                "summary": "这里已经包含 checkpoint、guidance 历史、阶段报告和 artifact，可直接切到时间线展示。",
            },
            "hidden": False,
        }
    )
    state["edges"].append(
        {
            "id": "manual:auto:note-link",
            "source": f"topic:{task.task_id}",
            "target": "note:demo:auto-stage",
            "type": "smoothstep",
            "data": {"kind": "manual", "label": "demo note"},
            "hidden": False,
        }
    )
    state["ui"] = {**state["ui"], "left_sidebar_width": 340, "right_sidebar_width": 460, "layout_mode": "elk_layered"}
    ResearchCanvasStateRepo(db).upsert(task.id, state)


def _seed_collection(
    db: Session,
    *,
    project: ResearchProject,
    collection: ResearchCollection,
    gpt_task: ResearchTask,
    auto_task: ResearchTask,
) -> None:
    paper_repo = ResearchPaperRepo(db)
    item_repo = ResearchCollectionItemRepo(db)
    selected_papers = [
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:wm-core"),
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:vla-bridge"),
        paper_repo.get_by_token(auto_task.id, "paper:auto:planner"),
        paper_repo.get_by_token(auto_task.id, "paper:auto:evidence"),
    ]
    task_token_by_db_id = {
        gpt_task.id: gpt_task.task_id,
        auto_task.id: auto_task.task_id,
    }
    now = datetime.now(timezone.utc)
    for paper in [paper for paper in selected_papers if paper is not None]:
        item_repo.create(
            ResearchCollectionItem(
                collection_id=collection.id,
                source_task_id=paper.task_id,
                paper_id=paper.paper_id,
                doi=paper.doi,
                title=paper.title,
                title_norm=paper.title_norm,
                authors_json=paper.authors_json,
                year=paper.year,
                venue=paper.venue,
                url=paper.url,
                source=paper.source,
                metadata_json=orjson.dumps(
                    {"demo": True, "task_id": task_token_by_db_id.get(paper.task_id)}
                ).decode("utf-8"),
                created_at=now,
                updated_at=now,
            )
        )

    ResearchCompareReportRepo(db).create(
        report_id="compare-demo-embodied-collection",
        project_id=project.id,
        task_id=None,
        collection_id=collection.id,
        scope="collection",
        title="具身智能核心论文集对比",
        focus="world model vs VLA vs evidence chain",
        overview="这个 collection 同时覆盖了规划、VLA 和自治证据链三条路线，适合作为后续派生 study task 的种子池。",
        common_points=["都把多模态感知作为研究基础。", "都需要更强的真实机器人验证。"],
        differences=["规划路线强调结构化状态。", "VLA 路线强调统一接口。", "自治路线强调阶段性证据组织。"],
        recommended_next_steps=["从 collection 派生新任务。", "对比世界模型与 VLA 的真实部署证据。"],
        items=[
            {"paper_id": "paper:gpt:wm-core", "title": "World Models for Embodied Planning"},
            {"paper_id": "paper:gpt:vla-bridge", "title": "Bridging Vision-Language-Action Models and Robot Skill Libraries"},
            {"paper_id": "paper:auto:evidence", "title": "Evidence Chains for Robot Manipulation Research"},
        ],
    )
    collection.summary_text = "这个 collection 把世界模型、VLA 和自治证据链三条主线放在一起，方便做 compare 或继续派生 study task。"
    collection.updated_at = now
    db.add(collection)
    db.flush()


def _create_gpt_step_events(db: Session, *, task: ResearchTask, steps: list[tuple[str, str, str, str, dict]]) -> None:
    repo = ResearchRunEventRepo(db)
    run_id = f"step-{task.task_id}"
    for index, (step, title, message, status, details) in enumerate(steps, start=1):
        repo.create_event(
            task_id=task.id,
            run_id=run_id,
            event_type=ResearchRunEventType.PROGRESS,
            payload={
                "kind": "gpt_step",
                "step": step,
                "title": title,
                "message": message,
                "status": status,
                "details": details,
                "result_refs": {},
            },
            seq=index,
        )


def _paper(
    paper_id: str,
    title: str,
    authors: list[str],
    year: int,
    venue: str,
    doi: str,
    url: str,
    abstract: str,
    method_summary: str,
    *,
    source: str,
) -> dict:
    return {
        "paper_id": paper_id,
        "title": title,
        "title_norm": _normalize_title(title),
        "authors": authors,
        "year": year,
        "venue": venue,
        "doi": doi,
        "url": url,
        "abstract": abstract,
        "method_summary": method_summary,
        "source": source,
    }


def _seed_from_paper(paper) -> dict:
    return {
        "paper_id": paper.paper_id,
        "title": paper.title,
        "title_norm": paper.title_norm,
        "authors": orjson.loads(paper.authors_json or "[]"),
        "year": paper.year,
        "venue": paper.venue,
        "doi": paper.doi,
        "url": paper.url,
        "abstract": paper.abstract,
        "source": paper.source,
    }


def _compare_item(paper) -> dict:
    return {
        "paper_id": paper.paper_id,
        "title": paper.title,
        "year": paper.year,
        "venue": paper.venue,
        "source": paper.source,
    }


def _normalize_title(title: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in title).split())[:512]


def _build_demo_pdf(text: str) -> bytes:
    content = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET".encode("ascii", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    parts = [b"%PDF-1.4\n"]
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(sum(len(part) for part in parts))
        parts.append(f"{index} 0 obj\n".encode("ascii"))
        parts.append(body)
        parts.append(b"\nendobj\n")
    xref_offset = sum(len(part) for part in parts)
    parts.append(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    parts.append(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        parts.append(f"{offset:010d} 00000 n \n".encode("ascii"))
    parts.append(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return b"".join(parts)
