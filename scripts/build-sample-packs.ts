// Writes each fixture case out as raw files under public/samples/<pack>/ so the demo
// enters through the real upload path instead of pre-seeded data. Re-run after editing fixtures.
import fs from "node:fs";
import path from "node:path";
import { FIXTURE_CASES } from "../src/lib/fixtures/cases";
import type { DocKind } from "../src/lib/types";

const ROOT = path.join(process.cwd(), "public", "samples");
const EXT: Record<DocKind, string> = { contract: "txt", invoice: "txt", delivery_note: "txt", payment: "txt", correspondence: "eml", other: "txt" };
const PACKS: Record<string, { slug: string; name: string; description: string }> = {
  "case-harbour-kestrel": { slug: "kestrel", name: "Harbour Joinery v Kestrel Developments", description: "Kitchen units. A damage claim raised in time and a quality complaint raised far too late." },
  "case-northbank-lumen": { slug: "lumen", name: "Northbank Print v Lumen Events", description: "Event print run. A clean, signed-for debt the customer keeps deferring." },
  "case-peak-ashford": { slug: "ashford", name: "Peak Catering v Ashford Hotel Group", description: "Catering consumables. We overcharged and short-delivered: the agents should say so." },
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const index = [{ slug: "meridian", ...JSON.parse(fs.readFileSync(path.join(ROOT, "meridian", "manifest.json"), "utf8")) }];
for (const fixture of FIXTURE_CASES) {
  const pack = PACKS[fixture.id];
  const dir = path.join(ROOT, pack.slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = fixture.documents.map((d, i) => {
    const name = `${String(i + 1).padStart(2, "0")}-${slugify(d.title)}.${EXT[d.kind]}`;
    fs.writeFileSync(path.join(dir, name), `${d.content.trim()}\n`);
    return name;
  });
  const manifest = { name: pack.name, description: pack.description, files };
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  index.push({ slug: pack.slug, ...manifest });
}
fs.writeFileSync(path.join(ROOT, "index.json"), `${JSON.stringify(index.map(({ slug, name, description, files }) => ({ slug, name, description, documents: files.length })), null, 2)}\n`);
console.log(`Wrote ${index.length} sample packs to ${ROOT}`);
