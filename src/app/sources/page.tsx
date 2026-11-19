"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Loader2,
  Plus,
  Server,
  Trash2,
  UploadCloud,
  X,
  AlertCircle,
  BarChart3,
} from "lucide-react";
import { ColumnMeta, DataSourceConfig, Dataset } from "@/lib/query/types";
import { ingestFileIntoDuckDB, sanitizeTableName } from "@/lib/engines/duckdb-client";
import { deleteDataset, listDatasets, saveDataset } from "@/lib/storage/indexeddb-store";
import { SAMPLE_DATASET_ID } from "@/lib/storage/seed";

interface DiscoveredTable {
  schemaName: string;
  tableName: string;
  columns: ColumnMeta[];
}

export default function SourcesPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [liveSources, setLiveSources] = useState<DataSourceConfig[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live DB Connection Modal state
  const [dbModalOpen, setDbModalOpen] = useState(false);
  const [dbName, setDbName] = useState("");
  const [dbKind, setDbKind] = useState<"postgres" | "mysql">("postgres");
  const [dbHost, setDbHost] = useState("localhost");
  const [dbPort, setDbPort] = useState("5432");
  const [dbDatabase, setDbDatabase] = useState("");
  const [dbUser, setDbUser] = useState("");
  const [dbPassword, setDbPassword] = useState("");
  const [dbSsl, setDbSsl] = useState(false);
  const [dbTesting, setDbTesting] = useState(false);
  const [dbSaving, setDbSaving] = useState(false);
  const [dbStatus, setDbStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [discovered, setDiscovered] = useState<{
    source: DataSourceConfig;
    tables: DiscoveredTable[];
  } | null>(null);

  const loadAll = async () => {
    const ds = await listDatasets();
    setDatasets(ds);
    try {
      const res = await fetch("/api/sources");
      if (res.ok) {
        const data = await res.json();
        setLiveSources(data.sources ?? []);
      }
    } catch {
      // Ignore offline fetch
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadErr(null);
    setUploadMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const tableName = sanitizeTableName(file.name);
      const { columns, rowCount } = await ingestFileIntoDuckDB({
        tableName,
        fileName: file.name,
        bytes,
      });

      const now = new Date().toISOString();
      const dataset: Dataset = {
        id: `ds-${crypto.randomUUID().slice(0, 8)}`,
        name: file.name.replace(/\.[^.]+$/, ""),
        description: `Uploaded local file (${file.name}) analyzed in-browser with DuckDB-Wasm.`,
        sourceKind: "local_file",
        dialect: "duckdb",
        tableName,
        fileName: file.name,
        rowCount,
        columns,
        createdAt: now,
        updatedAt: now,
      };

      await saveDataset(dataset, bytes);
      setUploadMsg(
        `Ingested "${file.name}" (${rowCount.toLocaleString()} rows, ${columns.length} columns) into DuckDB-Wasm.`
      );
      await loadAll();
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "Failed to parse uploaded file.");
    } finally {
      setUploading(false);
    }
  };

  const handleTestDb = async () => {
    setDbTesting(true);
    setDbStatus(null);
    try {
      const res = await fetch("/api/sources/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: dbKind,
          host: dbHost,
          port: Number(dbPort),
          database: dbDatabase,
          username: dbUser,
          password: dbPassword,
          ssl: dbSsl,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDbStatus({ ok: true, text: `Connected: ${data.serverVersion}` });
      } else {
        setDbStatus({ ok: false, text: data.error ?? "Connection failed" });
      }
    } catch (err) {
      setDbStatus({ ok: false, text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setDbTesting(false);
    }
  };

  const handleSaveDb = async (e: React.FormEvent) => {
    e.preventDefault();
    setDbSaving(true);
    setDbStatus(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dbName.trim() || `${dbKind}-${dbDatabase}`,
          kind: dbKind,
          host: dbHost,
          port: Number(dbPort),
          database: dbDatabase,
          username: dbUser,
          password: dbPassword,
          ssl: dbSsl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDbStatus({ ok: false, text: data.error ?? "Failed to save connection" });
        return;
      }

      setDiscovered({ source: data.source, tables: data.tables ?? [] });
      setDbModalOpen(false);
      await loadAll();
    } catch (err) {
      setDbStatus({ ok: false, text: err instanceof Error ? err.message : "Request failed" });
    } finally {
      setDbSaving(false);
    }
  };

  const registerDiscoveredTable = async (source: DataSourceConfig, tbl: DiscoveredTable) => {
    const now = new Date().toISOString();
    const dataset: Dataset = {
      id: `ds-${crypto.randomUUID().slice(0, 8)}`,
      name: `${source.name}: ${tbl.tableName}`,
      description: `Live ${source.kind} table ${tbl.schemaName}.${tbl.tableName}`,
      sourceId: source.id,
      sourceKind: source.kind,
      dialect: source.kind,
      tableName: tbl.tableName,
      schemaName: tbl.schemaName,
      rowCount: 0,
      columns: tbl.columns,
      createdAt: now,
      updatedAt: now,
    };
    await saveDataset(dataset);
    setUploadMsg(`Registered live table "${tbl.schemaName}.${tbl.tableName}" as a dataset.`);
    await loadAll();
  };

  const handleDeleteDataset = async (id: string) => {
    await deleteDataset(id);
    await loadAll();
  };

  return (
    <div className="max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Data Sources & Datasets
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Analyze local files instantaneously in DuckDB-Wasm or connect live PostgreSQL & MySQL
            databases.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setDbStatus(null);
            setDbModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm cursor-pointer self-start"
        >
          <Server className="w-4 h-4" />
          Connect PostgreSQL / MySQL
        </button>
      </div>

      {/* File Dropzone */}
      <section
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) handleFileUpload(f);
        }}
        onClick={() => fileInputRef.current?.click()}
        className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-white dark:bg-slate-900 p-8 text-center cursor-pointer transition-colors space-y-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.parquet,.xlsx,.xls,.json,.ndjson"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-blue-600">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-sm font-semibold">Ingesting file into DuckDB-Wasm...</span>
          </div>
        ) : (
          <>
            <UploadCloud className="w-9 h-9 mx-auto text-blue-600 dark:text-blue-400" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Drop a CSV, Parquet, Excel (.xlsx), TSV, or JSON file here — or click to browse
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Processed 100% locally in your browser with DuckDB-Wasm. Your data stays private.
            </p>
          </>
        )}
      </section>

      {uploadMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{uploadMsg}</span>
        </div>
      )}

      {uploadErr && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{uploadErr}</span>
        </div>
      )}

      {/* Discovered Live DB Tables Picker */}
      {discovered && (
        <section className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Discovered Tables in {discovered.source.name} ({discovered.tables.length})
            </h2>
            <button
              type="button"
              onClick={() => setDiscovered(null)}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
            {discovered.tables.map((t) => (
              <div
                key={`${t.schemaName}.${t.tableName}`}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">
                    {t.schemaName}.{t.tableName}
                  </div>
                  <div className="text-[11px] text-slate-500">{t.columns.length} columns</div>
                </div>
                <button
                  type="button"
                  onClick={() => registerDiscoveredTable(discovered.source, t)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  <Plus className="w-3 h-3" />
                  Use
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Registered Datasets List */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          Registered Datasets ({datasets.length})
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {datasets.map((ds) => (
            <div
              key={ds.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                      {ds.name}
                    </h3>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      {ds.dialect}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {ds.description || ds.tableName}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Link
                    href={`/explore?datasetId=${ds.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Explore
                  </Link>
                  {ds.id !== SAMPLE_DATASET_ID && (
                    <button
                      type="button"
                      onClick={() => handleDeleteDataset(ds.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                {ds.columns.slice(0, 14).map((col) => (
                  <span
                    key={col.name}
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                      col.role === "measure"
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                    }`}
                  >
                    {col.name}
                  </span>
                ))}
                {ds.columns.length > 14 && (
                  <span className="text-[11px] text-slate-400 px-1 py-0.5">
                    +{ds.columns.length - 14} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Connected Live DB Servers */}
      {liveSources.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Connected Live Databases ({liveSources.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {liveSources.map((src) => (
              <div
                key={src.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs space-y-1"
              >
                <div className="font-bold text-sm text-slate-900 dark:text-white">{src.name}</div>
                <div className="text-slate-500 font-mono">
                  {src.kind}://{src.host}:{src.port}/{src.database}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Connect Live Database Modal */}
      {dbModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveDb}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Connect Live SQL Database
              </h3>
              <button
                type="button"
                onClick={() => setDbModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Connection Name
                </label>
                <input
                  type="text"
                  required
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                  placeholder="Production Analytics"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Database Engine
                </label>
                <select
                  value={dbKind}
                  onChange={(e) => {
                    const k = e.target.value as "postgres" | "mysql";
                    setDbKind(k);
                    setDbPort(k === "postgres" ? "5432" : "3306");
                  }}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Host
                </label>
                <input
                  type="text"
                  required
                  value={dbHost}
                  onChange={(e) => setDbHost(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Port
                </label>
                <input
                  type="number"
                  required
                  value={dbPort}
                  onChange={(e) => setDbPort(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>

              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Database Name
                </label>
                <input
                  type="text"
                  required
                  value={dbDatabase}
                  onChange={(e) => setDbDatabase(e.target.value)}
                  placeholder="analytics"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={dbUser}
                  onChange={(e) => setDbUser(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Password
                </label>
                <input
                  type="password"
                  value={dbPassword}
                  onChange={(e) => setDbPassword(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={dbSsl}
                onChange={(e) => setDbSsl(e.target.checked)}
              />
              <span>Require SSL/TLS connection (recommended for cloud databases)</span>
            </label>

            {dbStatus && (
              <div
                className={`px-3 py-2 rounded-lg text-xs font-medium ${
                  dbStatus.ok
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                }`}
              >
                {dbStatus.text}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={dbTesting}
                onClick={handleTestDb}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {dbTesting ? "Testing..." : "Test Connection"}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDbModalOpen(false)}
                  className="px-3 py-2 text-xs text-slate-500 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dbSaving}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                >
                  {dbSaving ? "Connecting..." : "Save & Introspect"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
