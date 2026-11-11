// Builds src/data/airports.json from the OurAirports airports.csv (public domain), keeping
// airports with an IATA code, scheduled service, and type large or medium.
// Run: pnpm build-airports
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const URL_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv";

/** Minimal RFC 4180 parser: quoted fields may contain commas, newlines and doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const res = await fetch(URL_CSV);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const [header, ...rows] = parseCsv(await res.text());
if (!header) throw new Error("Empty CSV");
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Missing column ${name}`);
  return i;
};
const I = {
  type: col("type"),
  name: col("name"),
  lat: col("latitude_deg"),
  lng: col("longitude_deg"),
  country: col("iso_country"),
  city: col("municipality"),
  scheduled: col("scheduled_service"),
  iata: col("iata_code"),
};

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const seen = new Set<string>();
const airports = [];
for (const r of rows) {
  const iata = (r[I.iata] ?? "").trim().toUpperCase();
  const type = r[I.type];
  if (!/^[A-Z]{3}$/.test(iata) || r[I.scheduled] !== "yes") continue;
  if (type !== "large_airport" && type !== "medium_airport") continue;
  if (seen.has(iata)) continue;
  seen.add(iata);
  const iso = r[I.country] ?? "";
  airports.push({
    iata,
    name: r[I.name] ?? "",
    city: r[I.city] ?? "",
    country: regions.of(iso) ?? iso,
    lat: Number(r[I.lat]),
    lng: Number(r[I.lng]),
    size: type === "large_airport" ? "large" : "medium",
  });
}
airports.sort((a, b) => (a.size === b.size ? a.name.localeCompare(b.name) : a.size === "large" ? -1 : 1));
writeFileSync(join(import.meta.dirname, "..", "src", "data", "airports.json"), JSON.stringify(airports) + "\n");
console.log(`Wrote ${airports.length} airports`);
