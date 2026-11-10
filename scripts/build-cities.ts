// Builds src/data/cities.json from the public GeoNames cities15000 dump (CC BY 4.0),
// keeping cities with population >= 100000. Run: pnpm build-cities
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ZIP = "https://download.geonames.org/export/dump/cities15000.zip";
const MIN_POPULATION = 100_000;

const dir = mkdtempSync(join(tmpdir(), "cities-"));
const zipPath = join(dir, "cities15000.zip");
const res = await fetch(URL_ZIP);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir]);
const lines = readFileSync(join(dir, "cities15000.txt"), "utf8").split("\n");

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const cities = [];
for (const line of lines) {
  if (!line) continue;
  // geonameid, name, asciiname, alternatenames, lat, lng, class, code, country, ..., population (index 14)
  const c = line.split("\t");
  const population = Number(c[14]);
  if (!(population >= MIN_POPULATION)) continue;
  cities.push({
    id: c[0],
    name: c[1],
    asciiName: c[2],
    country: regions.of(c[8] ?? "") ?? c[8],
    lat: Number(c[4]),
    lng: Number(c[5]),
    population,
  });
}
cities.sort((a, b) => b.population - a.population);
writeFileSync(join(import.meta.dirname, "..", "src", "data", "cities.json"), JSON.stringify(cities) + "\n");
console.log(`Wrote ${cities.length} cities`);
