import type { AppState, FontMeta, PairBucket, PairsData, WeightRole } from "./types";

/** Índice da faixa cujo contraste está mais próximo do valor pedido. */
export function bucketFor(data: PairsData, contrast: number): number {
  const target = Number.isFinite(contrast) ? Math.min(1, Math.max(0, contrast)) : 0.5;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < data.buckets.length; i++) {
    const distance = Math.abs(data.buckets[i].c - target);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** Papéis de peso que a faixa ativa impõe — é aqui que o contraste vira peso. */
export function weightRoles(data: PairsData, contrast: number): [WeightRole, WeightRole] {
  const bucket = data.buckets[bucketFor(data, contrast)];
  return bucket?.roles ?? ["regular", "regular"];
}

/**
 * Sorteia um par da faixa, evitando repetir o atual. Devolve null quando a
 * faixa está vazia — o chamador decide o que fazer, nunca recebe lixo.
 */
export function pickPair(
  data: PairsData,
  contrast: number,
  current?: { a: string; b: string },
  rng: () => number = Math.random,
): { a: string; b: string } | null {
  const bucket: PairBucket | undefined = data.buckets[bucketFor(data, contrast)];
  if (!bucket || bucket.pairs.length === 0) return null;

  const named = bucket.pairs
    .map(([i, j]) => ({ a: data.fonts[i]?.f, b: data.fonts[j]?.f }))
    .filter((p): p is { a: string; b: string } => Boolean(p.a && p.b));
  if (named.length === 0) return null;

  const fresh = current
    ? named.filter((p) => !(p.a === current.a && p.b === current.b))
    : named;
  const pool = fresh.length > 0 ? fresh : named;

  const roll = rng();
  const normalized = Number.isFinite(roll) ? Math.min(1 - Number.EPSILON, Math.max(0, roll)) : 0;
  return pool[Math.floor(normalized * pool.length)];
}

/**
 * Todos os pares da faixa ativa — é o que a prateleira oferece. A lista vem
 * inteira; quem controla o custo é a prateleira, que carrega as fontes em lotes.
 */
export function pairsIn(data: PairsData, contrast: number): { a: FontMeta; b: FontMeta }[] {
  const bucket = data.buckets[bucketFor(data, contrast)];
  if (!bucket) return [];

  const out: { a: FontMeta; b: FontMeta }[] = [];
  for (const [i, j] of bucket.pairs) {
    const a = data.fonts[i];
    const b = data.fonts[j];
    if (a && b) out.push({ a, b });
  }
  return out;
}

export function fontByFamily(data: PairsData, family: string): FontMeta | undefined {
  return data.fonts.find((f) => f.f === family);
}

/** Peso real para um papel, caindo para o mais próximo que a família tem. */
export function weightFor(font: FontMeta | undefined, role: WeightRole): number {
  if (!font) return 400;
  const exact = font.w[role];
  if (exact !== undefined) return exact;
  const target = role === "light" ? 300 : role === "bold" ? 700 : 400;
  const available = Object.values(font.w).filter((w): w is number => typeof w === "number");
  if (available.length === 0) return 400;
  return available.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best));
}

export async function loadPairs(url = "/pairs.json"): Promise<PairsData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pairs.json: HTTP ${res.status}`);
  const data = (await res.json()) as PairsData;
  if (!Array.isArray(data.fonts) || !Array.isArray(data.buckets)) {
    throw new Error("pairs.json com formato inesperado");
  }
  return data;
}

/** Estado inicial válido, com o par vindo da faixa pedida. */
export function initialState(data: PairsData, contrast: number): AppState | null {
  const pair = pickPair(data, contrast);
  return pair ? { ...pair, contrast } : null;
}
