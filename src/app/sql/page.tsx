"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, Loader2, Play, Table2, Terminal } from "lucide-react";
import { Dataset, QueryResult } from "@/lib/query/types";
import { executeAdHocSql } from "@/lib/engines/query-runner";
import { listDatasets } from "@/lib/storage/indexeddb-store";
import { DataTable } from "@/components/charts/DataTable";

export default function SqlLabPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [sql, setSql] = useState(
    `SELECT\n  region,\n  category,\n  COUNT(*) AS orders,\n  ROUND(SUM(sales), 2) AS total_sales,\n  ROUND(SUM(profit), 2) AS total_profit\nFROM "superstore"\nGROUP BY 1, 2\nORDER BY total_sales DESC\nLIMIT 50;`
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDatasets().then((ds) => {
      setDatasets(ds);
      if (ds[0]) setSelectedId(ds[0].id);
    });
  }, []);

  const activeDataset = datasets.find((d) => d.id === selectedId);

  const handleRun = async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await executeAdHocSql({
        dataset: activeDataset,
        sql,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SQL execution failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-[calc(100vh-3.5rem)] max-w-[1600px] w-full mx-auto">
      {/* Left Schema Explorer */}
      <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Active Dataset
          </label>
          <select
            value={selectedId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedId(id);
              const ds = datasets.find((d) => d.id === id);
              if (ds) {
                setSql(`SELECT *\nFROM "${ds.tableName}"\nLIMIT 100;`);
              }
            }}
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
          >
            {datasets.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name} ({ds.dialect})
              </option>
            ))}
          </select>
        </div>

        {activeDataset && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <Table2 className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-mono">{activeDataset.tableName}</span>
            </div>
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {activeDataset.columns.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setSql((prev) => `${prev} "${c.name}"`)}
                  className="w-full flex items-center justify-between text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-xs cursor-pointer"
                >
                  <span className="font-mono text-slate-700 dark:text-slate-200 truncate">
                    {c.name}
                  </span>
                  <span className="text-[10px] uppercase text-slate-400">{c.type}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main Editor + Results */}
      <section className="flex-1 flex flex-col min-w-0 p-4 gap-4 bg-slate-50 dark:bg-slate-950">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
              <Terminal className="w-4 h-4 text-blue-600" />
              <span>Read-Only SQL Lab</span>
              <span className="text-[11px] font-normal text-slate-400">(⌘/Ctrl + Enter to run)</span>
            </div>
            <button
              type="button"
              onClick={handleRun}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run Query
            </button>
          </div>
          <textarea
            rows={8}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleRun();
              }
            }}
            spellCheck={false}
            className="w-full p-4 font-mono text-xs sm:text-sm bg-slate-950 text-slate-100 focus:outline-none resize-y"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 min-h-[320px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col">
          {result ? (
            <DataTable result={result} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
              Run a query above to inspect results and export CSV.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
