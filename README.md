# QuackBoard

[![Live Demo](https://img.shields.io/badge/Live%20Demo-quackboard--rosy.vercel.app-2563EB?style=flat&logo=vercel)](https://quackboard-rosy.vercel.app)
[![CI](https://github.com/aymanmali/quackboard/actions/workflows/ci.yml/badge.svg)](https://github.com/aymanmali/quackboard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/aymanmali/quackboard?color=2563EB)](https://github.com/aymanmali/quackboard/releases)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-6366F1.svg)](./LICENSE)
[![DuckDB-Wasm](https://img.shields.io/badge/Engine-DuckDB--Wasm-F59E0B.svg)](https://duckdb.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000.svg)](https://nextjs.org/)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faymanmali%2Fquackboard)

**Try it live in your browser (zero signup):** https://quackboard-rosy.vercel.app

**QuackBoard** is an AI-powered, source-available (free for personal, educational & non-commercial use) Tableau-like Business Intelligence (BI) web platform built with **DuckDB-Wasm**, **Apache ECharts**, **Vercel AI SDK**, and **Next.js**.

Analyze local CSV, Parquet, Excel, and JSON files right inside your browser with zero setup—or connect live **PostgreSQL** and **MySQL** databases to build interactive, cross-filtered dashboards.

---

## What's New in v0.3.0 — Autonomous AI Data Analyst (`/agent`)

- **Hybrid Browser-Server ReAct Agent Loop:** Multi-step autonomous analyst (`<= 8` steps) via Vercel AI SDK v7 tools + client-side DuckDB-Wasm execution — keeping raw CSV/Parquet/Excel rows private inside the browser while sending only compact tool observations (<= 50 rows) to the planner.
- **6 Executable Agent Tools:** `inspect_schema`, `profile_column`, `run_sql_query`, `analyze_variance`, `create_chart`, and `create_dashboard`.
- **Automatic SQL Self-Repair:** If a query errors or hits a bad identifier/syntax, the agent reads the engine error message and rewrites & retries automatically inside the loop.
- **Human-in-the-Loop (HITL) Guardrails:** Toggle between **Auto-Approve Writes** and **Require Approval for Writes** before saving charts or assembling dashboards.
- **Live Transparent Agent Trace & Grounded Report:** Watch every reasoning step, SQL call, latency (`ms`), **Self-Healed** badge, inline ECharts visuals, and numerically grounded findings with citations.
- **Automated Vitest Agent Evals:** Evaluates multi-step tool sequencing, SQL self-repair, numeric grounding, and destructive SQL / HITL guardrails on every CI run.

## AI Suite (v0.2.0)

- **Ask QuackBoard AI (`/explore`):** Type plain-English analytics questions (e.g., *"Top 5 sub-categories by profit as horizontal bar"*) to automatically populate Chart Studio shelves, choose visualizations, and generate dialect-safe SQL.
- **1-Click AI Auto-Dashboard (`/` & `/sources`):** Select any dataset and optionally enter an analytical goal to automatically build KPI cards, trend lines, breakdowns, and global filter bars onto an interactive dashboard.
- **AI Executive Insights (`/explore` & `/dashboards/[id]`):** Click **Explain** or **AI Insights** to generate executive summaries, anomaly alerts, and clickable follow-up questions directly from query results.
- **AI SQL Copilot (`/sql`):** Generate read-only DuckDB / PostgreSQL / MySQL queries from plain English, plus a one-click **"Fix with AI"** button when a SQL error occurs.
- **Multi-Provider Vercel AI SDK + Zero-Key Local Fallback:** Supports **Google Gemini** (default), **OpenAI**, and **Anthropic** via server keys or browser Bring-Your-Own-Key (BYOK) in **AI Settings**, plus a deterministic zero-key local engine so every AI feature works out of the box.

## Core BI Features

- **Tableau-Style Chart Studio (`/explore`):** Drag-and-drop blue **Dimension** pills and green **Measure** pills onto Columns (X), Rows (Y), Color, and Filter shelves with aggregations (`SUM`, `AVG`, `COUNT`, `COUNTD`, `MIN`, `MAX`) and date bucketing (`Day` → `Year`).
- **9 Interactive Visualizations:** Auto-recommend, Bar, Stacked Bar, Horizontal Bar, Line, Area, Pie/Donut, Scatter, KPI Metric Cards, and sortable/filterable Data Tables (`@tanstack/react-table`).
- **Interactive Dashboards (`/dashboards/[id]`):** Drag-and-resize grid layout (`react-grid-layout`), global filter dropdowns, click-to-**cross-filter** across sibling charts, PNG/CSV export, and portable `.quackboard.json` import/export.
- **Hybrid Query Engine:**
  - **Local Mode (Browser — DuckDB-Wasm):** Instant analytical SQL over `.csv`, `.tsv`, `.parquet`, `.xlsx`, and `.json` files with zero server upload.
  - **Live SQL Mode (Server API):** Connect PostgreSQL & MySQL with AES-256-GCM encrypted credentials, parameterized dialect-aware SQL compilation, read-only transaction enforcement, and query timeouts.
- **Read-Only SQL Lab (`/sql`):** Write ad-hoc `SELECT` / `WITH` queries against any DuckDB-Wasm table or connected SQL database.
- **Zero-Config First Run:** Ships with a bundled **Global Superstore Sales** dataset and pre-built **Executive Sales Overview** dashboard using browser IndexedDB—no database required to try it.

---

## Quickstart

```bash
git clone https://github.com/aymanmali/quackboard.git
cd quackboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Self-Hosting with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

---

## Architecture

```text
Browser (Next.js App Router + React + Tailwind + ECharts)
 ├── Local Files (CSV / Parquet / Excel / JSON) ──► DuckDB-Wasm Web Worker
 ├── Zero-Config Storage                        ──► IndexedDB
 ├── Live SQL Datasets                          ──► Next.js API (/api/query)
 │                                                    ├── Safe Visual Query AST Compiler
 │                                                    ├── AES-256-GCM Secret Vault
 │                                                    └── PostgreSQL / MySQL (READ ONLY)
 └── AI Suite                                   ──► Next.js API (/api/ai/*)
                                                      ├── Vercel AI SDK (Gemini / OpenAI / Anthropic)
                                                      ├── BYOK Support + Rate Limiting
                                                      └── Zero-Key Local Analytical Fallback
```

---

## Development & Testing

```bash
npm run typecheck   # TypeScript strict check
npm run lint        # ESLint
npm test            # Vitest unit tests (SQL compiler, security, chart builder, AI fallback)
npm run build       # Production Next.js build
```

---

## Licensing

**QuackBoard v0.2.0+** is **source-available** under the **PolyForm Noncommercial License 1.0.0** — see [LICENSE](./LICENSE).

- **Free for personal, educational, academic, and non-profit use.**
- **Commercial use** (internal business use or hosted commercial offerings) requires a separate commercial license from the author.
