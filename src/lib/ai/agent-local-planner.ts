import { quoteIdentifier } from "../query/compiler";
import { ColumnMeta, Dataset } from "../query/types";
import {
  AgentFinalAnswer,
  AgentStepResponse,
  AgentStepTrace,
  AgentToolCall,
} from "./agent-types";

function makeCallId(stepIdx: number, toolIdx: number): string {
  return `local_call_${stepIdx}_${toolIdx}`;
}

function colMatchesPrompt(colName: string, lowerPrompt: string): boolean {
  const norm = colName.toLowerCase();
  const spaced = norm.replace(/_/g, " ");
  const stem = spaced.endsWith("y") && spaced.length > 3 ? spaced.slice(0, -1) : spaced;
  return (
    lowerPrompt.includes(norm) ||
    lowerPrompt.includes(spaced) ||
    (stem.length >= 4 && lowerPrompt.includes(stem))
  );
}

function pickColumnsForGoal(goal: string, ds: Dataset) {
  const lower = goal.toLowerCase();
  const stringDims = ds.columns.filter(
    (c) => c.role === "dimension" && c.type === "string" && !/id$/i.test(c.name)
  );
  const dateDim = ds.columns.find((c) => c.type === "date");
  const measures = ds.columns.filter((c) => c.role === "measure");

  const matchedDim =
    stringDims.find((c) => colMatchesPrompt(c.name, lower)) ??
    stringDims.find((c) => /category|region|segment/i.test(c.name)) ??
    stringDims[0];

  const secondaryDim =
    stringDims.find((c) => c.name !== matchedDim?.name && /sub_category|region|country|category|segment/i.test(c.name)) ??
    stringDims.find((c) => c.name !== matchedDim?.name);

  // Keep sales/revenue/amount as denominator (primaryMeasure) when profit/margin exists
  const revenueLike = measures.find((m) => /sales|revenue|amount|total/i.test(m.name));
  const profitLike = measures.find((m) => /profit|margin|net_income/i.test(m.name));

  const primaryMeasure =
    revenueLike ??
    measures.find((m) => colMatchesPrompt(m.name, lower)) ??
    measures[0];

  const secondaryMeasure =
    (profitLike && profitLike.name !== primaryMeasure?.name ? profitLike : undefined) ??
    measures.find((m) => m.name !== primaryMeasure?.name && /qty|quantity|score/i.test(m.name)) ??
    measures.find((m) => m.name !== primaryMeasure?.name);

  return {
    stringDims,
    dateDim,
    primaryDim: matchedDim,
    secondaryDim,
    primaryMeasure,
    secondaryMeasure,
  };
}

function buildSafeTotalsSql(
  ds: Dataset,
  primaryMeasure?: ColumnMeta,
  secondaryMeasure?: ColumnMeta
): string {
  const qTable = ds.schemaName
    ? `${quoteIdentifier(ds.schemaName, ds.dialect)}.${quoteIdentifier(ds.tableName, ds.dialect)}`
    : quoteIdentifier(ds.tableName, ds.dialect);

  const selects: string[] = ["COUNT(*) AS total_records"];
  if (primaryMeasure) {
    const qM1 = quoteIdentifier(primaryMeasure.name, ds.dialect);
    selects.push(`ROUND(SUM(${qM1}), 2) AS total_${primaryMeasure.name}`);
  }
  if (secondaryMeasure) {
    const qM2 = quoteIdentifier(secondaryMeasure.name, ds.dialect);
    selects.push(`ROUND(SUM(${qM2}), 2) AS total_${secondaryMeasure.name}`);
  }
  if (primaryMeasure && secondaryMeasure) {
    const qM1 = quoteIdentifier(primaryMeasure.name, ds.dialect);
    const qM2 = quoteIdentifier(secondaryMeasure.name, ds.dialect);
    selects.push(
      `ROUND((SUM(${qM2}) * 100.0) / NULLIF(SUM(${qM1}), 0), 2) AS margin_pct`
    );
  }
  return `SELECT ${selects.join(", ")} FROM ${qTable}`;
}

function buildTrendSql(
  ds: Dataset,
  dateDim: ColumnMeta,
  primaryMeasure: ColumnMeta,
  secondaryMeasure?: ColumnMeta
): string {
  const qTable = ds.schemaName
    ? `${quoteIdentifier(ds.schemaName, ds.dialect)}.${quoteIdentifier(ds.tableName, ds.dialect)}`
    : quoteIdentifier(ds.tableName, ds.dialect);
  const qDate = quoteIdentifier(dateDim.name, ds.dialect);
  const qM1 = quoteIdentifier(primaryMeasure.name, ds.dialect);

  let periodExpr = `STRFTIME(DATE_TRUNC('month', CAST(${qDate} AS TIMESTAMP)), '%Y-%m')`;
  if (ds.dialect === "postgres") {
    periodExpr = `TO_CHAR(DATE_TRUNC('month', CAST(${qDate} AS TIMESTAMP)), 'YYYY-MM')`;
  } else if (ds.dialect === "mysql") {
    periodExpr = `DATE_FORMAT(${qDate}, '%Y-%m')`;
  }

  const extra = secondaryMeasure
    ? `, ROUND(SUM(${quoteIdentifier(secondaryMeasure.name, ds.dialect)}), 2) AS sum_${secondaryMeasure.name}`
    : "";

  return `SELECT ${periodExpr} AS period, ROUND(SUM(${qM1}), 2) AS sum_${primaryMeasure.name}${extra} FROM ${qTable} GROUP BY 1 ORDER BY 1 ASC LIMIT 36`;
}

function fmtVal(val: unknown, isCurrency: boolean): string {
  const num = Number(val);
  if (!Number.isFinite(num)) return String(val ?? "0");
  if (isCurrency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Math.abs(num) >= 100 ? 0 : 2,
    }).format(num);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(num);
}

function buildGroundedFinalAnswer(
  goal: string,
  ds: Dataset,
  history: AgentStepTrace[]
): AgentFinalAnswer {
  const { primaryMeasure, secondaryMeasure } = pickColumnsForGoal(goal, ds);
  const m1Name = primaryMeasure?.name ?? "value";
  const m2Name = secondaryMeasure?.name;
  const isCurrency = /(sales|revenue|profit|price|cost|amount)/i.test(m1Name);

  const allResults = history.flatMap((s) => s.toolResults);
  const totalsResult = allResults.find(
    (r) =>
      r.ok &&
      r.toolName === "run_sql_query" &&
      Array.isArray(r.data?.rows) &&
      (r.data.rows as Record<string, unknown>[])[0]?.total_records !== undefined
  );
  const varianceResults = allResults.filter(
    (r) => r.ok && r.toolName === "analyze_variance" && Array.isArray(r.data?.rows)
  );
  const trendResult = allResults.find(
    (r) =>
      r.ok &&
      r.toolName === "run_sql_query" &&
      Array.isArray(r.data?.rows) &&
      (r.data.rows as Record<string, unknown>[])[0]?.period !== undefined
  );
  const createdCharts = allResults.filter((r) => r.ok && r.toolName === "create_chart");
  const createdDash = allResults.find((r) => r.ok && r.toolName === "create_dashboard");

  const keyFindings: string[] = [];
  const rootCauses: string[] = [];
  const recommendations: string[] = [];
  const citations: string[] = [];

  const totalsRow = (totalsResult?.data?.rows as Record<string, unknown>[] | undefined)?.[0];
  if (totalsRow) {
    const recCount = Number(totalsRow.total_records ?? ds.rowCount);
    const total1 = totalsRow[`total_${m1Name}`];
    const total2 = m2Name ? totalsRow[`total_${m2Name}`] : undefined;
    const margin = totalsRow.margin_pct;

    const parts = [`${recCount.toLocaleString()} records`];
    if (total1 !== undefined) parts.push(`${m1Name} totaling ${fmtVal(total1, isCurrency)}`);
    if (total2 !== undefined && m2Name) parts.push(`${m2Name} of ${fmtVal(total2, isCurrency)}`);
    if (margin !== undefined) parts.push(`overall margin of ${margin}%`);
    keyFindings.push(`Baseline across "${ds.name}": ${parts.join(", ")}.`);
    citations.push(`run_sql_query (overall baseline: ${recCount} rows)`);
  }

  let headline = `Analysis Complete for ${ds.name}`;

  for (const vr of varianceResults) {
    const dim = String(vr.data?.dimension ?? "");
    const rows = (vr.data?.rows ?? []) as Record<string, unknown>[];
    if (rows.length === 0) continue;

    const m1Key = `sum_${String(vr.data?.measure ?? m1Name)}`;
    const m2Key = vr.data?.secondaryMeasure ? `sum_${String(vr.data.secondaryMeasure)}` : null;

    const top = rows[0];
    const bottom = rows[rows.length - 1];
    const topLabel = String(top[dim] ?? "Top");
    const bottomLabel = String(bottom[dim] ?? "Bottom");

    if (vr === varianceResults[0]) {
      headline = `${topLabel} leads ${m1Name.replace(/_/g, " ")} at ${top.share_pct ?? 0}% share`;
    }

    keyFindings.push(
      `By ${dim}: "${topLabel}" ranks #1 with ${fmtVal(top[m1Key], isCurrency)} (${top.share_pct ?? 0}% share)${
        m2Key ? ` and ${fmtVal(top[m2Key], isCurrency)} ${String(vr.data?.secondaryMeasure)}` : ""
      }${top.ratio_pct !== undefined ? ` (${top.ratio_pct}% ratio)` : ""}.`
    );

    if (rows.length > 1 && topLabel !== bottomLabel) {
      if (top.ratio_pct !== undefined && bottom.ratio_pct !== undefined) {
        const sortedByMargin = [...rows].sort(
          (a, b) => Number(a.ratio_pct ?? 0) - Number(b.ratio_pct ?? 0)
        );
        const lowestMargin = sortedByMargin[0];
        const highestMargin = sortedByMargin[sortedByMargin.length - 1];
        rootCauses.push(
          `Margin spread across ${dim}: "${String(highestMargin[dim])}" achieves ${highestMargin.ratio_pct}% vs. "${String(lowestMargin[dim])}" at ${lowestMargin.ratio_pct}% (${fmtVal(lowestMargin[m2Key ?? m1Key], isCurrency)}).`
        );
        recommendations.push(
          `Audit pricing, discounting, and cost structure in "${String(lowestMargin[dim])}" (${lowestMargin.ratio_pct}% margin) while scaling high-margin "${String(highestMargin[dim])}" (${highestMargin.ratio_pct}%).`
        );
      } else {
        rootCauses.push(
          `Concentration gap: "${topLabel}" (${top.share_pct ?? 0}%) contributes significantly more than "${bottomLabel}" (${bottom.share_pct ?? 0}%).`
        );
      }
    }

    citations.push(`analyze_variance (${dim} across ${rows.length} groups)`);
  }

  const trendRows = (trendResult?.data?.rows ?? []) as Record<string, unknown>[];
  if (trendRows.length >= 2) {
    const first = trendRows[0];
    const last = trendRows[trendRows.length - 1];
    const metricKey = `sum_${m1Name}`;
    const sortedTrend = [...trendRows].sort(
      (a, b) => Number(b[metricKey] ?? 0) - Number(a[metricKey] ?? 0)
    );
    const peak = sortedTrend[0];
    keyFindings.push(
      `Time-series (${trendRows.length} periods from ${String(first.period)} to ${String(
        last.period
      )}): peak ${m1Name} occurred in ${String(peak.period)} at ${fmtVal(
        peak[metricKey],
        isCurrency
      )}.`
    );
    citations.push(`run_sql_query (monthly trend: ${trendRows.length} periods)`);
  }

  if (createdCharts.length > 0) {
    citations.push(`create_chart (${createdCharts.length} verified visuals)`);
  }
  if (createdDash?.data?.name) {
    recommendations.push(
      `Explore the generated "${String(createdDash.data.name)}" dashboard using the global filters and click-to-cross-filter controls.`
    );
    citations.push(`create_dashboard ("${String(createdDash.data.name)}")`);
  }

  if (rootCauses.length === 0) {
    rootCauses.push("Variance is primarily concentrated among the top-performing segments identified above.");
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Drill down into the highest-variance segment in Chart Studio or apply cross-filters on the generated dashboard."
    );
  }

  return {
    headline,
    summary:
      keyFindings[0] ??
      `Completed ${history.length}-step autonomous investigation on "${ds.name}".`,
    keyFindings,
    rootCauses,
    recommendations,
    citations,
  };
}

/**
 * Deterministic multi-step ReAct planner used when no external LLM key is configured
 * or as a fallback. Emits genuine incremental tool calls and recovers from SQL errors.
 */
export function planNextLocalAgentStep(params: {
  goal: string;
  datasets: Dataset[];
  history: AgentStepTrace[];
}): AgentStepResponse {
  const { goal, datasets, history } = params;
  const ds = datasets[0];
  const stepIdx = history.length + 1;
  const engine = "Built-in ReAct Agent";

  if (!ds) {
    return {
      done: true,
      thought: "No datasets are currently loaded.",
      toolCalls: [],
      finalAnswer: {
        headline: "No Dataset Available",
        summary: "Please upload a file or connect a database in Data Sources first.",
        keyFindings: [],
        rootCauses: [],
        recommendations: ["Open Data Sources to upload a CSV, Parquet, or Excel file."],
        citations: [],
      },
      engine,
    };
  }

  const { dateDim, primaryDim, secondaryDim, primaryMeasure, secondaryMeasure } =
    pickColumnsForGoal(goal, ds);

  // 1. Self-Healing Check: recover automatically if the last step had a SQL failure
  const lastStep = history[history.length - 1];
  const failedSql = lastStep?.toolResults.find(
    (r) => !r.ok && !r.skippedByUser && r.toolName === "run_sql_query"
  );
  const repairAttempts = history.filter((s) => s.selfRepaired).length;
  if (failedSql && repairAttempts < 2) {
    const safeSql = buildSafeTotalsSql(ds, primaryMeasure, secondaryMeasure);
    return {
      done: false,
      thought: `Self-healing triggered: previous SQL query failed (${failedSql.error}). Rewriting query against verified schema columns on "${ds.tableName}".`,
      toolCalls: [
        {
          toolCallId: makeCallId(stepIdx, 1),
          toolName: "run_sql_query",
          input: {
            datasetId: ds.id,
            sql: safeSql,
            purpose: "Recovered baseline metrics query using verified schema columns",
          },
        },
      ],
      engine,
    };
  }

  const executedTools = new Set(
    history.flatMap((s) => s.toolResults.filter((r) => r.ok || r.skippedByUser).map((r) => r.toolName))
  );

  // Step 1: Inspect schema
  if (!executedTools.has("inspect_schema")) {
    return {
      done: false,
      thought: `Step ${stepIdx}: Inspecting dataset schema and available dimensions/measures for "${ds.name}" before running analytical queries.`,
      toolCalls: [
        {
          toolCallId: makeCallId(stepIdx, 1),
          toolName: "inspect_schema",
          input: { datasetId: ds.id },
        },
      ],
      engine,
    };
  }

  // Step 2: Profile key dimension + run baseline KPI SQL query
  if (!executedTools.has("profile_column") && primaryDim) {
    const calls: AgentToolCall[] = [
      {
        toolCallId: makeCallId(stepIdx, 1),
        toolName: "profile_column",
        input: { datasetId: ds.id, column: primaryDim.name, topN: 10 },
      },
      {
        toolCallId: makeCallId(stepIdx, 2),
        toolName: "run_sql_query",
        input: {
          datasetId: ds.id,
          sql: buildSafeTotalsSql(ds, primaryMeasure, secondaryMeasure),
          purpose: "Compute overall baseline totals and profit margin",
        },
      },
    ];
    return {
      done: false,
      thought: `Step ${stepIdx}: Profiling "${primaryDim.name}" values and querying overall KPI totals in ${ds.dialect}.`,
      toolCalls: calls,
      engine,
    };
  }

  // Step 3: Analyze variance across dimensions + optional time-series trend
  if (!executedTools.has("analyze_variance") && primaryDim && primaryMeasure) {
    const calls: AgentToolCall[] = [
      {
        toolCallId: makeCallId(stepIdx, 1),
        toolName: "analyze_variance",
        input: {
          datasetId: ds.id,
          dimension: primaryDim.name,
          measure: primaryMeasure.name,
          secondaryMeasure: secondaryMeasure?.name,
          sortDirection: "desc",
          limit: 15,
        },
      },
    ];

    if (secondaryDim) {
      calls.push({
        toolCallId: makeCallId(stepIdx, 2),
        toolName: "analyze_variance",
        input: {
          datasetId: ds.id,
          dimension: secondaryDim.name,
          measure: primaryMeasure.name,
          secondaryMeasure: secondaryMeasure?.name,
          sortDirection: "desc",
          limit: 10,
        },
      });
    }

    if (dateDim) {
      calls.push({
        toolCallId: makeCallId(stepIdx, 3),
        toolName: "run_sql_query",
        input: {
          datasetId: ds.id,
          sql: buildTrendSql(ds, dateDim, primaryMeasure, secondaryMeasure),
          purpose: "Analyze monthly time-series trajectory",
        },
      });
    }

    return {
      done: false,
      thought: `Step ${stepIdx}: Analyzing variance, margin ratios, and temporal trends across ${primaryDim.name}${
        secondaryDim ? ` and ${secondaryDim.name}` : ""
      }.`,
      toolCalls: calls,
      engine,
    };
  }

  // Step 4: Materialize verified charts
  if (!executedTools.has("create_chart") && primaryMeasure) {
    const calls: AgentToolCall[] = [];
    const numFmt = /(sales|revenue|profit|price|cost|amount)/i.test(primaryMeasure.name)
      ? "currency"
      : "compact";

    calls.push({
      toolCallId: makeCallId(stepIdx, 1),
      toolName: "create_chart",
      input: {
        datasetId: ds.id,
        title: `Total ${primaryMeasure.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
        description: "Baseline metric verified by AI Analyst",
        chartType: "kpi",
        dimensions: [],
        measures: [{ column: primaryMeasure.name, aggregation: "sum" }],
        numberFormat: numFmt,
        limit: 1,
      },
    });

    if (primaryDim) {
      calls.push({
        toolCallId: makeCallId(stepIdx, 2),
        toolName: "create_chart",
        input: {
          datasetId: ds.id,
          title: `${primaryMeasure.name.replace(/_/g, " ")} by ${primaryDim.name.replace(/_/g, " ")}`.replace(
            /\b\w/g,
            (c) => c.toUpperCase()
          ),
          description: secondaryDim ? `Breakdown by ${secondaryDim.name}` : "Category performance",
          chartType: secondaryDim ? "stacked_bar" : "bar",
          dimensions: [{ column: primaryDim.name, dateGranularity: "raw" }],
          measures: [{ column: primaryMeasure.name, aggregation: "sum" }],
          colorByColumn: secondaryDim?.name ?? null,
          sortField: `sum_${primaryMeasure.name}`,
          sortDirection: "desc",
          numberFormat: numFmt,
          limit: 20,
        },
      });
    }

    if (secondaryDim || primaryDim) {
      const targetDim = secondaryDim ?? primaryDim!;
      const targetMeasure = secondaryMeasure ?? primaryMeasure;
      calls.push({
        toolCallId: makeCallId(stepIdx, 3),
        toolName: "create_chart",
        input: {
          datasetId: ds.id,
          title: `Top ${targetDim.name.replace(/_/g, " ")} by ${targetMeasure.name.replace(/_/g, " ")}`.replace(
            /\b\w/g,
            (c) => c.toUpperCase()
          ),
          description: "Key driver ranking",
          chartType: "horizontal_bar",
          dimensions: [{ column: targetDim.name, dateGranularity: "raw" }],
          measures: [{ column: targetMeasure.name, aggregation: "sum" }],
          sortField: `sum_${targetMeasure.name}`,
          sortDirection: "desc",
          numberFormat: numFmt,
          limit: 8,
        },
      });
    }

    if (dateDim) {
      calls.push({
        toolCallId: makeCallId(stepIdx, 4),
        toolName: "create_chart",
        input: {
          datasetId: ds.id,
          title: `Monthly ${primaryMeasure.name.replace(/_/g, " ")} Trend`.replace(/\b\w/g, (c) =>
            c.toUpperCase()
          ),
          description: "Time-series evidence",
          chartType: "area",
          dimensions: [{ column: dateDim.name, dateGranularity: "month" }],
          measures: secondaryMeasure
            ? [
                { column: primaryMeasure.name, aggregation: "sum" },
                { column: secondaryMeasure.name, aggregation: "sum" },
              ]
            : [{ column: primaryMeasure.name, aggregation: "sum" }],
          numberFormat: numFmt,
          limit: 120,
        },
      });
    }

    return {
      done: false,
      thought: `Step ${stepIdx}: Materializing ${calls.length} verified visualizations grounded in the discovered drivers.`,
      toolCalls: calls,
      engine,
    };
  }

  // Step 5: Assemble diagnostic dashboard if >= 2 charts succeeded
  const createdChartIds = history
    .flatMap((s) => s.toolResults)
    .filter((r) => r.ok && r.toolName === "create_chart" && typeof r.data?.chartId === "string")
    .map((r) => String(r.data!.chartId));

  if (!executedTools.has("create_dashboard") && createdChartIds.length >= 2) {
    const filterCols = ds.columns
      .filter((c) => c.role === "dimension" && c.type === "string" && !/id$/i.test(c.name))
      .slice(0, 3)
      .map((c) => c.name);

    return {
      done: false,
      thought: `Step ${stepIdx}: Assembling ${createdChartIds.length} verified visuals and global filters into a cross-filtered diagnostic dashboard.`,
      toolCalls: [
        {
          toolCallId: makeCallId(stepIdx, 1),
          toolName: "create_dashboard",
          input: {
            name: `AI Diagnostic: ${ds.name}`,
            description: `Generated autonomously for: "${goal.slice(0, 120)}"`,
            chartIds: createdChartIds,
            globalFilterColumns: filterCols,
          },
        },
      ],
      engine,
    };
  }

  // Final Step: Synthesize grounded report from real tool outputs
  return {
    done: true,
    thought: "All investigative queries and visuals verified. Synthesizing grounded executive report.",
    toolCalls: [],
    finalAnswer: buildGroundedFinalAnswer(goal, ds, history),
    engine,
  };
}
