export type ColumnType = "string" | "number" | "date" | "boolean";
export type ColumnRole = "dimension" | "measure";
export type SqlDialect = "duckdb" | "postgres" | "mysql";
export type DataSourceKind = "local_file" | "postgres" | "mysql";

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  role: ColumnRole;
  rawType?: string;
}

export type AggregationFn =
  | "sum"
  | "avg"
  | "count"
  | "count_distinct"
  | "min"
  | "max";

export type DateGranularity =
  | "raw"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year";

export type FilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains";

export interface DimensionField {
  column: string;
  dateGranularity?: DateGranularity;
  alias?: string;
}

export interface MeasureField {
  column: string;
  aggregation: AggregationFn;
  alias?: string;
}

export interface QueryFilter {
  id?: string;
  column: string;
  operator: FilterOperator;
  value: string | number | boolean | Array<string | number>;
}

export interface SortSpec {
  field: string;
  direction: "asc" | "desc";
}

export interface VisualQuery {
  datasetId: string;
  dimensions: DimensionField[];
  measures: MeasureField[];
  colorBy?: DimensionField | null;
  filters: QueryFilter[];
  sort?: SortSpec[];
  limit?: number;
}

export type ChartType =
  | "auto"
  | "bar"
  | "stacked_bar"
  | "horizontal_bar"
  | "line"
  | "area"
  | "pie"
  | "scatter"
  | "kpi"
  | "table";

export type NumberFormat = "auto" | "currency" | "percent" | "compact" | "decimal";

export interface ChartFormatting {
  palette: "ocean" | "tableau" | "emerald" | "sunset" | "mono";
  showLegend: boolean;
  legendPosition: "top" | "bottom" | "right";
  numberFormat: NumberFormat;
  showDataLabels: boolean;
  smoothLine: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export const DEFAULT_CHART_FORMATTING: ChartFormatting = {
  palette: "tableau",
  showLegend: true,
  legendPosition: "bottom",
  numberFormat: "auto",
  showDataLabels: false,
  smoothLine: true,
};

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  sourceId?: string;
  sourceKind: DataSourceKind;
  dialect: SqlDialect;
  tableName: string;
  schemaName?: string;
  fileName?: string;
  fileUrl?: string;
  rowCount: number;
  columns: ColumnMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface DataSourceConfig {
  id: string;
  name: string;
  kind: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  createdAt: string;
}

export interface SavedChart {
  id: string;
  name: string;
  description?: string;
  datasetId: string;
  chartType: ChartType;
  query: VisualQuery;
  formatting: ChartFormatting;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardTileLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface DashboardTile {
  id: string;
  kind: "chart" | "markdown";
  chartId?: string;
  title?: string;
  markdownContent?: string;
  layout: DashboardTileLayout;
}

export interface DashboardGlobalFilter {
  id: string;
  label: string;
  datasetId: string;
  column: string;
  type: "select" | "date_range";
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  tiles: DashboardTile[];
  globalFilters: DashboardGlobalFilter[];
  createdAt: string;
  updatedAt: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
  executionMs: number;
  rowCount: number;
  truncated: boolean;
}
