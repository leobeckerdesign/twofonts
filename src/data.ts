import type { FontEntry } from "./types";

export interface FontDB {
  entries: FontEntry[];
  byFamily: Map<string, FontEntry>;
}

export function indexFonts(entries: FontEntry[]): FontDB {
  return { entries, byFamily: new Map(entries.map((e) => [e.family, e])) };
}

export async function loadFontDB(url = "/fonts-map.json"): Promise<FontDB> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fonts-map.json: HTTP ${res.status}`);
  return indexFonts(await res.json());
}
