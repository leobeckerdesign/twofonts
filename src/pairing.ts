import type { FontDB } from "./data";
import type { FontEntry, PairState } from "./types";

const BODY_FRIENDLY = new Set(["Sans Serif", "Serif"]);
const TOP_K = 20;

export function splitCosine(a: number[], b: number[]): { pos: number; neg: number } {
  let pos = 0, neg = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] * b[i];
    if (p >= 0) pos += p; else neg += p;
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const norm = Math.sqrt(na * nb) || 1;
  return { pos: pos / norm, neg: -neg / norm + 0 };
}

/** Score do par: contraste modula entre semelhança (pos) e oposição (neg);
 *  o slot body leva penalidade de legibilidade — é a releitura direta da
 *  métrica do fontjoy (cosseno decomposto em metades). */
export function pairScore(headline: FontEntry, body: FontEntry, contrast: number): number {
  const { pos, neg } = splitCosine(headline.v, body.v);
  let score = (1 - contrast) * pos + contrast * neg;
  if (!BODY_FRIENDLY.has(body.category)) score -= 0.15;
  if (!body.weights.includes(400)) score -= 0.05;
  return score;
}

/** Nunca devolve undefined (fail closed): pool filtrado > lista completa
 *  menos exclude > melhor entrada do ranking geral, nessa ordem. */
function pickTop(
  ranked: FontEntry[], exclude: Set<string>, rng: () => number,
): FontEntry {
  const filtered = ranked.filter((e) => !exclude.has(e.family));
  const pool = filtered.slice(0, TOP_K);
  if (pool.length > 0) return pool[Math.floor(rng() * pool.length)];
  if (filtered.length > 0) return filtered[Math.floor(rng() * filtered.length)];
  return ranked[0];
}

export function generatePair(
  db: FontDB, state: PairState, rng: () => number = Math.random,
): { a: string; b: string } {
  const { a, b, contrast } = state;
  // Locks só valem se a família ainda existir no DB. PairState viaja pela
  // URL (link compartilhado); se o catálogo mudou e a família sumiu, trata
  // o slot como destravado em vez de lançar (fail closed).
  const entryA = db.byFamily.get(a);
  const entryB = db.byFamily.get(b);

  const chooseB = (fixedA: FontEntry, excludeB: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(fixedA, q, contrast) - pairScore(fixedA, p, contrast));
    return pickTop(ranked, new Set([fixedA.family, excludeB]), rng).family;
  };
  const chooseA = (fixedB: FontEntry, excludeA: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(q, fixedB, contrast) - pairScore(p, fixedB, contrast));
    return pickTop(ranked, new Set([fixedB.family, excludeA]), rng).family;
  };

  if (state.lockA && entryA && state.lockB && entryB) return { a, b };
  if (state.lockA && entryA) return { a, b: chooseB(entryA, b) };
  if (state.lockB && entryB) return { a: chooseA(entryB, a), b };

  // nada travado (ou lock referenciava família ausente do DB): sorteia a
  // headline, escolhe o melhor corpo para ela
  const newAEntry = db.entries[Math.floor(rng() * db.entries.length)];
  return { a: newAEntry.family, b: chooseB(newAEntry, b) };
}
