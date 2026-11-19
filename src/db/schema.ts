import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  ChartFormatting,
  ColumnMeta,
  DashboardGlobalFilter,
  DashboardTile,
  VisualQuery,
} from "@/lib/query/types";

export const dataSources = pgTable("data_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'postgres' | 'mysql'
  host: text("host").notNull(),
  port: integer("port").notNull(),
  database: text("database").notNull(),
  username: text("username").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  ssl: boolean("ssl").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const datasets = pgTable("datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sourceId: text("source_id").references(() => dataSources.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(), // 'local_file' | 'postgres' | 'mysql'
  dialect: text("dialect").notNull(),
  tableName: text("table_name").notNull(),
  schemaName: text("schema_name"),
  rowCount: integer("row_count").notNull().default(0),
  columns: jsonb("columns").$type<ColumnMeta[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const savedCharts = pgTable("saved_charts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  datasetId: text("dataset_id").notNull(),
  chartType: text("chart_type").notNull(),
  query: jsonb("query").$type<VisualQuery>().notNull(),
  formatting: jsonb("formatting").$type<ChartFormatting>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const dashboards = pgTable("dashboards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  tiles: jsonb("tiles").$type<DashboardTile[]>().notNull(),
  globalFilters: jsonb("global_filters").$type<DashboardGlobalFilter[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
