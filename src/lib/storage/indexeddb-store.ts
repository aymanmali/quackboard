"use client";

import { openDB, IDBPDatabase } from "idb";
import { Dashboard, Dataset, SavedChart } from "../query/types";
import { SAMPLE_DATASET, STARTER_CHARTS, STARTER_DASHBOARD } from "./seed";

const DB_NAME = "quackboard-local-v1";
const DB_VERSION = 1;

interface QuackBoardSchema {
  datasets: { key: string; value: Dataset };
  files: { key: string; value: { id: string; bytes: Uint8Array } };
  charts: { key: string; value: SavedChart };
  dashboards: { key: string; value: Dashboard };
  meta: { key: string; value: { key: string; value: unknown } };
}

let dbPromise: Promise<IDBPDatabase<QuackBoardSchema>> | null = null;

function getLocalDb() {
  if (!dbPromise) {
    dbPromise = openDB<QuackBoardSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("datasets")) {
          db.createObjectStore("datasets", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("charts")) {
          db.createObjectStore("charts", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("dashboards")) {
          db.createObjectStore("dashboards", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

export async function ensureSeeded(): Promise<void> {
  const db = await getLocalDb();
  const seeded = await db.get("meta", "seeded_v1");
  if (seeded) return;

  const tx = db.transaction(["datasets", "charts", "dashboards", "meta"], "readwrite");
  await tx.objectStore("datasets").put(SAMPLE_DATASET);
  for (const chart of STARTER_CHARTS) {
    await tx.objectStore("charts").put(chart);
  }
  await tx.objectStore("dashboards").put(STARTER_DASHBOARD);
  await tx.objectStore("meta").put({ key: "seeded_v1", value: true });
  await tx.done;
}

// Datasets
export async function listDatasets(): Promise<Dataset[]> {
  await ensureSeeded();
  const db = await getLocalDb();
  const all = await db.getAll("datasets");
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDataset(id: string): Promise<Dataset | undefined> {
  await ensureSeeded();
  const db = await getLocalDb();
  return db.get("datasets", id);
}

export async function saveDataset(dataset: Dataset, fileBytes?: Uint8Array): Promise<void> {
  const db = await getLocalDb();
  await db.put("datasets", dataset);
  if (fileBytes) {
    await db.put("files", { id: dataset.id, bytes: fileBytes });
  }
}

export async function getDatasetFileBytes(id: string): Promise<Uint8Array | null> {
  const db = await getLocalDb();
  const rec = await db.get("files", id);
  return rec?.bytes ?? null;
}

export async function deleteDataset(id: string): Promise<void> {
  const db = await getLocalDb();
  await db.delete("datasets", id);
  await db.delete("files", id);
}

// Charts
export async function listCharts(): Promise<SavedChart[]> {
  await ensureSeeded();
  const db = await getLocalDb();
  const all = await db.getAll("charts");
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChart(id: string): Promise<SavedChart | undefined> {
  await ensureSeeded();
  const db = await getLocalDb();
  return db.get("charts", id);
}

export async function saveChart(chart: SavedChart): Promise<void> {
  const db = await getLocalDb();
  await db.put("charts", chart);
}

export async function deleteChart(id: string): Promise<void> {
  const db = await getLocalDb();
  await db.delete("charts", id);
}

// Dashboards
export async function listDashboards(): Promise<Dashboard[]> {
  await ensureSeeded();
  const db = await getLocalDb();
  const all = await db.getAll("dashboards");
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDashboard(id: string): Promise<Dashboard | undefined> {
  await ensureSeeded();
  const db = await getLocalDb();
  return db.get("dashboards", id);
}

export async function saveDashboard(dashboard: Dashboard): Promise<void> {
  const db = await getLocalDb();
  await db.put("dashboards", dashboard);
}

export async function deleteDashboard(id: string): Promise<void> {
  const db = await getLocalDb();
  await db.delete("dashboards", id);
}

// Portable .quackboard.json export & import
export interface DashboardExportBundle {
  format: "quackboard-dashboard-v1";
  exportedAt: string;
  dashboard: Dashboard;
  charts: SavedChart[];
}

export async function exportDashboardBundle(dashboardId: string): Promise<DashboardExportBundle> {
  const dashboard = await getDashboard(dashboardId);
  if (!dashboard) throw new Error("Dashboard not found");
  const allCharts = await listCharts();
  const chartIds = new Set(dashboard.tiles.map((t) => t.chartId).filter(Boolean));
  const charts = allCharts.filter((c) => chartIds.has(c.id));

  return {
    format: "quackboard-dashboard-v1",
    exportedAt: new Date().toISOString(),
    dashboard,
    charts,
  };
}

export async function importDashboardBundle(bundle: DashboardExportBundle): Promise<Dashboard> {
  if (bundle.format !== "quackboard-dashboard-v1" || !bundle.dashboard) {
    throw new Error("Invalid QuackBoard dashboard file format.");
  }
  const now = new Date().toISOString();
  const newDashId = `dash-${crypto.randomUUID().slice(0, 8)}`;
  const chartIdMap = new Map<string, string>();

  for (const ch of bundle.charts ?? []) {
    const newChartId = `chart-${crypto.randomUUID().slice(0, 8)}`;
    chartIdMap.set(ch.id, newChartId);
    await saveChart({
      ...ch,
      id: newChartId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const imported: Dashboard = {
    ...bundle.dashboard,
    id: newDashId,
    name: `${bundle.dashboard.name} (Imported)`,
    tiles: bundle.dashboard.tiles.map((t) => ({
      ...t,
      chartId: t.chartId ? chartIdMap.get(t.chartId) ?? t.chartId : undefined,
    })),
    createdAt: now,
    updatedAt: now,
  };

  await saveDashboard(imported);
  return imported;
}
