// Deletes the local SQLite database and re-seeds the demo cases.
import fs from "node:fs";
import { config } from "../src/lib/config";
import { getDb } from "../src/lib/db";
import { seedDemoData } from "../src/lib/seed";

for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${config.databasePath}${suffix}`, { force: true });
}
getDb();
const n = seedDemoData();
console.log(`Database reset at ${config.databasePath} — seeded ${n} demo cases.`);
