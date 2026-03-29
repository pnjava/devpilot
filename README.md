# DevPilot – AI-Powered Delivery Intelligence, Grooming & PR Review

A unified platform combining **delivery health analytics** (PIDI) with **AI-powered grooming & PR review** (GroomPilot). Measures flow, quality, collaboration, traceability, and delivery risk — while enabling real-time story grooming, behavioral pattern analysis, and automated code review. Designed for delivery partners and engineering managers — **not** surveillance.

## Architecture

```
┌───────────────┐   ┌────────────────┐   ┌──────────────────┐
│  Next.js UI   │──▶│  NestJS API    │──▶│  PostgreSQL 16   │
│  (apps/web)   │   │  (apps/api)    │   │  via Prisma ORM  │
│  :3000        │   │  :3001         │   └──────────────────┘
└───────────────┘   └──────┬─────────┘            ▲
                           │                      │
┌───────────────┐   ┌──────┴─────────┐   ┌───────┴──────────┐
│  React+Vite   │──▶│  Express API   │──▶│  SQLite (legacy)  │
│  (groompilot  │   │  (groompilot)  │   │  → Prisma (new)   │
│  -web) :5173  │   │  :4000         │   └──────────────────┘
└───────────────┘   └──────┬─────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Jira/Bitbucket  AI Providers  Socket.io
         Confluence      (Ollama,      (real-time
                          OpenAI)       grooming)
```

### Monorepo layout

```
devpilot/
├── apps/
│   ├── api/              # NestJS REST API – delivery intelligence + bridge
│   │   └── src/
│   │       ├── api/           # Controllers (overview, teams, stories, people, repos, alerts, admin)
│   │       ├── bridge/        # ★ Bridge module (story↔grooming, review metrics, knowledge)
│   │       ├── integrations/  # Jira, Bitbucket, Wiki sync adapters
│   │       ├── traceability/  # Linking engine (branch→PR→commit→wiki→story)
│   │       ├── metrics/       # 35+ calculators + engine + narrative insights
│   │       └── prisma/        # PrismaService wrapper
│   ├── web/              # Next.js dashboard – delivery health + grooming nav
│   ├── groompilot/       # Express API – AI grooming, PR review, RCIE, BPE
│   │   └── src/
│   │       ├── routes/        # auth, groom, pr-review, repos, jira, knowledge, email
│   │       ├── services/      # ai-provider, grooming, BPE, RCIE, review engine
│   │       ├── db.ts          # SQLite (legacy – migrating to Prisma)
│   │       └── prisma-client.ts  # ★ Prisma adapter for new code
│   └── groompilot-web/   # React+Vite – grooming sessions, PR review UI
├── packages/
│   ├── shared/           # Domain types (delivery + grooming), metric catalog
│   ├── db/               # Prisma schema (55+ models), seed script
│   └── mcp-server/       # VS Code MCP server (12 tools: grooming + delivery)
├── docker-compose.yml    # PostgreSQL + Redis + MailHog
├── turbo.json         # Turborepo pipeline
└── .env.example       # Environment variables template
```

## Key Concepts

### Delivery Intelligence (PIDI)

| Concept | Description |
|---|---|
| **Canonical State** | Normalised status (TODO → RELEASED) mapped from external tools |
| **Readiness Score** | 0-100 score measuring how well-prepared a story is before development (10 weighted factors) |
| **Churn Score** | Measures scope changes (description/AC edits) after dev starts; late changes weigh more |
| **Traceability Coverage** | % of stories linked to branches, commits, PRs, wiki pages |
| **Delivery Health Index** | Weighted composite of readiness, traceability, review, quality, knowledge, flow |
| **Story Friction Score** | Weighted composite highlighting blocked time, churn, review delays per story |
| **Narrative Insights** | Deterministic rule-based insights (not AI-generated) surfacing risks and patterns |

### Grooming & Review (GroomPilot)

| Concept | Description |
|---|---|
| **Groom Session** | Real-time collaborative story grooming with AI assistance via Socket.io |
| **Behavioral Pattern Engine (BPE)** | Detects recurring PR signal patterns (e.g., repeated large diffs, missing tests) |
| **Repo Code Intelligence Engine (RCIE)** | Indexes codebases with tree-sitter AST parsing for dependency graphs and code intelligence |
| **PR Review** | AI-powered code review with configurable providers (Ollama, OpenAI, GitHub Models) |
| **Knowledge Base** | Syncs Confluence documents, facts, and images linked to Jira stories |
| **Review Suppression** | Tracks false-positive reviews, learning from developer feedback |

### Bridge (Cross-Feature)

| Concept | Description |
|---|---|
| **StoryGroomLink** | Connects PIDI Issue records to GroomPilot sessions with typed link (GROOMED_IN, REVIEWED_IN, REFERENCED_IN) |
| **Bridge Service** | Queries spanning both domains—review metrics by repo, knowledge lookup by story, code intelligence summaries |

## Metrics (35+)

Organized across 9 categories: **Readiness**, **Churn**, **Flow**, **Traceability**, **Execution**, **Quality**, **Knowledge**, **Discovery**, **Composite**. Full definitions in `packages/shared/src/constants/metric-catalog.ts`.

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Docker & Docker Compose
- npm ≥ 10

### 1. Clone & install

```bash
git clone <repo-url> devpilot
cd devpilot
cp .env.example .env
npm install
```

### 2. Start services

```bash
docker compose up -d   # PostgreSQL + Redis + MailHog
```

### 3. Set up database

```bash
npx turbo db:generate
cd packages/db
npx prisma db push
npx ts-node --esm seed.ts   # seed demo data
cd ../..
```

### 4. Run development servers

```bash
# All services at once
npm run dev

# Or individually
npm run dev:analytics    # NestJS API + Next.js dashboard
npm run dev:groompilot   # Express API + React UI
```

| Service | URL |
|---|---|
| Next.js Dashboard | http://localhost:3000 |
| NestJS API | http://localhost:3001/api |
| GroomPilot API | http://localhost:4000 |
| GroomPilot UI | http://localhost:5173 |
| MailHog (SMTP testing) | http://localhost:8025 |

### 5. Run tests

```bash
npm test
```

## API Endpoints

### Delivery Intelligence (NestJS — :3001)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/overview` | Cross-team health, insights, top risk stories |
| GET | `/api/teams` | List all teams |
| GET | `/api/teams/:id` | Team detail with metrics, aging stories, insights |
| GET | `/api/stories/:issueKey` | Story detail with timeline, linked artifacts, friction breakdown |
| GET | `/api/people/:id` | Person collaboration view (non-surveillance) |
| GET | `/api/repos` | List repositories |
| GET | `/api/repos/:id` | Repo detail with open PRs, stale branches |
| GET | `/api/alerts` | List alerts (optionally filtered by team) |
| PATCH | `/api/alerts/:id/acknowledge` | Acknowledge an alert |
| POST | `/api/integrations/sync` | Trigger sync for Jira/Bitbucket/Wiki |
| GET | `/api/integrations/status` | Integration connection and job status |
| POST | `/api/links/manual` | Create manual artifact link |
| DELETE | `/api/links/:id` | Remove an artifact link |
| GET | `/api/admin/settings` | Get/update org settings, mappings, thresholds, weights |

### Bridge (NestJS — :3001)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/bridge/stories/:issueKey/groom-sessions` | Groom sessions linked to a story |
| GET | `/api/bridge/repos/:repoSlug/review-metrics` | Review metrics for a repository |
| GET | `/api/bridge/stories/:issueKey/knowledge` | Knowledge documents linked to a story |
| GET | `/api/bridge/repos/:repoSlug/behavioral-patterns` | Active BPE patterns for a repo |
| GET | `/api/bridge/repos/:repoSlug/code-intelligence` | Code intelligence summary for a repo |

### Grooming & Review (Express — :4000)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/groom/sessions` | Create a grooming session |
| GET | `/api/groom/sessions/:id` | Get session details |
| POST | `/api/pr-review/run` | Trigger AI-powered PR review |
| GET | `/api/pr-review/runs/:id` | Get review results |
| GET | `/api/repos/:slug/code-intel` | RCIE code intelligence for a repo |
| GET | `/api/knowledge/stories/:key` | Knowledge docs for a Jira story |
| POST | `/api/email/send` | Send notifications via MailHog/SMTP |

## MCP Server (VS Code Integration)

The MCP server at `packages/mcp-server` exposes 12 tools for use in VS Code Copilot:

**Grooming tools**: `create_session`, `add_story`, `get_suggestions`, `run_review`, `get_bpe_signals`, `search_knowledge`

**Delivery Intelligence tools**: `get_delivery_overview`, `get_team_metrics`, `get_story_traceability`, `get_person_insights`, `get_review_metrics`, `get_story_knowledge`

## Mock vs Real Adapters

Set `USE_MOCK_ADAPTERS=true` in `.env` (default) to use in-memory demo data. Set to `false` and configure Jira/Bitbucket/Wiki credentials to sync from real tools. Both PIDI and GroomPilot share the same Jira/Bitbucket/Confluence credentials.

## Roles

| Role | Access |
|---|---|
| ADMIN | Full access, settings, integrations |
| DELIVERY_PARTNER | All dashboards, manual links, sync triggers |
| ENGINEERING_MANAGER | All dashboards, read-only settings |
| TEAM_LEAD | Team/story views, manual annotations |
| DEVELOPER | Story views, own-person view |

## Non-Surveillance Principles

- Person views show **collaboration contributions** (reviews, wiki edits, PR comments), not individual output rates
- No per-person velocity or commit count leaderboards
- Metrics focus on **process health**, not individual performance
- Manual annotations allow context that numbers miss

## Tech Stack

- **Delivery Frontend**: Next.js 14, React 18, TailwindCSS, Recharts, TanStack Query
- **Grooming Frontend**: React 18, Vite 6, React Router 7, Socket.io, TailwindCSS
- **Delivery Backend**: NestJS 10, Prisma ORM, class-validator
- **Grooming Backend**: Express 4.21, Socket.io 4.8, tree-sitter, AJV
- **AI Providers**: Ollama (primary), OpenAI, GitHub Models (fallback)
- **Database**: PostgreSQL 16 (Prisma) + SQLite (legacy, migrating)
- **Queue**: BullMQ + Redis 7
- **MCP**: @modelcontextprotocol/sdk 1.12
- **Monorepo**: npm workspaces + Turborepo 2.3
- **Testing**: Vitest

## License

Internal – Peer Islands AI
