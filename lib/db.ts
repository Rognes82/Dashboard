import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let dbInstance: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;
  const resolvedPath = dbPath ?? path.join(process.cwd(), "data", "dashboard.db");
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbInstance = new Database(resolvedPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDbForTesting(dbPath: string): Database.Database {
  closeDb();
  return getDb(dbPath);
}

const MIGRATION_FILE_RE = /^(\d+)-[\w-]+\.sql$/;

export function migrate(db: Database.Database, dir?: string): void {
  const migrationsDir = dir ?? path.join(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE_RE.test(f))
    .sort((a, b) => parseInt(a.match(MIGRATION_FILE_RE)![1], 10) - parseInt(b.match(MIGRATION_FILE_RE)![1], 10));
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const f of files) {
    const match = f.match(MIGRATION_FILE_RE);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (n <= current) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${n}`);
    }).immediate();
  }
}
