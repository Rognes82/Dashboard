import { getDb, migrate } from "../lib/db";
import fs from "fs";
import path from "path";

function initDb(): void {
  const db = getDb();
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
  console.log("Database initialized at data/dashboard.db");
}

initDb();
