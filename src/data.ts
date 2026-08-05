import type { FontEntry } from "./types";

export interface FontDB {
  entries: FontEntry[];
  byFamily: Map<string, FontEntry>;
}

export function indexFonts(entries: FontEntry[]): FontDB {
  if (entries.length === 0) {
    throw new Error("O catálogo de fontes está vazio");
  }

  const byFamily = new Map<string, FontEntry>();
  for (const entry of entries) {
    if (byFamily.has(entry.family)) {
      throw new Error(`Família duplicada no catálogo: ${entry.family}`);
    }
    byFamily.set(entry.family, entry);
  }

  return { entries, byFamily };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Valida a fronteira externa antes de permitir que o catálogo entre no app. */
export function parseFontEntries(value: unknown): FontEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5_000) {
    throw new Error("fonts-map.json: catálogo ausente ou com tamanho inválido");
  }

  let dimensions: number | null = null;
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(`fonts-map.json: entrada ${index} inválida`);
    }

    const entry = candidate as Record<string, unknown>;
    const family = entry.family;
    const category = entry.category;
    const weights = entry.weights;
    const vector = entry.v;

    if (
      typeof family !== "string" ||
      family.trim().length === 0 ||
      family.length > 200 ||
      typeof category !== "string" ||
      category.trim().length === 0 ||
      category.length > 100 ||
      !Array.isArray(weights) ||
      weights.length === 0 ||
      !weights.every((weight) =>
        Number.isInteger(weight) && Number(weight) >= 1 && Number(weight) <= 1_000,
      ) ||
      !Array.isArray(vector) ||
      vector.length === 0 ||
      vector.length > 1_024 ||
      !vector.every(isFiniteNumber) ||
      !isFiniteNumber(entry.x) ||
      !isFiniteNumber(entry.y) ||
      entry.x < 0 ||
      entry.x > 1 ||
      entry.y < 0 ||
      entry.y > 1
    ) {
      throw new Error(`fonts-map.json: entrada ${index} possui campos inválidos`);
    }

    dimensions ??= vector.length;
    if (vector.length !== dimensions) {
      throw new Error(`fonts-map.json: vetor inconsistente na entrada ${index}`);
    }
  }

  return value as FontEntry[];
}

export async function loadFontDB(url = "/fonts-map.json"): Promise<FontDB> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fonts-map.json: HTTP ${res.status}`);
  return indexFonts(parseFontEntries(await res.json()));
}
