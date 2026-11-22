import { ColumnMeta, VisualQuery } from "../query/types";

/**
 * Ensures every column reference emitted by an LLM exists in the dataset schema.
 */
export function sanitizeVisualQuery(
  rawQuery: VisualQuery,
  datasetId: string,
  columns: ColumnMeta[]
): VisualQuery {
  const validCols = new Map(columns.map((c) => [c.name, c]));

  const dimensions = (rawQuery.dimensions ?? [])
    .filter((d) => validCols.has(d.column))
    .slice(0, 2)
    .map((d) => {
      const meta = validCols.get(d.column)!;
      return {
        column: d.column,
        dateGranularity: meta.type === "date" ? d.dateGranularity ?? "month" : ("raw" as const),
      };
    });

  const measures = (rawQuery.measures ?? [])
    .filter((m) => validCols.has(m.column))
    .slice(0, 3)
    .map((m) => ({
      column: m.column,
      aggregation: m.aggregation,
    }));

  const colorBy =
    rawQuery.colorBy && validCols.has(rawQuery.colorBy.column)
      ? {
          column: rawQuery.colorBy.column,
          dateGranularity:
            validCols.get(rawQuery.colorBy.column)?.type === "date"
              ? rawQuery.colorBy.dateGranularity ?? "year"
              : ("raw" as const),
        }
      : null;

  const filters = (rawQuery.filters ?? []).filter((f) => validCols.has(f.column));

  const validSortFields = new Set<string>([
    ...dimensions.map((d) =>
      d.dateGranularity && d.dateGranularity !== "raw"
        ? `${d.column}_${d.dateGranularity}`
        : d.column
    ),
    ...measures.map((m) => `${m.aggregation}_${m.column}`),
    ...(colorBy ? [colorBy.column] : []),
  ]);

  const sort = (rawQuery.sort ?? []).filter((s) => validSortFields.has(s.field));

  return {
    datasetId,
    dimensions,
    measures,
    colorBy,
    filters,
    sort: sort.length > 0 ? sort : undefined,
    limit: Math.min(Math.max(1, Number(rawQuery.limit ?? 500)), 5000),
  };
}
