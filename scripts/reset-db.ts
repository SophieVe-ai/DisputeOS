// Deletes the local SQLite database and the eval history. The app starts empty:
// cases are created by uploading documents (sample packs live in public/samples).
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/lib/config";
import { getDb } from "../src/lib/db";

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${config.databasePath}${suffix}`, { force: true });
}
fs.rmSync(path.join(process.cwd(), "data", "evals"), { recursive: true, force: true });
getDb();
console.log(`Database reset at ${config.databasePath} (empty).`);
