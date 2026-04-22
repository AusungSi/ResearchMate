from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import orjson
from sqlalchemy import select
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
from app.domain.models import (
    ResearchCanvasState,
    ResearchCitationEdge,
    ResearchCitationFetchCache,
    ResearchCollection,
    ResearchCollectionExportRecord,
    ResearchCollectionItem,
    ResearchCompareReport,
    ResearchDirection,
    ResearchExportRecord,
    ResearchGraphSnapshot,
    ResearchJob,
    ResearchNodeChat,
    ResearchPaper,
    ResearchPaperFulltext,
    ResearchProject,
    ResearchRound,
    ResearchRoundCandidate,
    ResearchRoundPaper,
    ResearchRunEvent,
    ResearchSearchCache,
    ResearchSeedPaper,
    ResearchSession,
    ResearchTask,
)
from app.infra.repos import (
    ResearchCanvasStateRepo,
    ResearchCompareReportRepo,
    ResearchCollectionExportRecordRepo,
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
DEMO_SOURCE_REF = "embodied-ai-real-demo-v2"


@dataclass(frozen=True)
class DemoPaper:
    token: str
    arxiv_id: str
    title: str
    authors: tuple[str, ...]
    year: int
    abstract: str
    method_summary: str
    structured_sections: dict[str, str]
    venue: str = "arXiv"
    doi: str | None = None
    source: str = "arxiv"
    cache_pdf: bool = False

    @property
    def abs_url(self) -> str:
        return f"https://arxiv.org/abs/{self.arxiv_id}"

    @property
    def pdf_url(self) -> str:
        return f"https://arxiv.org/pdf/{self.arxiv_id}.pdf"


REAL_GPT_PAPERS: dict[str, DemoPaper] = {
    "paper:gpt:wm-core": DemoPaper(
        token="paper:gpt:wm-core",
        arxiv_id="2206.14176v1",
        title="DayDreamer: World Models for Physical Robot Learning",
        authors=("Philipp Wu", "Alejandro Escontrela", "Danijar Hafner", "Ken Goldberg", "Pieter Abbeel"),
        year=2022,
        abstract=(
            "DayDreamer studies whether Dreamer-style world models can be trained directly on physical robots "
            "rather than in simulation. The paper shows that latent imagination can cut trial-and-error costs in "
            "the real world, enabling a quadruped to learn stand-up and walking behaviors in about one hour, adapt "
            "to pushes within minutes, and support camera-based pick-and-place and navigation on other robots."
        ),
        method_summary="Learn a latent world model on real robots and plan in imagination to reduce physical interaction cost.",
        structured_sections={
            "研究问题": "真实机器人学习通常样本效率低，纯强化学习往往需要大量交互，难以直接部署到物理世界。",
            "核心方法": "把 Dreamer 的世界模型路线直接搬到真实机器人上，在潜在空间中预测动作后果并做想象规划。",
            "数据与实验": "覆盖四足机器人、两台机械臂和轮式机器人，统一使用在线学习与相同超参数配置。",
            "关键结果/证据": "四足机器人约 1 小时内学会起身和行走，受扰动后 10 分钟内适应；机械臂接近人工水平完成抓放。",
            "局限与风险": "仍依赖奖励设计和任务工程，论文更像强基线验证，距离大规模开放环境泛化还有差距。",
            "对当前研究任务的启发/下一步建议": "适合作为“世界模型是否能在真实具身系统里带来样本效率收益”的核心起点论文。",
        },
        cache_pdf=True,
    ),
    "paper:gpt:wm-memory": DemoPaper(
        token="paper:gpt:wm-memory",
        arxiv_id="2412.14957v2",
        title="Dream to Manipulate: Compositional World Models Empowering Robot Imitation Learning with Imagination",
        authors=(
            "Leonardo Barcellona",
            "Andrii Zadaianchuk",
            "Davide Allegro",
            "Samuele Papa",
            "Stefano Ghidoni",
            "Efstratios Gavves",
        ),
        year=2024,
        abstract=(
            "Dream to Manipulate rethinks robot world models as learnable digital twins. DreMa combines explicit "
            "scene representations, Gaussian Splatting, and physics simulators so the robot can imagine novel object "
            "configurations and generate new data for imitation learning, significantly improving robustness and "
            "allowing one-shot policy learning on a real Franka Panda."
        ),
        method_summary="Use compositional digital twins plus imagination-based data augmentation for robot imitation learning.",
        structured_sections={
            "研究问题": "现有机器人世界模型往往难以忠实复制眼前环境，容易产生幻觉，不适合直接支撑真实机器人决策。",
            "核心方法": "提出 DreMa，把世界模型重构为可学习数字孪生，结合 Gaussian Splatting 和物理模拟做可组合想象。",
            "数据与实验": "在多个机械臂操控设置下评估鲁棒性、数据效率和分布扩展能力，并包含真实 Franka Panda 实验。",
            "关键结果/证据": "通过想象生成额外模仿数据后，策略在动作和物体分布变化下更稳健，真实机器人实现单样本学习。",
            "局限与风险": "构建显式数字孪生的代价较高，对场景重建质量和物理模拟可信度较敏感。",
            "对当前研究任务的启发/下一步建议": "它补充了 DayDreamer 更偏 latent planning 的路线，适合回答“显式世界建模如何帮助数据效率”。",
        },
    ),
    "paper:gpt:vla-bridge": DemoPaper(
        token="paper:gpt:vla-bridge",
        arxiv_id="2307.15818v1",
        title="RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control",
        authors=("Anthony Brohan", "Noah Brown", "Justice Carbajal", "Yevgen Chebotar", "et al."),
        year=2023,
        abstract=(
            "RT-2 shows how Internet-scale vision-language pretraining can be fused directly into robotic control. "
            "The paper expresses actions as text tokens, co-fine-tunes on robot trajectories and web-scale "
            "vision-language tasks, and reports better generalization to novel objects, instructions, and "
            "multi-step semantic reasoning."
        ),
        method_summary="Represent robot actions as tokens and co-train vision-language-action behavior with web-scale data.",
        structured_sections={
            "研究问题": "如何把互联网级视觉语言知识真正迁移到机器人控制，而不是仅停留在感知或问答层面。",
            "核心方法": "把动作离散成文本 token，与视觉语言模型统一建模，联合机器人轨迹和互联网视觉语言任务共同微调。",
            "数据与实验": "论文报告约 6000 次机器人评测，重点观察新物体、未见指令和语义推理控制的泛化表现。",
            "关键结果/证据": "RT-2 不仅能执行操控任务，还出现了基于语义和常识的选择能力，例如识别最小物体或临时工具。",
            "局限与风险": "动作 token 化带来控制分辨率约束，真实部署仍依赖大规模机器人数据和昂贵预训练资源。",
            "对当前研究任务的启发/下一步建议": "它是 VLA 主线的代表论文，适合和世界模型路线比较“高层语义泛化 vs 显式规划”。",
        },
        cache_pdf=True,
    ),
    "paper:gpt:vla-efficient": DemoPaper(
        token="paper:gpt:vla-efficient",
        arxiv_id="2406.09246v3",
        title="OpenVLA: An Open-Source Vision-Language-Action Model",
        authors=("Moo Jin Kim", "Karl Pertsch", "Siddharth Karamcheti", "Ted Xiao", "et al."),
        year=2024,
        abstract=(
            "OpenVLA is an open-source 7B vision-language-action model trained on 970k real-world robot "
            "demonstrations. It outperforms larger closed models such as RT-2-X across 29 tasks, supports "
            "consumer-GPU fine-tuning, and demonstrates strong language grounding and multi-object generalization."
        ),
        method_summary="Open-source 7B VLA with strong fine-tuning efficiency and strong generalist manipulation performance.",
        structured_sections={
            "研究问题": "闭源 VLA 难以复用，社区缺少一个可公开微调、可复现实验的强基线。",
            "核心方法": "以 Llama 2 为语言骨干，融合 DINOv2 与 SigLIP 视觉特征，在 97 万条真实机器人演示上预训练。",
            "数据与实验": "跨 29 个任务和多种机器人形态评估 generalist manipulation，并测试 LoRA/量化等高效微调方案。",
            "关键结果/证据": "OpenVLA 以更少参数超过 RT-2-X，并且微调后比从头训练的模仿学习策略更稳、更泛化。",
            "局限与风险": "虽然是开源模型，但训练数据和算力门槛仍高；具体成功率对数据清洗与动作接口设计仍敏感。",
            "对当前研究任务的启发/下一步建议": "它是当前 demo 里最适合作为“开源 VLA 工作台基线”的论文，可连接后续适配和部署讨论。",
        },
        cache_pdf=True,
    ),
    "paper:gpt:sim2real-safe": DemoPaper(
        token="paper:gpt:sim2real-safe",
        arxiv_id="2310.08864v9",
        title="Open X-Embodiment: Robotic Learning Datasets and RT-X Models",
        authors=("Open X-Embodiment Collaboration", "Abby O'Neill", "Abdul Rehman", "Abhinav Gupta", "et al."),
        year=2023,
        abstract=(
            "Open X-Embodiment standardizes a multi-institution robotics dataset spanning 22 robots, more than "
            "500 skills, and over 160k tasks, and uses it to train RT-X models that show positive transfer across "
            "platforms. The work is foundational for cross-embodiment generalization and efficient adaptation."
        ),
        method_summary="Build a standardized cross-robot dataset and show that shared pretraining improves multiple platforms.",
        structured_sections={
            "研究问题": "机器人学习长期被数据孤岛和平台割裂困住，难以形成类似 NLP/CV 的统一预训练底座。",
            "核心方法": "联合多机构整理 22 台机器人、527 种技能的数据，统一格式后训练跨机器人 RT-X 模型。",
            "数据与实验": "数据覆盖 16 万以上任务，重点评估不同机器人之间的正迁移和高容量模型的共享收益。",
            "关键结果/证据": "RT-X 在多个平台上表现出正迁移，说明跨 embodiment 的共享预训练是可行且有价值的。",
            "局限与风险": "数据标准化成本很高，不同机器人动作空间和观测接口差异仍会限制真正统一建模。",
            "对当前研究任务的启发/下一步建议": "它适合支撑 demo 中“数据规模与跨平台迁移”这条线，也能解释 OpenVLA/Octo 的数据来源。",
        },
    ),
    "paper:gpt:generalization": DemoPaper(
        token="paper:gpt:generalization",
        arxiv_id="2405.12213v2",
        title="Octo: An Open-Source Generalist Robot Policy",
        authors=("Octo Model Team", "Dibya Ghosh", "Homer Walke", "Karl Pertsch", "et al."),
        year=2024,
        abstract=(
            "Octo trains a large transformer policy on 800k trajectories from Open X-Embodiment and targets broad "
            "compatibility across sensors, action spaces, and platforms. It shows that a single open-source policy "
            "can be fine-tuned on diverse robots within hours on consumer GPUs."
        ),
        method_summary="Train a single transformer policy on Open X and adapt it across sensors and action spaces.",
        structured_sections={
            "研究问题": "如果要把大规模预训练真正变成通用机器人底座，模型必须同时兼容不同观察、动作和平台。",
            "核心方法": "在 Open X-Embodiment 的 80 万条轨迹上训练大规模 transformer policy，并强调可高效迁移。",
            "数据与实验": "实验覆盖 9 个机器人平台，评估语言指令、目标图像条件以及跨观测/动作空间微调表现。",
            "关键结果/证据": "Octo 证明单一开源策略初始化可以在数小时内迁移到新平台，并提供系统性设计消融。",
            "局限与风险": "它更像 generalist policy 基座而非完整研究代理，落地依旧依赖目标平台的少量在域数据。",
            "对当前研究任务的启发/下一步建议": "Octo 很适合放在 demo 的“泛化与开放底座”位置，和 OpenVLA 一起展示开源生态的分工。",
        },
    ),
}

REAL_AUTO_PAPERS: dict[str, DemoPaper] = {
    "paper:auto:planner": DemoPaper(
        token="paper:auto:planner",
        arxiv_id="2212.06817v2",
        title="RT-1: Robotics Transformer for Real-World Control at Scale",
        authors=("Anthony Brohan", "Noah Brown", "Justice Carbajal", "Yevgen Chebotar", "et al."),
        year=2022,
        abstract=(
            "RT-1 studies whether task-agnostic large-scale training can produce a scalable general robotic policy. "
            "It uses a transformer policy trained on a broad real-world robot dataset and shows improvements as "
            "data, model size, and diversity increase."
        ),
        method_summary="A scalable transformer policy for large-scale real-world robot control.",
        structured_sections={
            "研究问题": "机器人是否也能像 NLP/CV 一样，通过开放任务预训练得到可迁移的统一底座。",
            "核心方法": "提出 Robotics Transformer，在大规模真实机器人数据上做任务无关训练，并系统分析缩放规律。",
            "数据与实验": "论文围绕真实机器人任务集合评估模型容量、数据多样性与泛化收益之间的关系。",
            "关键结果/证据": "随着数据与模型增大，RT-1 呈现更好的泛化与下游表现，为后续 RT-2 和 VLA 路线铺路。",
            "局限与风险": "它主要解决统一策略建模，不直接回答语义推理、世界模型规划或跨平台数据统一的问题。",
            "对当前研究任务的启发/下一步建议": "适合作为 OpenClaw Auto 任务中的阶段 1 证据节点，用来建立 foundation policy 主线。",
        },
    ),
    "paper:auto:bench": DemoPaper(
        token="paper:auto:bench",
        arxiv_id="2310.08864v9",
        title="Open X-Embodiment: Robotic Learning Datasets and RT-X Models",
        authors=("Open X-Embodiment Collaboration", "Abby O'Neill", "Abdul Rehman", "Abhinav Gupta", "et al."),
        year=2023,
        abstract=REAL_GPT_PAPERS["paper:gpt:sim2real-safe"].abstract,
        method_summary="A cross-robot data and evaluation foundation for studying transfer at scale.",
        structured_sections=REAL_GPT_PAPERS["paper:gpt:sim2real-safe"].structured_sections,
    ),
    "paper:auto:evidence": DemoPaper(
        token="paper:auto:evidence",
        arxiv_id="2502.19645v2",
        title="Fine-Tuning Vision-Language-Action Models: Optimizing Speed and Success",
        authors=("Moo Jin Kim", "Chelsea Finn", "Percy Liang"),
        year=2025,
        abstract=(
            "OpenVLA-OFT studies how to fine-tune VLA models effectively. It proposes an optimized recipe with "
            "parallel decoding, action chunking, continuous action representations, and L1 regression, improving "
            "OpenVLA's success rate on LIBERO from 76.5% to 97.1% while boosting throughput by 26x."
        ),
        method_summary="A concrete fine-tuning recipe that makes VLA adaptation faster and more successful.",
        structured_sections={
            "研究问题": "VLA 预训练后仍需针对新机器人和新任务做适配，但高效、可靠的微调策略并不明确。",
            "核心方法": "系统比较动作解码、动作表示和学习目标，提出 OFT 配方：并行解码、action chunking、连续动作表征和 L1 回归。",
            "数据与实验": "以 OpenVLA 为基座，在 LIBERO 仿真和真实世界双臂 ALOHA 机器人上验证适配效果。",
            "关键结果/证据": "平均成功率从 76.5% 提升到 97.1%，推理吞吐提高 26 倍，真实机器人上也明显优于多类基线。",
            "局限与风险": "它解决的是适配策略而不是底座本身，效果与基模型质量、任务接口和控制频率高度相关。",
            "对当前研究任务的启发/下一步建议": "很适合作为 OpenClaw 阶段 2 的“证据强化节点”，说明 VLA 部署为什么需要专门调优路线。",
        },
        cache_pdf=True,
    ),
}


def seed_embodied_ai_demo(
    db: Session,
    *,
    user_id: int,
    service: ResearchService,
    root_dir: Path | None = None,
    refresh: bool = False,
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

    if refresh or _needs_refresh(db, project=project, gpt_task=gpt_task, auto_task=auto_task, collection=collection):
        _purge_demo_workspace(db, project=project, gpt_task=gpt_task, auto_task=auto_task, collection=collection)
        project = None
        gpt_task = None
        auto_task = None
        collection = None

    if project and gpt_task and auto_task and collection:
        return _summary(project=project, gpt_task=gpt_task, auto_task=auto_task, collection=collection, initialized=False)

    now = datetime.now(timezone.utc)
    if project is None:
        project = project_repo.create(
            ResearchProject(
                project_key=DEMO_PROJECT_KEY,
                user_id=user_id,
                name="具身智能 Demo 工作区",
                description="当前工作台版本对应的完整静态展示区，使用真实论文、真实 PDF 缓存和真实主题内容。",
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
                "sources": ["arxiv", "semantic_scholar", "openalex"],
                "top_n": 8,
                "focus": "Embodied AI static demo",
            },
            created_at=now - timedelta(hours=5),
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
            topic="具身智能自治调研：从 RT-1 到 OpenVLA-OFT 的阶段性证据链",
            mode=ResearchRunMode.OPENCLAW_AUTO,
            backend=ResearchLLMBackend.OPENCLAW,
            model=settings.openclaw_agent_id or "main",
            status=ResearchTaskStatus.DONE,
            auto_status=ResearchAutoStatus.COMPLETED,
            constraints={
                "sources": ["arxiv", "semantic_scholar", "openalex"],
                "top_n": 6,
                "focus": "Embodied AI auto demo",
            },
            last_checkpoint_id="cp-embodied-stage-1",
            created_at=now - timedelta(hours=4),
        )
        _seed_auto_task(
            db,
            service=service,
            user_id=user_id,
            task=auto_task,
            artifact_root=artifact_root,
            save_root=save_root,
            project_root=project_root,
        )

    if collection is None:
        collection = collection_repo.create(
            ResearchCollection(
                collection_id=DEMO_COLLECTION_ID,
                project_id=project.id,
                name="具身智能核心论文集",
                description="围绕世界模型、VLA、跨平台数据与高效适配整理的真实论文集合。",
                source_type="demo_seed",
                source_ref=DEMO_SOURCE_REF,
                summary_text="聚焦 DayDreamer、RT-2、RT-1 和 OpenVLA-OFT 四条关键证据链，适合做 compare、派生 study task 和讲解完整演示。",
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
            artifact_root=artifact_root,
        )

    project.updated_at = datetime.now(timezone.utc)
    db.add(project)
    db.flush()
    return _summary(project=project, gpt_task=gpt_task, auto_task=auto_task, collection=collection, initialized=True)


def _needs_refresh(
    db: Session,
    *,
    project: ResearchProject | None,
    gpt_task: ResearchTask | None,
    auto_task: ResearchTask | None,
    collection: ResearchCollection | None,
) -> bool:
    if not (project and gpt_task and auto_task and collection):
        return False
    if (collection.source_ref or "").strip() != DEMO_SOURCE_REF:
        return True
    core_paper = ResearchPaperRepo(db).get_by_token(gpt_task.id, "paper:gpt:wm-core")
    if core_paper is None:
        return True
    if "example.com" in (core_paper.url or ""):
        return True
    fulltext = ResearchPaperFulltextRepo(db).get(gpt_task.id, core_paper.paper_id)
    if fulltext is None or not fulltext.pdf_path or not Path(fulltext.pdf_path).exists():
        return True
    return False


def _purge_demo_workspace(
    db: Session,
    *,
    project: ResearchProject | None,
    gpt_task: ResearchTask | None,
    auto_task: ResearchTask | None,
    collection: ResearchCollection | None,
) -> None:
    task_rows = [row for row in (gpt_task, auto_task) if row is not None]
    task_ids = [row.id for row in task_rows]
    round_ids: list[int] = []
    if task_ids:
        round_ids = list(db.execute(select(ResearchRound.id).where(ResearchRound.task_id.in_(task_ids))).scalars().all())
    if round_ids:
        db.query(ResearchRoundPaper).filter(ResearchRoundPaper.round_id.in_(round_ids)).delete(synchronize_session=False)
        db.query(ResearchRoundCandidate).filter(ResearchRoundCandidate.round_id.in_(round_ids)).delete(synchronize_session=False)
    if task_ids:
        db.query(ResearchCanvasState).filter(ResearchCanvasState.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchCitationEdge).filter(ResearchCitationEdge.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchCitationFetchCache).filter(ResearchCitationFetchCache.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchExportRecord).filter(ResearchExportRecord.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchGraphSnapshot).filter(ResearchGraphSnapshot.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchJob).filter(ResearchJob.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchNodeChat).filter(ResearchNodeChat.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchPaperFulltext).filter(ResearchPaperFulltext.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchRunEvent).filter(ResearchRunEvent.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchSearchCache).filter(ResearchSearchCache.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchSeedPaper).filter(ResearchSeedPaper.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchCompareReport).filter(ResearchCompareReport.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchPaper).filter(ResearchPaper.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchDirection).filter(ResearchDirection.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchRound).filter(ResearchRound.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchCollectionItem).filter(ResearchCollectionItem.source_task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(ResearchSession).filter(ResearchSession.active_task_id.in_([row.task_id for row in task_rows])).update(
            {"active_task_id": None},
            synchronize_session=False,
        )
        db.query(ResearchTask).filter(ResearchTask.id.in_(task_ids)).delete(synchronize_session=False)
    if collection is not None:
        db.query(ResearchCollectionExportRecord).filter(
            ResearchCollectionExportRecord.collection_id == collection.id
        ).delete(synchronize_session=False)
        db.query(ResearchCompareReport).filter(ResearchCompareReport.collection_id == collection.id).delete(
            synchronize_session=False
        )
        db.query(ResearchCollectionItem).filter(ResearchCollectionItem.collection_id == collection.id).delete(
            synchronize_session=False
        )
        db.query(ResearchCollection).filter(ResearchCollection.id == collection.id).delete(synchronize_session=False)
    if project is not None:
        db.query(ResearchCompareReport).filter(ResearchCompareReport.project_id == project.id).delete(
            synchronize_session=False
        )
        db.query(ResearchExportRecord).filter(ResearchExportRecord.project_id == project.id).delete(synchronize_session=False)
        db.query(ResearchProject).filter(ResearchProject.id == project.id).delete(synchronize_session=False)
    db.flush()

    settings = get_settings()
    artifact_root = Path(settings.research_artifact_dir).expanduser().resolve()
    save_root = Path(settings.research_save_base_dir).expanduser().resolve()
    for task_id in (DEMO_GPT_TASK_ID, DEMO_AUTO_TASK_ID):
        shutil.rmtree(artifact_root / task_id, ignore_errors=True)
        shutil.rmtree(save_root / task_id, ignore_errors=True)


def _summary(
    *,
    project: ResearchProject,
    gpt_task: ResearchTask,
    auto_task: ResearchTask,
    collection: ResearchCollection,
    initialized: bool,
) -> dict:
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


def _upsert_canvas_nodes(state: dict, nodes: list[dict]) -> None:
    by_id = {str(node.get("id")): node for node in state.get("nodes", [])}
    for node in nodes:
        by_id[str(node.get("id"))] = node
    state["nodes"] = list(by_id.values())


def _upsert_canvas_edges(state: dict, edges: list[dict]) -> None:
    by_id = {str(edge.get("id")): edge for edge in state.get("edges", [])}
    for edge in edges:
        by_id[str(edge.get("id"))] = edge
    state["edges"] = list(by_id.values())


def _apply_canvas_positions(state: dict, positions: dict[str, tuple[int, int]]) -> None:
    overflow_x = 2260
    overflow_y = 120
    overflow_step_x = 360
    overflow_step_y = 240
    overflow_index = 0
    for node in state.get("nodes", []):
        node_id = str(node.get("id") or "")
        if node_id in positions:
            x, y = positions[node_id]
        else:
            x = overflow_x + (overflow_index % 2) * overflow_step_x
            y = overflow_y + (overflow_index // 2) * overflow_step_y
            overflow_index += 1
        node["position"] = {"x": x, "y": y}


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
                "name": "世界模型与真实机器人规划",
                "queries": ["embodied world model physical robot learning", "robot world model imagination planning"],
                "exclude_terms": ["survey"],
            },
            {
                "name": "视觉语言动作模型与开源底座",
                "queries": ["vision language action robot foundation model", "open source VLA robot policy"],
                "exclude_terms": ["survey"],
            },
            {
                "name": "跨平台数据、适配效率与泛化",
                "queries": ["open x embodiment robot transfer efficiency", "robot policy adaptation data efficiency"],
                "exclude_terms": [],
            },
        ],
    )
    paper_repo = ResearchPaperRepo(db)
    world_model_papers = paper_repo.replace_direction_papers(
        directions[0],
        [_paper_payload(REAL_GPT_PAPERS["paper:gpt:wm-core"]), _paper_payload(REAL_GPT_PAPERS["paper:gpt:wm-memory"])],
    )
    vla_papers = paper_repo.replace_direction_papers(
        directions[1],
        [_paper_payload(REAL_GPT_PAPERS["paper:gpt:vla-bridge"]), _paper_payload(REAL_GPT_PAPERS["paper:gpt:vla-efficient"])],
    )
    generalization_papers = paper_repo.replace_direction_papers(
        directions[2],
        [_paper_payload(REAL_GPT_PAPERS["paper:gpt:sim2real-safe"]), _paper_payload(REAL_GPT_PAPERS["paper:gpt:generalization"])],
    )
    for direction, papers in zip(directions, [world_model_papers, vla_papers, generalization_papers], strict=True):
        ResearchDirectionRepo(db).update_papers_count(direction, len(papers))

    ResearchSeedPaperRepo(db).replace_for_task(
        task.id,
        [_seed_from_paper(row) for row in [world_model_papers[0], vla_papers[0], generalization_papers[0]]],
    )

    round_repo = ResearchRoundRepo(db)
    round_one = round_repo.create(
        task_id=task.id,
        direction_index=1,
        parent_round_id=None,
        depth=1,
        action=ResearchActionType.EXPAND.value,
        feedback_text="先用 DayDreamer 解释真实世界世界模型为什么值得看，再把它和 RT-2、OpenVLA 放在一个工作流里比较。",
        query_terms=["world model", "robot learning", "imagination"],
        status=ResearchRoundStatus.DONE.value,
    )
    candidates = ResearchRoundCandidateRepo(db).replace_for_round(
        round_one.id,
        [
            {
                "name": "显式数字孪生与 latent world model 的分工",
                "queries": ["digital twin world model robot imitation", "latent world model physical robot learning"],
                "reason": "把 DreMa 和 DayDreamer 放在同一条世界模型主线上，回答显式建模与隐式想象各自适合什么。",
            },
            {
                "name": "世界模型如何衔接 VLA",
                "queries": ["world model vision language action robotics", "planning interface VLA robot"],
                "reason": "展示高层规划和低层动作接口之间的桥接问题。",
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
        feedback_text="继续看显式数字孪生能否进一步提升样本效率，并把它和 OpenVLA 的适配路线放在一起。",
        query_terms=["digital twin", "world model", "data efficiency"],
        status=ResearchRoundStatus.DONE.value,
    )
    round_three = round_repo.create(
        task_id=task.id,
        direction_index=2,
        parent_round_id=None,
        depth=1,
        action=ResearchActionType.EXPAND.value,
        feedback_text="把 RT-2 和 OpenVLA 放到同一条 VLA 分支里，专门解释语义泛化、开源底座和可调优性。",
        query_terms=["vision language action", "robot foundation model", "openvla"],
        status=ResearchRoundStatus.DONE.value,
    )
    round_four = round_repo.create(
        task_id=task.id,
        direction_index=3,
        parent_round_id=None,
        depth=1,
        action=ResearchActionType.EXPAND.value,
        feedback_text="把 Open X-Embodiment 和 Octo 放在一起，展示跨平台数据、开放底座和快速适配能力。",
        query_terms=["open x embodiment", "octo", "robot transfer"],
        status=ResearchRoundStatus.DONE.value,
    )
    ResearchRoundPaperRepo(db).replace_for_round(round_id=round_one.id, rows=[world_model_papers[0]], role="seed")
    ResearchRoundPaperRepo(db).replace_for_round(round_id=round_two.id, rows=[world_model_papers[1]], role="seed")
    ResearchRoundPaperRepo(db).replace_for_round(round_id=round_three.id, rows=vla_papers, role="seed")
    ResearchRoundPaperRepo(db).replace_for_round(round_id=round_four.id, rows=generalization_papers, role="seed")

    for row in world_model_papers + vla_papers + generalization_papers:
        demo_meta = REAL_GPT_PAPERS[row.paper_id]
        ResearchPaperRepo(db).update_key_points(
            row,
            status="done",
            key_points=_structured_summary_text(demo_meta),
            source="demo_seed_real",
        )

    _prepare_task_assets(
        db,
        service=service,
        task=task,
        papers=[
            (world_model_papers[0], REAL_GPT_PAPERS["paper:gpt:wm-core"]),
            (world_model_papers[1], REAL_GPT_PAPERS["paper:gpt:wm-memory"]),
            (vla_papers[0], REAL_GPT_PAPERS["paper:gpt:vla-bridge"]),
            (vla_papers[1], REAL_GPT_PAPERS["paper:gpt:vla-efficient"]),
            (generalization_papers[0], REAL_GPT_PAPERS["paper:gpt:sim2real-safe"]),
            (generalization_papers[1], REAL_GPT_PAPERS["paper:gpt:generalization"]),
        ],
        artifact_root=artifact_root,
        save_root=save_root,
    )

    export_dir = artifact_root / task.task_id
    report_path = export_dir / "gpt-step-report.md"
    json_path = export_dir / "papers.json"
    csljson_path = export_dir / "papers.csljson"
    export_dir.mkdir(parents=True, exist_ok=True)
    report_path.write_text(_gpt_report_markdown(), encoding="utf-8")
    json_path.write_text(
        orjson.dumps(
            {
                "task_id": task.task_id,
                "topic": task.topic,
                "papers": [_paper_payload(REAL_GPT_PAPERS[key]) for key in REAL_GPT_PAPERS],
            },
            option=orjson.OPT_INDENT_2,
        ).decode("utf-8"),
        encoding="utf-8",
    )
    csljson_path.write_text(orjson.dumps(_csljson_items(list(REAL_GPT_PAPERS.values())), option=orjson.OPT_INDENT_2).decode("utf-8"), encoding="utf-8")
    ResearchExportRecordRepo(db).create(task_id=task.id, project_id=task.project_id, fmt="md", output_path=str(report_path), status="success")
    ResearchExportRecordRepo(db).create(task_id=task.id, project_id=task.project_id, fmt="json", output_path=str(json_path), status="success")
    ResearchExportRecordRepo(db).create(task_id=task.id, project_id=task.project_id, fmt="csljson", output_path=str(csljson_path), status="success")

    compare_row = ResearchCompareReportRepo(db).create(
        report_id="compare-demo-embodied-gpt",
        project_id=task.project_id,
        task_id=task.id,
        collection_id=None,
        scope="task_papers",
        title="DayDreamer vs RT-2 vs OpenVLA：具身智能主线对比",
        focus="world model, VLA, and adaptation efficiency",
        overview="DayDreamer 证明世界模型可以直接服务真实机器人学习；RT-2 展示互联网语义知识如何迁移到机器人动作；OpenVLA 则把这条路线开源化并显著降低了微调门槛。",
        common_points=[
            "三条路线都依赖大规模多模态数据，但关注的收益点不同：规划、语义泛化、适配效率。",
            "都把“单任务单模型”推进为“可迁移底座”，只是桥接层和训练目标不同。",
        ],
        differences=[
            "DayDreamer 更偏状态建模和想象规划，适合解释样本效率为什么会提升。",
            "RT-2 更偏语义推理和端到端控制接口，把 web knowledge 直接带进机器人动作。",
            "OpenVLA 更偏工程可复现与开源适配，是工作台落地和后续微调最实用的起点。",
        ],
        recommended_next_steps=[
            "从 collection 派生 study task，继续追踪 OpenVLA-OFT、Octo 等适配与泛化论文。",
            "把世界模型路线和 VLA 路线分别做成两条可演示分支，便于现场讲解对比。",
        ],
        items=[
            _compare_item(world_model_papers[0]),
            _compare_item(vla_papers[0]),
            _compare_item(vla_papers[1]),
            _compare_item(generalization_papers[0]),
        ],
    )

    _create_gpt_step_events(
        db,
        task=task,
        steps=[
            ("task_created", "任务已创建", "已初始化围绕具身智能主线的 GPT Step demo。", "done", {"project": DEMO_PROJECT_KEY}),
            ("plan_completed", "方向规划完成", "已经固定三条主线：世界模型、VLA、跨平台数据与适配效率。", "done", {"directions": 3}),
            ("search_completed", "论文准备完成", "当前工作区已放入真实论文，并写入结构化摘要、资产与导出记录。", "done", {"papers": 6}),
            ("exploration_started", "探索轮次已创建", "世界模型主分支已经展开，并保留了继续深入的第二轮。", "done", {"round_id": round_one.id}),
            ("candidates_generated", "候选方向已生成", "第 2 轮候选聚焦显式数字孪生与 latent world model 的对比。", "done", {"candidate_count": 2}),
            ("candidate_selected", "候选方向已选中", "已选中“显式数字孪生与 latent world model 的分工”。", "done", {"selected_candidate_id": candidates[0].id}),
            ("next_round_created", "下一轮已创建", "世界模型分支进入第 2 轮，同时 VLA 和泛化分支也已经挂上真实论文。", "done", {"round_id": round_two.id}),
            ("branch_sync_completed", "三条研究分支已补齐", "世界模型、VLA、跨平台数据与泛化三条线现在都各自挂上了真实论文和结构化摘要。", "done", {"round_ids": [round_one.id, round_two.id, round_three.id, round_four.id]}),
            ("fulltext_completed", "全文资产已准备", "世界模型、VLA 和跨平台泛化分支上的可见论文都已经准备好 PDF、全文和导出资产。", "done", {"parsed": 6}),
            ("paper_summary_completed", "结构化摘要已准备", "论文卡片与右侧详情都会展示结构化摘要，而不是一句话占位。", "done", {"paper_count": 6}),
        ],
    )

    citation_nodes = [
        {"id": f"topic:{task.task_id}", "type": "topic", "label": task.topic},
        {"id": "paper:gpt:wm-core", "type": "paper", "label": REAL_GPT_PAPERS["paper:gpt:wm-core"].title},
        {"id": "paper:gpt:vla-bridge", "type": "paper", "label": REAL_GPT_PAPERS["paper:gpt:vla-bridge"].title},
        {"id": "paper:gpt:vla-efficient", "type": "paper", "label": REAL_GPT_PAPERS["paper:gpt:vla-efficient"].title},
        {"id": "paper:gpt:generalization", "type": "paper", "label": REAL_GPT_PAPERS["paper:gpt:generalization"].title},
    ]
    citation_edges = [
        {"source": f"topic:{task.task_id}", "target": "paper:gpt:wm-core", "type": "seed"},
        {"source": f"topic:{task.task_id}", "target": "paper:gpt:vla-bridge", "type": "seed"},
        {"source": "paper:gpt:vla-bridge", "target": "paper:gpt:vla-efficient", "type": "related"},
        {"source": "paper:gpt:vla-efficient", "target": "paper:gpt:generalization", "type": "extends"},
    ]
    ResearchGraphSnapshotRepo(db).upsert_snapshot(
        task_id=task.id,
        direction_index=None,
        round_id=round_two.id,
        view_type=ResearchGraphViewType.CITATION.value,
        depth=2,
        nodes=citation_nodes,
        edges=citation_edges,
        stats={"node_count": len(citation_nodes), "edge_count": len(citation_edges), "source": "demo_seed_real"},
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
    _upsert_canvas_nodes(
        state,
        [
            {
                "id": "report:demo:gpt-compare",
                "type": "report",
                "position": {"x": 0, "y": 0},
                "data": {
                    "id": "report:demo:gpt-compare",
                    "type": "report",
                    "label": compare_row.title,
                    "summary": compare_row.overview,
                    "userNote": "这个报告节点用来直接展示 compare 结果，适合现场从三条研究支路切回统一比较结论。",
                },
                "hidden": False,
            },
            {
                "id": "note:demo:gpt-next-step",
                "type": "note",
                "position": {"x": 0, "y": 0},
                "data": {
                    "id": "note:demo:gpt-next-step",
                    "type": "note",
                    "label": "讲解顺序建议",
                    "summary": "先讲世界模型分支，再切到 VLA 分支，最后用跨平台数据与泛化分支解释为什么 collection 适合继续派生研究。",
                },
                "hidden": False,
            },
            {
                "id": "question:demo:gpt-follow-up",
                "type": "question",
                "position": {"x": 0, "y": 0},
                "data": {
                    "id": "question:demo:gpt-follow-up",
                    "type": "question",
                    "label": "下一步值得追哪条线？",
                    "summary": "可从 compare 报告继续派生一条新 study task，专门比较世界模型与 VLA 在数据效率、部署门槛和泛化能力上的分工。",
                },
                "hidden": False,
            },
        ],
    )
    _upsert_canvas_edges(
        state,
        [
            {
                "id": "manual:gpt:compare-link-wm",
                "source": "paper:gpt:wm-core",
                "target": "report:demo:gpt-compare",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "compare result"},
                "hidden": False,
            },
            {
                "id": "manual:gpt:compare-link-vla",
                "source": "paper:gpt:vla-bridge",
                "target": "report:demo:gpt-compare",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "compare result"},
                "hidden": False,
            },
            {
                "id": "manual:gpt:compare-link-openx",
                "source": "paper:gpt:sim2real-safe",
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
            {
                "id": "manual:gpt:follow-up-link",
                "source": "report:demo:gpt-compare",
                "target": "question:demo:gpt-follow-up",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "next study"},
                "hidden": False,
            },
        ],
    )
    _apply_canvas_positions(
        state,
        {
            f"topic:{task.task_id}": (120, 360),
            f"direction:{task.task_id}:1": (470, 70),
            f"direction:{task.task_id}:2": (470, 370),
            f"direction:{task.task_id}:3": (470, 670),
            f"round:{round_one.id}": (880, 60),
            f"round:{round_two.id}": (1270, 60),
            f"round:{round_three.id}": (880, 350),
            f"round:{round_four.id}": (880, 650),
            "paper:gpt:wm-core": (1260, 250),
            "paper:gpt:wm-memory": (1650, 140),
            "paper:gpt:vla-bridge": (1260, 350),
            "paper:gpt:vla-efficient": (1260, 560),
            "paper:gpt:sim2real-safe": (1260, 760),
            "paper:gpt:generalization": (1650, 760),
            "report:demo:gpt-compare": (2010, 250),
            "note:demo:gpt-next-step": (2010, 480),
            "question:demo:gpt-follow-up": (2010, 700),
        },
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
    save_root: Path,
    project_root: Path,
) -> None:
    directions = ResearchDirectionRepo(db).replace_for_task(
        task,
        [
            {
                "name": "foundation policy 与开放底座",
                "queries": ["robotics transformer generalist robot policy", "foundation robot policy open source"],
                "exclude_terms": [],
            },
            {
                "name": "VLA 适配与阶段性证据补强",
                "queries": ["OpenVLA fine tuning adaptation", "vision language action fine tuning benchmark"],
                "exclude_terms": [],
            },
        ],
    )
    paper_repo = ResearchPaperRepo(db)
    auto_papers = paper_repo.replace_direction_papers(
        directions[0],
        [_paper_payload(REAL_AUTO_PAPERS["paper:auto:planner"]), _paper_payload(REAL_AUTO_PAPERS["paper:auto:bench"])],
    )
    bridge_papers = paper_repo.replace_direction_papers(
        directions[1],
        [_paper_payload(REAL_AUTO_PAPERS["paper:auto:evidence"])],
    )
    for direction, papers in zip(directions, [auto_papers, bridge_papers], strict=True):
        ResearchDirectionRepo(db).update_papers_count(direction, len(papers))

    for row in auto_papers + bridge_papers:
        demo_meta = REAL_AUTO_PAPERS[row.paper_id]
        ResearchPaperRepo(db).update_key_points(
            row,
            status="done",
            key_points=_structured_summary_text(demo_meta),
            source="demo_seed_real",
        )

    _prepare_task_assets(
        db,
        service=service,
        task=task,
        papers=[
            (auto_papers[0], REAL_AUTO_PAPERS["paper:auto:planner"]),
            (auto_papers[1], REAL_AUTO_PAPERS["paper:auto:bench"]),
            (bridge_papers[0], REAL_AUTO_PAPERS["paper:auto:evidence"]),
        ],
        artifact_root=artifact_root,
        save_root=save_root,
    )
    fulltext_map = {
        row.paper_id: row
        for row in ResearchPaperFulltextRepo(db).list_for_task(task.id)
        if row.paper_id
    }

    artifact_dir = artifact_root / task.task_id / "runs" / DEMO_AUTO_RUN_ID
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_file = artifact_dir / "stage_report.md"
    artifact_file.write_text(_auto_stage_report_markdown(), encoding="utf-8")
    artifact_path = artifact_file.relative_to(project_root).as_posix()

    exports_dir = artifact_root / task.task_id
    exports_dir.mkdir(parents=True, exist_ok=True)
    auto_export = exports_dir / "auto-report.md"
    auto_export.write_text(_auto_export_markdown(), encoding="utf-8")
    ResearchExportRecordRepo(db).create(task_id=task.id, project_id=task.project_id, fmt="md", output_path=str(auto_export), status="success")

    event_repo = ResearchRunEventRepo(db)
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.PROGRESS,
        payload={"message": "auto research started", "phase": "stage_1", "title": "阶段 1：整理 foundation policy 证据"},
        seq=1,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.NODE_UPSERT,
        payload={
            "id": "direction:auto:stage-1",
            "type": "direction",
            "label": "从 RT-1 到 Open X 的基础证据链",
            "summary": "先明确通用机器人策略底座，再补齐跨平台数据和适配证据。",
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
        payload={"source": f"topic:{task.task_id}", "target": auto_papers[0].paper_id, "type": "seed", "weight": 1},
        seq=4,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.CHECKPOINT,
        payload={
            "checkpoint_id": "cp-embodied-stage-1",
            "title": "Stage 1 checkpoint: foundation policy 证据链已成型",
            "summary": "当前已经串起 RT-1、Open X-Embodiment 和 OpenVLA-OFT 三个层级：底座、数据、适配。下一步适合补强真实部署与效率证据。",
            "suggested_next_steps": ["查看 OpenVLA-OFT 的 PDF 与摘要", "把适配路线和 GPT Step 里的 OpenVLA 对上", "整理 collection compare 讲解顺序"],
            "graph_delta_summary": "新增 2 个系统方向节点、3 篇真实论文节点和 3 条主线连接。",
            "report_excerpt": "OpenClaw 将具身智能的自治调研压缩成一条可讲清楚的证据链：从底座到数据，再到部署适配。",
        },
        seq=5,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.PROGRESS,
        payload={
            "kind": "user_guidance",
            "text": "继续补强适配效率与部署收益，优先解释为什么 OpenVLA-OFT 是 demo 里最适合继续展开的节点。",
            "tags": ["demo", "guidance"],
            "message": "guidance received",
            "phase": "stage_2",
            "title": "收到用户引导",
        },
        seq=6,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.REPORT_CHUNK,
        payload={
            "title": "Stage 2 report",
            "summary": "第二阶段把 OpenVLA-OFT 补进来之后，这条证据链从“能学”延伸到了“能高效调优并上线”。",
            "content": "现场展示时可以先看 RT-1 的底座定位，再切到 Open X 的数据规模，最后用 OpenVLA-OFT 说明为什么部署阶段不能忽略适配配方。",
            "report_excerpt": "阶段 2 明确了具身智能工作台里最值得继续追踪的落地节点：高效微调。",
        },
        seq=7,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.ARTIFACT,
        payload={"kind": "stage_report", "title": "Embodied AI stage report", "path": artifact_path},
        seq=8,
    )
    event_repo.create_event(
        task_id=task.id,
        run_id=DEMO_AUTO_RUN_ID,
        event_type=ResearchRunEventType.PROGRESS,
        payload={"message": "auto research completed", "phase": "complete", "status": ResearchAutoStatus.COMPLETED.value, "title": "自动研究已完成"},
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
            {"id": auto_papers[1].paper_id, "type": "paper", "label": auto_papers[1].title},
            {"id": bridge_papers[0].paper_id, "type": "paper", "label": bridge_papers[0].title},
        ],
        edges=[
            {"source": f"topic:{task.task_id}", "target": auto_papers[0].paper_id, "type": "seed"},
            {"source": auto_papers[0].paper_id, "target": auto_papers[1].paper_id, "type": "supports"},
            {"source": auto_papers[1].paper_id, "target": bridge_papers[0].paper_id, "type": "extends"},
        ],
        stats={"node_count": 4, "edge_count": 3, "source": "demo_seed_real"},
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
    planner_node = service._paper_graph_node(
        task=task,
        paper=auto_papers[0],
        direction_index=1,
        fulltext=fulltext_map.get(auto_papers[0].paper_id),
    )
    benchmark_node = service._paper_graph_node(
        task=task,
        paper=auto_papers[1],
        direction_index=1,
        fulltext=fulltext_map.get(auto_papers[1].paper_id),
    )
    evidence_node = service._paper_graph_node(
        task=task,
        paper=bridge_papers[0],
        direction_index=2,
        fulltext=fulltext_map.get(bridge_papers[0].paper_id),
    )
    state = service._default_canvas_from_graph(task_id=task.task_id, graph=graph)
    _upsert_canvas_nodes(
        state,
        [
            {"id": planner_node["id"], "type": "paper", "position": {"x": 0, "y": 0}, "data": planner_node, "hidden": False},
            {"id": benchmark_node["id"], "type": "paper", "position": {"x": 0, "y": 0}, "data": benchmark_node, "hidden": False},
            {"id": evidence_node["id"], "type": "paper", "position": {"x": 0, "y": 0}, "data": evidence_node, "hidden": False},
            {
                "id": "checkpoint:demo:auto-stage-1",
                "type": "checkpoint",
                "position": {"x": 0, "y": 0},
                "data": {
                    "id": "checkpoint:demo:auto-stage-1",
                    "type": "checkpoint",
                    "label": "Stage 1 checkpoint",
                    "summary": "底座、数据和适配三类证据已经串起来，右侧时间线可以继续展示 guidance 历史与阶段报告。",
                },
                "hidden": False,
            },
            {
                "id": "report:demo:auto-stage",
                "type": "report",
                "position": {"x": 0, "y": 0},
                "data": {
                    "id": "report:demo:auto-stage",
                    "type": "report",
                    "label": "阶段报告",
                    "summary": "OpenClaw Auto 更适合拿来展示阶段推进、checkpoint 引导、guidance 历史与 artifact 产出。",
                },
                "hidden": False,
            },
            {
                "id": "note:demo:auto-walkthrough",
                "type": "note",
                "position": {"x": 0, "y": 0},
                "data": {
                    "id": "note:demo:auto-walkthrough",
                    "type": "note",
                    "label": "现场讲解建议",
                    "summary": "先看 RT-1 的底座定位，再切到 Open X 的数据支撑，最后用 OpenVLA-OFT 解释为什么部署阶段还需要专门的适配配方。",
                },
                "hidden": False,
            },
        ],
    )
    _upsert_canvas_edges(
        state,
        [
            {
                "id": "manual:auto:direction1-planner",
                "source": f"direction:{task.task_id}:1",
                "target": planner_node["id"],
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "foundation"},
                "hidden": False,
            },
            {
                "id": "manual:auto:direction1-bench",
                "source": f"direction:{task.task_id}:1",
                "target": benchmark_node["id"],
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "dataset"},
                "hidden": False,
            },
            {
                "id": "manual:auto:direction2-evidence",
                "source": f"direction:{task.task_id}:2",
                "target": evidence_node["id"],
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "adaptation"},
                "hidden": False,
            },
            {
                "id": "manual:auto:planner-bench",
                "source": planner_node["id"],
                "target": benchmark_node["id"],
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "evidence chain"},
                "hidden": False,
            },
            {
                "id": "manual:auto:bench-evidence",
                "source": benchmark_node["id"],
                "target": evidence_node["id"],
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "extends"},
                "hidden": False,
            },
            {
                "id": "manual:auto:checkpoint-link",
                "source": evidence_node["id"],
                "target": "checkpoint:demo:auto-stage-1",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "checkpoint"},
                "hidden": False,
            },
            {
                "id": "manual:auto:report-link",
                "source": "checkpoint:demo:auto-stage-1",
                "target": "report:demo:auto-stage",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "stage report"},
                "hidden": False,
            },
            {
                "id": "manual:auto:note-link",
                "source": "report:demo:auto-stage",
                "target": "note:demo:auto-walkthrough",
                "type": "smoothstep",
                "data": {"kind": "manual", "label": "walkthrough"},
                "hidden": False,
            },
        ],
    )
    _apply_canvas_positions(
        state,
        {
            f"topic:{task.task_id}": (120, 360),
            f"direction:{task.task_id}:1": (470, 180),
            f"direction:{task.task_id}:2": (470, 560),
            planner_node["id"]: (930, 120),
            benchmark_node["id"]: (1340, 200),
            evidence_node["id"]: (930, 560),
            "checkpoint:demo:auto-stage-1": (1760, 250),
            "report:demo:auto-stage": (2140, 250),
            "note:demo:auto-walkthrough": (2140, 520),
        },
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
    artifact_root: Path,
) -> None:
    paper_repo = ResearchPaperRepo(db)
    item_repo = ResearchCollectionItemRepo(db)
    selected_papers = [
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:wm-core"),
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:wm-memory"),
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:vla-bridge"),
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:vla-efficient"),
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:sim2real-safe"),
        paper_repo.get_by_token(gpt_task.id, "paper:gpt:generalization"),
        paper_repo.get_by_token(auto_task.id, "paper:auto:planner"),
        paper_repo.get_by_token(auto_task.id, "paper:auto:bench"),
        paper_repo.get_by_token(auto_task.id, "paper:auto:evidence"),
    ]
    task_token_by_db_id = {gpt_task.id: gpt_task.task_id, auto_task.id: auto_task.task_id}
    now = datetime.now(timezone.utc)
    for paper in [row for row in selected_papers if row is not None]:
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
                    {
                        "demo": True,
                        "task_id": task_token_by_db_id.get(paper.task_id),
                        "abstract": paper.abstract,
                        "summary_source": paper.key_points_source,
                    }
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
        focus="world model vs VLA vs adaptation evidence",
        overview="这个 collection 把世界模型、foundation policy、VLA 和高效适配四条证据线压缩到了一个可复用集合里，非常适合现场继续派生 study task。",
        common_points=[
            "都在试图把具身智能从单任务系统推进到可迁移、可扩展的底座。",
            "都说明数据规模、模型接口和部署适配三者必须一起考虑，不能只盯单一指标。",
        ],
        differences=[
            "DayDreamer 强调想象规划与样本效率。",
            "RT-2 强调互联网语义知识如何进入动作控制。",
            "RT-1 更像统一策略底座，OpenVLA-OFT 更像部署适配路线。",
        ],
        recommended_next_steps=[
            "基于这个 collection 派生新的 study task，专门比较 world model 路线和 VLA 路线。",
            "把 collection compare 结果保存成 report 节点，作为现场讲解主线。",
        ],
        items=[
            {"paper_id": "paper:gpt:wm-core", "title": REAL_GPT_PAPERS["paper:gpt:wm-core"].title},
            {"paper_id": "paper:gpt:vla-bridge", "title": REAL_GPT_PAPERS["paper:gpt:vla-bridge"].title},
            {"paper_id": "paper:auto:planner", "title": REAL_AUTO_PAPERS["paper:auto:planner"].title},
            {"paper_id": "paper:auto:evidence", "title": REAL_AUTO_PAPERS["paper:auto:evidence"].title},
        ],
    )

    export_dir = artifact_root / "collections" / collection.collection_id
    export_dir.mkdir(parents=True, exist_ok=True)
    bib_path = export_dir / "collection.bib"
    csljson_path = export_dir / "collection.csljson"
    collection_papers = [
        REAL_GPT_PAPERS["paper:gpt:wm-core"],
        REAL_GPT_PAPERS["paper:gpt:wm-memory"],
        REAL_GPT_PAPERS["paper:gpt:vla-bridge"],
        REAL_GPT_PAPERS["paper:gpt:vla-efficient"],
        REAL_GPT_PAPERS["paper:gpt:sim2real-safe"],
        REAL_GPT_PAPERS["paper:gpt:generalization"],
        REAL_AUTO_PAPERS["paper:auto:planner"],
        REAL_AUTO_PAPERS["paper:auto:bench"],
        REAL_AUTO_PAPERS["paper:auto:evidence"],
    ]
    bib_path.write_text(_bibtex_for_papers(collection_papers), encoding="utf-8")
    csljson_path.write_text(orjson.dumps(_csljson_items(collection_papers), option=orjson.OPT_INDENT_2).decode("utf-8"), encoding="utf-8")
    ResearchCollectionExportRecordRepo(db).create(collection_id=collection.id, fmt="bib", output_path=str(bib_path), status="success")
    ResearchCollectionExportRecordRepo(db).create(collection_id=collection.id, fmt="csljson", output_path=str(csljson_path), status="success")

    collection.summary_text = "这组论文共同构成了一个完整的具身智能演示主线：先看世界模型和基础策略，再看 VLA 如何扩展语义能力，最后补上高效适配与部署证据。"
    collection.updated_at = now
    db.add(collection)
    db.flush()


def _prepare_task_assets(
    db: Session,
    *,
    service: ResearchService,
    task: ResearchTask,
    papers: list[tuple[ResearchPaper, DemoPaper]],
    artifact_root: Path,
    save_root: Path,
) -> None:
    fulltext_repo = ResearchPaperFulltextRepo(db)
    paper_repo = ResearchPaperRepo(db)
    for row, meta in papers:
        bundle = _ensure_cached_assets(task=task, demo_paper=meta, artifact_root=artifact_root, save_root=save_root)
        fulltext_row = fulltext_repo.upsert(
            task_id=task.id,
            paper_id=row.paper_id,
            source_url=meta.abs_url,
            status=ResearchPaperFulltextStatus.PARSED.value,
            pdf_path=str(bundle["pdf_path"]),
            text_path=str(bundle["txt_path"]),
            text_chars=len(bundle["txt_text"]),
            parser=bundle["parser"],
            quality_score=bundle["quality_score"],
            sections_json=orjson.dumps({"source": "real_pdf_cache", "arxiv_id": meta.arxiv_id}).decode("utf-8"),
            parsed_at=datetime.now(timezone.utc) - timedelta(hours=2),
            fetched_at=datetime.now(timezone.utc) - timedelta(hours=2, minutes=10),
        )
        paper_repo.mark_saved(row, md_path=str(bundle["md_path"]), bib_path=str(bundle["bib_path"]))
        service._safe_build_paper_visual_assets(task=task, paper=row, fulltext=fulltext_row)


def _ensure_cached_assets(*, task: ResearchTask, demo_paper: DemoPaper, artifact_root: Path, save_root: Path) -> dict:
    fulltext_dir = artifact_root / task.task_id / "fulltext"
    fulltext_dir.mkdir(parents=True, exist_ok=True)
    saved_dir = save_root / task.task_id
    saved_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = artifact_root.parent / "demo" / "real_assets" / demo_paper.token.replace(":", "_")
    cache_dir.mkdir(parents=True, exist_ok=True)

    pdf_path = fulltext_dir / f"{demo_paper.token.replace(':', '_')}.pdf"
    txt_path = fulltext_dir / f"{demo_paper.token.replace(':', '_')}.txt"
    md_path = saved_dir / f"{demo_paper.token.replace(':', '_')}.md"
    bib_path = saved_dir / f"{demo_paper.token.replace(':', '_')}.bib"
    cache_pdf = cache_dir / pdf_path.name

    if not pdf_path.exists():
        if cache_pdf.exists():
            shutil.copy2(cache_pdf, pdf_path)
        else:
            data = _download_pdf_bytes(demo_paper)
            if data is not None:
                cache_pdf.write_bytes(data)
                pdf_path.write_bytes(data)
    if not pdf_path.exists():
        pdf_path.write_bytes(_fallback_pdf_bytes(demo_paper.title))

    txt_text, parser = _extract_pdf_text(pdf_path)
    if not txt_text.strip():
        txt_text = f"{demo_paper.title}\n\nAbstract\n{demo_paper.abstract}\n"
        parser = "abstract_fallback"
    txt_path.write_text(txt_text, encoding="utf-8")
    md_path.write_text(_paper_markdown(demo_paper), encoding="utf-8")
    bib_path.write_text(_paper_bibtex(demo_paper), encoding="utf-8")

    return {
        "pdf_path": pdf_path,
        "txt_path": txt_path,
        "md_path": md_path,
        "bib_path": bib_path,
        "txt_text": txt_text,
        "parser": parser,
        "quality_score": 0.92 if parser == "pymupdf" else 0.55,
    }


def _download_pdf_bytes(demo_paper: DemoPaper) -> bytes | None:
    candidates = [
        demo_paper.pdf_url,
        f"https://export.arxiv.org/pdf/{demo_paper.arxiv_id}.pdf",
    ]
    for url in candidates:
        try:
            request = Request(url, headers={"User-Agent": "OpenClawResearchDemo/1.0"})
            with urlopen(request, timeout=60) as response:
                data = response.read()
            if data.startswith(b"%PDF"):
                return data
        except (OSError, URLError):
            continue
    return None


def _extract_pdf_text(pdf_path: Path) -> tuple[str, str]:
    try:
        import fitz
    except Exception:
        return "", "fitz_unavailable"
    try:
        doc = fitz.open(pdf_path)
        texts = []
        for page in doc:
            chunk = page.get_text("text") or ""
            if chunk.strip():
                texts.append(chunk.strip())
        doc.close()
        return "\n\n".join(texts), "pymupdf"
    except Exception:
        return "", "pymupdf_failed"


def _create_gpt_step_events(
    db: Session,
    *,
    task: ResearchTask,
    steps: list[tuple[str, str, str, str, dict]],
) -> None:
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


def _paper_payload(paper: DemoPaper) -> dict:
    return {
        "paper_id": paper.token,
        "title": paper.title,
        "title_norm": _normalize_title(paper.title),
        "authors": list(paper.authors),
        "year": paper.year,
        "venue": paper.venue,
        "doi": paper.doi,
        "url": paper.abs_url,
        "abstract": paper.abstract,
        "method_summary": paper.method_summary,
        "source": paper.source,
    }


def _seed_from_paper(paper: ResearchPaper) -> dict:
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


def _compare_item(paper: ResearchPaper) -> dict:
    return {
        "paper_id": paper.paper_id,
        "title": paper.title,
        "year": paper.year,
        "venue": paper.venue,
        "source": paper.source,
    }


def _normalize_title(title: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in title).split())[:512]


def _structured_summary_text(paper: DemoPaper) -> str:
    order = [
        "研究问题",
        "核心方法",
        "数据与实验",
        "关键结果/证据",
        "局限与风险",
        "对当前研究任务的启发/下一步建议",
    ]
    return "\n".join(f"{name}：{paper.structured_sections[name]}" for name in order)


def _paper_markdown(paper: DemoPaper) -> str:
    return "\n".join(
        [
            f"# {paper.title}",
            "",
            f"- arXiv: `{paper.arxiv_id}`",
            f"- 链接: {paper.abs_url}",
            f"- 作者: {', '.join(paper.authors)}",
            "",
            "## 卡片摘要",
            paper.method_summary,
            "",
            "## 结构化摘要",
            _structured_summary_text(paper),
            "",
            "## Abstract",
            paper.abstract,
            "",
        ]
    )


def _paper_bibtex(paper: DemoPaper) -> str:
    key = paper.token.replace(":", "_").replace("-", "_")
    author_text = " and ".join(paper.authors)
    return (
        f"@article{{{key},\n"
        f"  title = {{{paper.title}}},\n"
        f"  author = {{{author_text}}},\n"
        f"  year = {{{paper.year}}},\n"
        f"  journal = {{{paper.venue}}},\n"
        f"  url = {{{paper.abs_url}}}\n"
        f"}}\n"
    )


def _bibtex_for_papers(papers: list[DemoPaper]) -> str:
    return "\n".join(_paper_bibtex(paper).rstrip() for paper in papers) + "\n"


def _csljson_items(papers: list[DemoPaper]) -> list[dict]:
    items = []
    for paper in papers:
        items.append(
            {
                "id": paper.arxiv_id,
                "type": "article-journal",
                "title": paper.title,
                "author": [{"literal": author} for author in paper.authors],
                "container-title": paper.venue,
                "issued": {"date-parts": [[paper.year]]},
                "URL": paper.abs_url,
                "keyword": ["embodied-ai", "demo"],
                "abstract": paper.abstract,
            }
        )
    return items


def _gpt_report_markdown() -> str:
    return """# 具身智能 GPT Step Demo

## 主题
具身智能中的世界模型、视觉语言动作模型与数据效率

## 观察
- DayDreamer 说明世界模型可以直接在真实机器人上带来样本效率收益。
- RT-2 把互联网视觉语言知识迁移到了机器人控制，展示了语义泛化能力。
- OpenVLA 把 VLA 路线真正开源化，并把微调门槛降到工作台可讨论的范围。
- Open X-Embodiment 与 Octo 则回答了“跨平台数据和开放底座如何形成生态”的问题。

## 适合现场讲解的主线
1. 先看 DayDreamer 的 PDF 和结构化摘要，解释世界模型为什么重要。
2. 再切到 RT-2 / OpenVLA，对比 VLA 为什么更强调语义与接口统一。
3. 最后打开 compare 报告，讲清楚规划、VLA、适配效率三条路线的分工。
"""


def _auto_stage_report_markdown() -> str:
    return """# Embodied AI Stage Report

## Stage 1
- 用 RT-1 建立 foundation policy 的起点。
- 用 Open X-Embodiment 解释为什么跨平台数据是后续一切工作的基础。

## Stage 2
- 用 OpenVLA-OFT 补上“为什么部署阶段必须重视高效适配”的证据。
- 把这条线和 GPT Step 中的 OpenVLA 节点对齐，形成完整演示闭环。
"""


def _auto_export_markdown() -> str:
    return """# OpenClaw Auto Demo Export

这个任务演示的是“阶段推进 + checkpoint + guidance + artifact”。

- Stage 1: foundation policy / dataset evidence
- Checkpoint: 进入等待用户引导
- Stage 2: VLA fine-tuning evidence
- Artifact: 输出可直接展示的阶段报告
"""


def _fallback_pdf_bytes(text: str) -> bytes:
    content = f"BT /F1 16 Tf 72 720 Td ({text[:120]}) Tj ET".encode("ascii", "replace")
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
