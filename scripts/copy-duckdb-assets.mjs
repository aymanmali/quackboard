import fs from "node:fs";
import path from "node:path";

const sourceDir = path.resolve(
  process.cwd(),
  "node_modules/@duckdb/duckdb-wasm/dist"
);
const targetDir = path.resolve(process.cwd(), "public/duckdb");

const filesToCopy = [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
];

if (!fs.existsSync(sourceDir)) {
  console.log("[copy-duckdb-assets] @duckdb/duckdb-wasm not installed yet, skipping.");
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const file of filesToCopy) {
  const src = path.join(sourceDir, file);
  const dest = path.join(targetDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

console.log("[copy-duckdb-assets] Copied DuckDB-Wasm bundles to public/duckdb/");
