import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

function loadEnvFile(filename: string) {
  const file = path.join(process.cwd(), filename);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function migrate() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (add it to .env or .env.local)");
  }

  // No argument: build the whole schema. With a path: run just that SQL file.
  const file = process.argv[2] ?? "src/lib/db/schema.sql";
  const schemaPath = path.resolve(process.cwd(), file);
  const sql = readFileSync(schemaPath, "utf8");
  // Strip comments first so a ";" inside a comment cannot split a statement.
  const statements = sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  // Tiger Cloud's cert chain is not in Node's trust store. Use libpq semantics
  // for sslmode=require (encrypted, chain not verified), as Tiger's docs do.
  const url = new URL(connectionString);
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("uselibpqcompat", "true");
  }

  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
    console.log(`Migration applied (${statements.length} statements).`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

migrate().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
