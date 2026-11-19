import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { dataSources } from "@/db/schema";
import { DataSourceConfig } from "@/lib/query/types";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { LiveDbCredentials } from "./server-sql";

interface StoredSource extends DataSourceConfig {
  encryptedPassword: string;
}

// Fallback in-memory registry when DATABASE_URL is not configured (zero-config local dev)
const memorySources = new Map<string, StoredSource>();

export async function listServerSources(): Promise<DataSourceConfig[]> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(dataSources);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as "postgres" | "mysql",
      host: r.host,
      port: r.port,
      database: r.database,
      username: r.username,
      ssl: r.ssl,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  return Array.from(memorySources.values()).map(({ encryptedPassword: _ignored, ...pub }) => {
    void _ignored;
    return pub;
  });
}

export async function saveServerSource(params: {
  name: string;
  creds: LiveDbCredentials;
}): Promise<DataSourceConfig> {
  const id = `src-${crypto.randomUUID().slice(0, 8)}`;
  const encryptedPassword = encryptSecret(params.creds.password);
  const createdAt = new Date();

  const db = getDb();
  if (db) {
    await db.insert(dataSources).values({
      id,
      name: params.name,
      kind: params.creds.kind,
      host: params.creds.host,
      port: params.creds.port,
      database: params.creds.database,
      username: params.creds.username,
      encryptedPassword,
      ssl: params.creds.ssl,
      createdAt,
    });
  } else {
    memorySources.set(id, {
      id,
      name: params.name,
      kind: params.creds.kind,
      host: params.creds.host,
      port: params.creds.port,
      database: params.creds.database,
      username: params.creds.username,
      ssl: params.creds.ssl,
      encryptedPassword,
      createdAt: createdAt.toISOString(),
    });
  }

  return {
    id,
    name: params.name,
    kind: params.creds.kind,
    host: params.creds.host,
    port: params.creds.port,
    database: params.creds.database,
    username: params.creds.username,
    ssl: params.creds.ssl,
    createdAt: createdAt.toISOString(),
  };
}

export async function getServerSourceCredentials(id: string): Promise<LiveDbCredentials | null> {
  const db = getDb();
  if (db) {
    const rows = await db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      kind: row.kind as "postgres" | "mysql",
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password: decryptSecret(row.encryptedPassword),
      ssl: row.ssl,
    };
  }

  const found = memorySources.get(id);
  if (!found) return null;
  return {
    kind: found.kind,
    host: found.host,
    port: found.port,
    database: found.database,
    username: found.username,
    password: decryptSecret(found.encryptedPassword),
    ssl: found.ssl,
  };
}

export async function deleteServerSource(id: string): Promise<void> {
  const db = getDb();
  if (db) {
    await db.delete(dataSources).where(eq(dataSources.id, id));
    return;
  }
  memorySources.delete(id);
}
