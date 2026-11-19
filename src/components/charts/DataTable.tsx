"use client";

import React, { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  ColumnDef,
} from "@tanstack/react-table";
import { ArrowUpDown, Download, Search } from "lucide-react";
import { formatNumericValue, humanizeFieldName } from "@/lib/charts/echarts-builder";
import { NumberFormat, QueryResult } from "@/lib/query/types";

interface DataTableProps {
  result: QueryResult;
  numberFormat?: NumberFormat;
  compact?: boolean;
}

export function exportQueryResultToCsv(result: QueryResult, fileName = "quackboard-export.csv") {
  const escapeCsv = (val: unknown) => {
    const str = val === null || val === undefined ? "" : String(val);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const header = result.columns.map(escapeCsv).join(",");
  const body = result.rows
    .map((row) => result.columns.map((c) => escapeCsv(row[c])).join(","))
    .join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataTable({ result, numberFormat = "auto", compact = false }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      result.columns.map((col) => ({
        accessorKey: col,
        header: () => humanizeFieldName(col),
        cell: (info) => {
          const val = info.getValue();
          if (typeof val === "number") {
            return (
              <span className="font-mono text-right block">
                {formatNumericValue(val, numberFormat)}
              </span>
            );
          }
          return <span className="truncate block max-w-[260px]">{String(val ?? "—")}</span>;
        },
      })),
    [result.columns, numberFormat]
  );

  const table = useReactTable({
    data: result.rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: compact ? 10 : 25 },
    },
  });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter rows..."
            className="w-full pl-8 pr-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>
            {table.getFilteredRowModel().rows.length.toLocaleString()} rows • {result.executionMs} ms
          </span>
          <button
            type="button"
            onClick={() => exportQueryResultToCsv(result)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800/95 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="px-3 py-2 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-200/70 dark:hover:bg-slate-700/70"
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <ArrowUpDown className="w-3 h-3 opacity-50" />
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-blue-50/50 dark:hover:bg-slate-800/50 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-3 py-1.5 whitespace-nowrap text-slate-700 dark:text-slate-200"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
