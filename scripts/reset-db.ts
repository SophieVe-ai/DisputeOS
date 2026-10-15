// Resets the local embedded (PGlite) database. The app starts empty: cases are created by
// uploading documents (sample packs live in public/samples). Refuses to touch a real
// Postgres (DATABASE_URL): wiping production is never one command away.
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/lib/config";
import { openDb } from "../src/lib/db";

async function main() {
  if (config.databaseUrl) {
    console.error("DATABASE_URL is set: refusing to reset a hosted database. Unset it to reset the local PGlite database.");
    process.exit(1);
  }
  fs.rmSync(config.databasePath, { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), "data", "disputeos.db"), { force: true }); // pre-Postgres SQLite file, if any
  const db = await openDb(config.databasePath);
  await db.close();
  console.log(`Database reset at ${config.databasePath} (empty).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
