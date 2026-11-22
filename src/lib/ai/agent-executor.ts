import { compileVisualQuery, quoteIdentifier } from "../query/compiler";
import {
  ChartType,
  Dashboard,
  DashboardGlobalFilter,
  DashboardTile,
  Dataset,
  DEFAULT_CHART_FORMATTING,
  NumberFormat,
  QueryResult,
  SavedChart,
  VisualQuery,
} from "../query/types";
import { validateReadOnlySql } from "../query/validator";
import { sanitizeVisualQuery } from "./sanitize";
import { AgentToolCall, AgentToolResult } from "./agent-types";
import {
  AnalyzeVarianceInput,
  CreateChartInput,
  CreateDashboardInput,
  InspectSchemaInput,
  ProfileColumnInput,
  RunSqlQueryInput,
} from "./agent-tool-schemas";

export interface AgentExecutorDeps {
  datasets: Dataset[];
  runSql: (dataset: Dataset, sql: string) => Promise<QueryResult>;
  runVisualQuery: (dataset: Dataset, query: VisualQuery) => Promise<QueryResult>;
  saveChartFn: (chart: SavedChart) => Promise<void>;
  saveDashboardFn: (dashboard: Dashboard) => Promise<void>;
  createdChartsMap: Map<string, { chart: SavedChart; result: QueryResult | null }>;
  onDashboardCreated?: (dashboard: Dashboard) => void;
}

function findDataset(datasets: Dataset[], datasetId?: string): Dataset | undefined {
  if (datasetId) {
    return datasets.find((d) => d.id === datasetId);
  }
  return datasets[0];
}

export async function executeAgentToolWithDeps(
  call: AgentToolCall,
  deps: AgentExecutorDeps
): Promise<AgentToolResult> {
  const start = Date.now();

  try {
    switch (call.toolName) {
      case "inspect_schema": {
        const parsed = InspectSchemaInput.parse(call.input);
        const list = parsed.datasetId
          ? deps.datasets.filter((d) => d.id === parsed.datasetId)
          : deps.datasets;
        if (list.length === 0) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: `No dataset found matching id "${parsed.datasetId ?? ""}".`,
            executionMs: Date.now() - start,
          };
        }
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          ok: true,
          data: {
            datasets: list.map((d) => ({
              id: d.id,
              name: d.name,
              tableName: d.tableName,
              dialect: d.dialect,
              rowCount: d.rowCount,
              columns: d.columns.map((c) => ({
                name: c.name,
                type: c.type,
                role: c.role,
              })),
            })),
          },
          executionMs: Date.now() - start,
        };
      }

      case "profile_column": {
        const parsed = ProfileColumnInput.parse(call.input);
        const ds = findDataset(deps.datasets, parsed.datasetId);
        if (!ds) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: `Dataset "${parsed.datasetId}" not found.`,
            executionMs: Date.now() - start,
          };
        }
        const col = ds.columns.find((c) => c.name === parsed.column);
        if (!col) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: `Column "${parsed.column}" does not exist in "${ds.name}". Available columns: ${ds.columns
              .map((c) => c.name)
              .join(", ")}`,
            executionMs: Date.now() - start,
          };
        }

        const qTable = ds.schemaName
          ? `${quoteIdentifier(ds.schemaName, ds.dialect)}.${quoteIdentifier(ds.tableName, ds.dialect)}`
          : quoteIdentifier(ds.tableName, ds.dialect);
        const qCol = quoteIdentifier(col.name, ds.dialect);
        const topN = Math.min(parsed.topN ?? 15, 30);

        const statsSql = `SELECT COUNT(*) AS total_rows, COUNT(DISTINCT ${qCol}) AS distinct_count, SUM(CASE WHEN ${qCol} IS NULL THEN 1 ELSE 0 END) AS null_count FROM ${qTable}`;
        const topSql = `SELECT ${qCol} AS value, COUNT(*) AS row_count FROM ${qTable} WHERE ${qCol} IS NOT NULL GROUP BY ${qCol} ORDER BY row_count DESC LIMIT ${topN}`;

        const [statsRes, topRes] = await Promise.all([
          deps.runSql(ds, statsSql),
          deps.runSql(ds, topSql),
        ]);

        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          ok: true,
          data: {
            datasetId: ds.id,
            column: col.name,
            type: col.type,
            role: col.role,
            stats: statsRes.rows[0] ?? {},
            topValues: topRes.rows,
          },
          executionMs: Date.now() - start,
        };
      }

      case "run_sql_query": {
        const parsed = RunSqlQueryInput.parse(call.input);
        const ds = findDataset(deps.datasets, parsed.datasetId);
        if (!ds) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: `Dataset "${parsed.datasetId}" not found.`,
            executionMs: Date.now() - start,
          };
        }

        const check = validateReadOnlySql(parsed.sql);
        if (!check.valid) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: check.reason ?? "Query rejected by read-only validator.",
            executionMs: Date.now() - start,
          };
        }

        const res = await deps.runSql(ds, parsed.sql);
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          ok: true,
          data: {
            purpose: parsed.purpose,
            sql: res.sql,
            columns: res.columns,
            rows: res.rows.slice(0, 50),
            rowCount: res.rowCount,
            truncated: res.rows.length > 50 || res.truncated,
            executionMs: res.executionMs,
          },
          executionMs: Date.now() - start,
        };
      }

      case "analyze_variance": {
        const parsed = AnalyzeVarianceInput.parse(call.input);
        const ds = findDataset(deps.datasets, parsed.datasetId);
        if (!ds) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: `Dataset "${parsed.datasetId}" not found.`,
            executionMs: Date.now() - start,
          };
        }

        const dimMeta = ds.columns.find((c) => c.name === parsed.dimension);
        const m1Meta = ds.columns.find((c) => c.name === parsed.measure);
        const m2Meta = parsed.secondaryMeasure
          ? ds.columns.find((c) => c.name === parsed.secondaryMeasure)
          : undefined;

        if (!dimMeta || !m1Meta) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: `Invalid dimension "${parsed.dimension}" or measure "${parsed.measure}".`,
            executionMs: Date.now() - start,
          };
        }

        const measures: VisualQuery["measures"] = [{ column: m1Meta.name, aggregation: "sum" }];
        if (m2Meta) {
          measures.push({ column: m2Meta.name, aggregation: "sum" });
        }

        const vQuery: VisualQuery = {
          datasetId: ds.id,
          dimensions: [
            {
              column: dimMeta.name,
              dateGranularity: dimMeta.type === "date" ? "month" : "raw",
            },
          ],
          measures,
          filters: [],
          sort: [{ field: `sum_${m1Meta.name}`, direction: parsed.sortDirection ?? "desc" }],
          limit: parsed.limit ?? 25,
        };

        const compiled = compileVisualQuery(
          vQuery,
          ds.tableName,
          ds.columns,
          ds.dialect,
          ds.schemaName
        );
        const res = await deps.runVisualQuery(ds, vQuery);

        const m1Alias = `sum_${m1Meta.name}`;
        const m2Alias = m2Meta ? `sum_${m2Meta.name}` : null;
        const totalM1 = res.rows.reduce((acc, r) => acc + Number(r[m1Alias] ?? 0), 0);
        const totalM2 = m2Alias
          ? res.rows.reduce((acc, r) => acc + Number(r[m2Alias] ?? 0), 0)
          : null;

        const enrichedRows = res.rows.map((r) => {
          const v1 = Number(r[m1Alias] ?? 0);
          const v2 = m2Alias ? Number(r[m2Alias] ?? 0) : null;
          return {
            ...r,
            share_pct: totalM1 !== 0 ? Number(((v1 / totalM1) * 100).toFixed(1)) : 0,
            ...(v2 !== null && v1 !== 0
              ? { ratio_pct: Number(((v2 / v1) * 100).toFixed(1)) }
              : {}),
          };
        });

        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          ok: true,
          data: {
            dimension: dimMeta.name,
            measure: m1Meta.name,
            secondaryMeasure: m2Meta?.name ?? null,
            sql: compiled.previewSql,
            totalPrimary: Number(totalM1.toFixed(2)),
            totalSecondary: totalM2 !== null ? Number(totalM2.toFixed(2)) : null,
            rows: enrichedRows.slice(0, 30),
            rowCount: enrichedRows.length,
          },
          executionMs: Date.now() - start,
        };
      }

      case "create_chart": {
        const parsed = CreateChartInput.parse(call.input);
        const ds = findDataset(deps.datasets, parsed.datasetId);
        if (!ds) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: `Dataset "${parsed.datasetId}" not found.`,
            executionMs: Date.now() - start,
          };
        }

        const rawQuery: VisualQuery = {
          datasetId: ds.id,
          dimensions: parsed.dimensions,
          measures: parsed.measures,
          colorBy: parsed.colorByColumn ? { column: parsed.colorByColumn } : null,
          filters: [],
          sort: parsed.sortField
            ? [{ field: parsed.sortField, direction: parsed.sortDirection ?? "desc" }]
            : undefined,
          limit: parsed.limit ?? 200,
        };

        const cleanQuery = sanitizeVisualQuery(rawQuery, ds.id, ds.columns);
        if (cleanQuery.dimensions.length === 0 && cleanQuery.measures.length === 0) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: "No valid dimensions or measures matched the dataset schema.",
            executionMs: Date.now() - start,
          };
        }

        const queryResult = await deps.runVisualQuery(ds, cleanQuery);
        const now = new Date().toISOString();
        const chartId = `chart-${crypto.randomUUID().slice(0, 8)}`;
        const chart: SavedChart = {
          id: chartId,
          name: parsed.title,
          description: parsed.description,
          datasetId: ds.id,
          chartType: parsed.chartType as ChartType,
          query: cleanQuery,
          formatting: {
            ...DEFAULT_CHART_FORMATTING,
            numberFormat: (parsed.numberFormat ?? "auto") as NumberFormat,
            showLegend:
              parsed.chartType !== "kpi" &&
              (Boolean(cleanQuery.colorBy) ||
                cleanQuery.measures.length > 1 ||
                parsed.chartType === "pie"),
            showDataLabels:
              parsed.chartType === "pie" || parsed.chartType === "horizontal_bar",
          },
          createdAt: now,
          updatedAt: now,
        };

        await deps.saveChartFn(chart);
        deps.createdChartsMap.set(chartId, { chart, result: queryResult });

        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          ok: true,
          data: {
            chartId,
            title: chart.name,
            chartType: chart.chartType,
            rowCount: queryResult.rowCount,
            sampleRows: queryResult.rows.slice(0, 10),
          },
          executionMs: Date.now() - start,
        };
      }

      case "create_dashboard": {
        const parsed = CreateDashboardInput.parse(call.input);
        const validCharts = parsed.chartIds
          .map((id) => deps.createdChartsMap.get(id)?.chart)
          .filter((c): c is SavedChart => Boolean(c));

        if (validCharts.length === 0) {
          return {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            ok: false,
            error: "None of the supplied chartIds exist in created charts.",
            executionMs: Date.now() - start,
          };
        }

        const kpis = validCharts.filter((c) => c.chartType === "kpi");
        const visuals = validCharts.filter((c) => c.chartType !== "kpi");
        const tiles: DashboardTile[] = [];
        let currentY = 0;

        if (kpis.length > 0) {
          const kpiW = Math.max(3, Math.floor(12 / Math.min(3, kpis.length)));
          kpis.forEach((c, i) => {
            const tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
            const row = Math.floor(i / 3) * 3;
            tiles.push({
              id: tileId,
              kind: "chart",
              chartId: c.id,
              layout: {
                i: tileId,
                x: (i % 3) * kpiW,
                y: row,
                w: kpiW,
                h: 3,
                minW: 3,
                minH: 2,
              },
            });
            currentY = Math.max(currentY, row + 3);
          });
        }

        visuals.forEach((c, i) => {
          const tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
          const isLastOdd = i === visuals.length - 1 && visuals.length % 2 === 1;
          const row = currentY + Math.floor(i / 2) * 7;
          tiles.push({
            id: tileId,
            kind: "chart",
            chartId: c.id,
            layout: {
              i: tileId,
              x: isLastOdd ? 0 : (i % 2) * 6,
              y: row,
              w: isLastOdd ? 12 : 6,
              h: 7,
              minW: 4,
              minH: 5,
            },
          });
        });

        const primaryDs = findDataset(deps.datasets, validCharts[0].datasetId);
        const validColSet = new Set(primaryDs?.columns.map((c) => c.name) ?? []);
        const globalFilters: DashboardGlobalFilter[] = (parsed.globalFilterColumns ?? [])
          .filter((col) => validColSet.has(col))
          .slice(0, 3)
          .map((col, idx) => ({
            id: `gf-agent-${idx}-${crypto.randomUUID().slice(0, 4)}`,
            label: col.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
            datasetId: validCharts[0].datasetId,
            column: col,
            type: "select",
          }));

        const now = new Date().toISOString();
        const dashId = `dash-${crypto.randomUUID().slice(0, 8)}`;
        const dashboard: Dashboard = {
          id: dashId,
          name: parsed.name,
          description: parsed.description,
          tiles,
          globalFilters,
          createdAt: now,
          updatedAt: now,
        };

        await deps.saveDashboardFn(dashboard);
        deps.onDashboardCreated?.(dashboard);

        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          ok: true,
          data: {
            dashboardId: dashId,
            name: dashboard.name,
            tileCount: tiles.length,
            globalFilters: globalFilters.map((g) => g.column),
          },
          executionMs: Date.now() - start,
        };
      }
    }
  } catch (err) {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      ok: false,
      error: err instanceof Error ? err.message : "Tool execution error",
      executionMs: Date.now() - start,
    };
  }
}
