<div align="center">
  <img src="docs/design/logo.png" alt="ResearchMate logo" width="220" />

  # ResearchMate

  **A local research workbench for papers - built for continuous exploration, not one-shot reports.**

  <p>
    English | <a href="./README.zh-CN.md">简体中文</a>
  </p>

  <p>
    <img alt="Local-first" src="https://img.shields.io/badge/local--first-WSL%20%2F%20Linux-0f766e?style=flat-square" />
    <img alt="Frontend" src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-2563eb?style=flat-square" />
    <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI%20%2B%20Worker-1d4ed8?style=flat-square" />
    <img alt="Modes" src="https://img.shields.io/badge/modes-GPT%20Step%20%2B%20OpenClaw%20Auto-0891b2?style=flat-square" />
  </p>
</div>

## Overview

`ResearchMate` is a **local, single-user research system** for paper exploration and literature workflows.

It is designed around one core idea:

> most AI research tools are good at generating a single result, but weak at **carrying research progress forward**

Instead of treating literature review as one prompt and one report, this project turns it into a **stateful workbench** with:

- `project` for long-running research themes
- `task` for concrete study flows
- `collection` for reusable paper sets
- `canvas` for the user's working view
- `run events` for process visibility
- `artifacts / exports / assets` for structured outputs

Current default runtime is `research_local` on `WSL / Linux VM`, with a React workbench, FastAPI backend, background worker, and optional OpenClaw gateway.

## Why This Exists

AI literature changes fast:

- new papers appear every day
- conference and journal submissions keep rising
- the same topic quickly branches into multiple lines
- traditional literature review burns time on repeated search, filtering, note taking, and re-organization

Existing tools already help, but most of them still look like:

- one request
- one run
- one result

If the user wants to continue later, change direction, branch into a subset of papers, or inherit previous progress, the workflow often resets.

This project focuses on the missing layer: **continuous research progression**.

## What Makes It Different

### 1. Continuous Research, Not Just One-Shot Reports

This system is built for **multi-step, long-running research**, not only "generate a report once".

You can:

- plan directions
- search one direction at a time
- continue an exploration branch
- compare selected papers
- build graph snapshots
- come back later and keep going

### 2. Two Research Modes in One System

#### `GPT Step`

Half-automatic, user-guided research.

- explicit step-by-step actions
- user decides what to do next
- suitable for careful, controlled exploration

#### `OpenClaw Auto`

Autonomous staged research.

- agent explores by itself
- syncs intermediate results back to the workbench
- pauses at `checkpoint`
- continues after user `guidance`

This gives the project both high user control and high agent autonomy.

### 3. A Real Workbench, Not Just a Chat Box

The current frontend is a three-pane research workspace:

- **left**: projects, tasks, collections, controls
- **center**: card-based research canvas
- **right**: detail panel, chat, run timeline, PDF / fulltext / assets

That makes it much closer to how real research work happens.

### 4. Canonical Graph and User Canvas Are Separated

This is one of the key architecture choices:

- `canonical graph` stores research structure
- `canvas state` stores user layout and working annotations

So the user can drag nodes, hide nodes, add notes, and reorganize the workspace without overwriting the system's research graph.

### 5. Works With Existing Research Ecosystems

The goal is not to replace every research tool.

The goal is to connect the missing workflow between **paper collection** and **research execution**.

Current integrations and sources include:

- Zotero local import / export
- Semantic Scholar
- arXiv
- OpenAlex
- Crossref

## Current Feature Set

### Research Organization

- top-level `project`
- research `task`
- reusable paper `collection`
- `collection -> study task` workflow

### GPT Step Flow

- create task
- plan directions
- search a direction
- start explore round
- generate candidates
- select candidates
- continue next round
- build graph
- process fulltext
- summarize paper
- export results

### OpenClaw Auto Flow

- start autonomous run
- sync progress / nodes / edges / papers
- pause at `checkpoint`
- submit `guidance`
- continue staged exploration
- view report chunks and artifacts

### Workbench UX

- full-screen React workbench
- collapsible left / right panels
- card-based node canvas
- node detail view
- markdown chat
- PDF / fulltext / asset panel
- run timeline
- canvas persistence

### Paper / Asset Layer

- PDF assets
- fulltext status
- export history
- `figure` asset for extracted main figure
- `visual` asset for fallback paper visual

## Demo

This repository already supports two demo modes.

### Static Demo

A fully prepared **Embodied AI** workspace for direct presentation.

It includes:

- one demo project
- one completed `GPT Step` task
- one completed `OpenClaw Auto` task
- one reusable collection
- compare / checkpoint / artifact / export examples
- real paper nodes and cached assets

### Live Demo

A sequential smoke showcase for real execution:

- `gpt_basic`
- `gpt_explore`
- `openclaw_auto`

### Demo Commands

```bash
bash scripts/run_demo_showcase_wsl.sh --mode static --json-out artifacts/demo/showcase-static.json
bash scripts/run_demo_showcase_wsl.sh --mode live --json-out artifacts/demo/showcase-live.json
bash scripts/run_demo_showcase_wsl.sh --mode all --json-out artifacts/demo/showcase-all.json
```

## Quick Start

### 1. Copy Environment File

```bash
cp .env.example .env
```

At minimum, check these values:

```env
APP_PROFILE=research_local
DB_URL=sqlite:///./data/memomate.db
RESEARCH_ENABLED=true
RESEARCH_QUEUE_MODE=worker
RESEARCH_ARTIFACT_DIR=./artifacts/research
RESEARCH_SAVE_BASE_DIR=./artifacts/research/saved
RESEARCH_GPT_API_KEY=...
RESEARCH_GPT_MODEL=gpt-5.4
```

If you want `OpenClaw Auto`, also configure:

```env
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=main
```

### 2. Install Research Runtime

```bash
python3 -m venv .venv-wsl
.venv-wsl/bin/python -m pip install -r requirements-research-local.txt
```

### 3. Start Backend and Worker

```bash
bash scripts/start_research_local_wsl.sh
```

Stop:

```bash
bash scripts/stop_research_local_wsl.sh
```

### 4. Start Frontend

```bash
bash scripts/install_frontend_node_wsl.sh
bash scripts/start_frontend_wsl.sh
```

Stop:

```bash
bash scripts/stop_frontend_wsl.sh
```

### 5. Start OpenClaw Gateway

```bash
bash scripts/start_openclaw_wsl.sh
```

Stop:

```bash
bash scripts/stop_openclaw_wsl.sh
```

### 6. Default Local URLs

- Frontend workbench: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8000`
- OpenClaw gateway: `http://127.0.0.1:18789`

## Validation and Smoke

### API Connectivity Check

```bash
bash scripts/run_api_connectivity_check_wsl.sh --iterations 10 --json-out artifacts/research-api-check/current.json
```

This is useful for verifying:

- workbench config
- project / collection APIs
- task APIs
- canvas read / write
- run events API
- Zotero config API

### Research Live Smoke

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all
```

Run two rounds for stability:

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario all --iterations 2
```

Run single scenarios:

```bash
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_basic
bash scripts/run_research_live_smoke_wsl.sh --scenario gpt_explore
bash scripts/run_research_live_smoke_wsl.sh --scenario openclaw_auto
```

## Typical Research Workflow

### GPT Step

1. Create a project
2. Create a `GPT Step` task
3. Plan directions
4. Search one direction
5. Start explore round
6. Generate and select candidates
7. Build graph
8. Process fulltext
9. Summarize selected papers
10. Export results

### OpenClaw Auto

1. Create a task in `OpenClaw Auto` mode
2. Start autonomous research
3. Wait for `checkpoint`
4. Submit `guidance`
5. Continue exploration
6. Inspect report chunks and artifacts

### Collection-Driven Workflow

1. Import papers into a collection
2. Review collection details
3. Compare or summarize the collection
4. Create a new `study task` from the collection
5. Continue exploration from the seed corpus

## Repository Structure

```text
app/                  FastAPI backend, domain logic, services, workers
frontend/             React + TypeScript workbench
docs/                 project docs, architecture, usage, roadmap, showcase material
scripts/              WSL startup, smoke, demo, packaging helpers
tests/                backend tests
artifacts/            research outputs, saved files, demo outputs
data/                 local SQLite database
output/               generated docs and deliverables
```

## Current Status

As of the current `research_local` mainline:

- backend + worker + frontend run in WSL
- local OpenClaw gateway can be started and used
- `GPT Step` main flow is connected
- `OpenClaw Auto` staged flow is connected
- project / collection / study task flow is available
- Zotero local import / export v1 is available
- static and live demo entry points are available

## Documentation

### Start Here

- [docs/RESEARCH_LOCAL_QUICKSTART.md](docs/RESEARCH_LOCAL_QUICKSTART.md)
  - setup, start / stop, smoke, demo commands
- [docs/RESEARCH_USAGE_ZH.md](docs/RESEARCH_USAGE_ZH.md)
  - user guide for project / task / collection / GPT Step / OpenClaw Auto / Zotero
- [docs/PROJECT_OVERVIEW_ZH.md](docs/PROJECT_OVERVIEW_ZH.md)
  - current project overview, architecture state, API and data model summary

### More Docs

- [docs/RESEARCH_ARCH.md](docs/RESEARCH_ARCH.md)
- [docs/DEMO_STEPS.md](docs/DEMO_STEPS.md)
- [docs/ROADMAP_ZH.md](docs/ROADMAP_ZH.md)
- [docs/PPT_SHOWCASE_ADVANTAGES_ZH.md](docs/PPT_SHOWCASE_ADVANTAGES_ZH.md)
- [docs/SHOWCASE_REPORT_DRAFT_ZH.md](docs/SHOWCASE_REPORT_DRAFT_ZH.md)
- [docs/README.md](docs/README.md)

## Design Notes

This README follows a common pattern used by many popular open-source repositories:

- strong hero section
- short "what it is / why it exists"
- highlights before implementation details
- quick start near the top
- clear docs index
- demo and validation entry points

That makes the repository easier to scan for both first-time visitors and presentation audiences.

## Roadmap Direction

Near-term improvement directions:

- continue refining the frontend workbench experience
- strengthen OpenClaw Auto stage handling and report organization
- improve collection compare and reusable research branches
- validate Docker Compose on a real Docker environment
- continue splitting heavy research service logic into clearer subdomains

## Notes

- `research_local` is the current default mainline.
- Legacy WeCom / reminder / mobile auth / admin paths are retained in code but **soft-disabled** from the default runtime.
- Research APIs in local mode do **not** require JWT.
- SQLite is the current default database. If higher concurrency becomes a priority, PostgreSQL should be the next step.
