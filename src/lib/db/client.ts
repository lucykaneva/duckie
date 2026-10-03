import { Pool } from "pg";

const globalForPg = globalThis as unknown as { duckPool?: Pool };

/**
 * Shared pg pool (Tiger Data). Reused across hot reloads in dev.
 * Tiger Cloud's cert chain is not in Node's trust store, so sslmode=require
 * uses libpq semantics (encrypted, chain not verified), as Tiger's docs do.
 */
export function getPool(): Pool {
  if (!globalForPg.duckPool) {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL is not set");
    const url = new URL(raw);
    if (url.searchParams.get("sslmode") === "require") {
      url.searchParams.set("uselibpqcompat", "true");
    }
    globalForPg.duckPool = new Pool({ connectionString: url.toString(), max: 5 });
  }
  return globalForPg.duckPool;
}
