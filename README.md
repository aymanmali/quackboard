# QuackBoard

[![Live Demo](https://img.shields.io/badge/Live%20Demo-quackboard--rosy.vercel.app-2563EB?style=flat&logo=vercel)](https://quackboard-rosy.vercel.app)
[![CI](https://github.com/aymanmali/quackboard/actions/workflows/ci.yml/badge.svg)](https://github.com/aymanmali/quackboard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/aymanmali/quackboard?color=2563EB)](https://github.com/aymanmali/quackboard/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-10B981.svg)](./LICENSE)
[![DuckDB-Wasm](https://img.shields.io/badge/Engine-DuckDB--Wasm-F59E0B.svg)](https://duckdb.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000.svg)](https://nextjs.org/)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Faymanmali%2Fquackboard)

**Try it live in your browser (zero signup):** https://quackboard-rosy.vercel.app

**QuackBoard** is an open-source, Tableau-like Business Intelligence (BI) web platform powered by **DuckDB-Wasm**, **Apache ECharts**, and **Next.js**.

Analyze local CSV, Parquet, Excel, and JSON files right inside your browser with zero setup—or connect live **PostgreSQL** and **MySQL** databases to build interactive, cross-filtered dashboards.

---

## Features (v0.1)

- **Tableau-Style Chart Studio (`/explore`):** Drag-and-drop blue **Dimension** pills and green **Measure** pills onto Columns (X), Rows (Y), Color, and Filter shelves with aggregations (`SUM`, `AVG`, `COUNT`, `COUNTD`, `MIN`, `MAX`) and date bucketing (`Day` → `Year`).
- **9 Interactive Visualizations:** Auto-recommend, Bar, Stacked Bar, Horizontal Bar, Line, Area, Pie/Donut, Scatter, KPI Metric Cards, and sortable/filterable Data Tables (`@tanstack/react-table`).
- **Interactive Dashboards (`/dashboards/[id]`):** Drag-and-resize grid layout (`react-grid-layout`), global filter dropdowns, click-to-**cross-filter** across sibling charts, PNG/CSV export, and portable `.quackboard.json` import/export.
- **Hybrid Query Engine:**
  - **Local Mode (Browser — DuckDB-Wasm):** Instant analytical SQL over `.csv`, `.tsv`, `.parquet`, `.xlsx`, and `.json` files with zero server upload.
  - **Live SQL Mode (Server API):** Connect PostgreSQL & MySQL with AES-256-GCM encrypted credentials, parameterized dialect-aware SQL compilation, read-only transaction enforcement, and query timeouts.
- **Read-Only SQL Lab (`/sql`):** Write ad-hoc `SELECT` / `WITH` queries against any DuckDB-Wasm table or connected SQL database.
- **Zero-Config First Run:** Ships with a bundled **Global Superstore Sales** dataset and pre-built **Executive Sales Overview** dashboard using browser IndexedDB—no database required to try it.

---

## Architecture

```text
Browser (Next.js App Router + React + Tailwind + ECharts)
 ├── Local Files (CSV / Parquet / Excel / JSON) ──► DuckDB-Wasm Web Worker
 ├── Zero-Config Storage                        ──► IndexedDB
 └── Live SQL Datasets                          ──► Next.js API (/api/query)
                                                      ├── Safe Visual Query AST Compiler
                                                      ├── AES-256-GCM Secret Vault
                                                      └── PostgreSQL / MySQL (READ ONLY)
```

---

## Development & Testing

```bash
npm run typecheck   # TypeScript strict check
npm run lint        # ESLint
npm test            # Vitest unit tests (SQL compiler, security, chart builder)
npm run build       # Production Next.js build
```

---

## Roadmap

- **v0.2:** User authentication (GitHub / Email OAuth), team workspaces, and shareable read-only embed links
- **v0.3:** Calculated fields / custom metrics & semantic layer
- **v0.4:** Additional connectors (BigQuery, Snowflake, ClickHouse, REST APIs) & AI natural-language chart builder

## License

MIT — see [LICENSE](./LICENSE).
