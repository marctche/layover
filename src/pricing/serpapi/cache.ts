// Disk cache of raw responses, keyed by the request without the API key.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SearchParams } from "./client";

export const DEFAULT_CACHE_DIR = ".cache/serpapi";
/** Prices go stale; an older entry is treated as absent. */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CacheEntry {
  text: string;
  fetchedAt: string;
}

export interface SearchCache {
  get(params: SearchParams): CacheEntry | null;
  put(params: SearchParams, entry: CacheEntry): void;
}

export function cacheKey(params: SearchParams): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "api_key")
    .sort()
    .map((k) => [k, params[k]]);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

export function diskCache(dir = DEFAULT_CACHE_DIR, opts: { maxAgeMs?: number; now?: () => number } = {}): SearchCache {
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = opts.now ?? Date.now;
  const fileOf = (params: SearchParams) => path.join(dir, `${cacheKey(params)}.json`);
  return {
    get(params) {
      try {
        const entry = JSON.parse(readFileSync(fileOf(params), "utf8")) as Partial<CacheEntry>;
        if (typeof entry.text !== "string" || typeof entry.fetchedAt !== "string") return null;
        const age = now() - Date.parse(entry.fetchedAt);
        return Number.isFinite(age) && age <= maxAge ? { text: entry.text, fetchedAt: entry.fetchedAt } : null;
      } catch {
        return null;
      }
    },
    put(params, entry) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(fileOf(params), JSON.stringify({ fetchedAt: entry.fetchedAt, text: entry.text }));
    },
  };
}
