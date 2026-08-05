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

function pickTop(
  ranked: FontEntry[], exclude: Set<string>, rng: () => number,
): FontEntry {
  const pool = ranked.filter((e) => !exclude.has(e.family)).slice(0, TOP_K);
  return pool[Math.floor(rng() * pool.length)];
}

export function generatePair(
  db: FontDB, state: PairState, rng: () => number = Math.random,
): { a: string; b: string } {
  const { a, b, lockA, lockB, contrast } = state;
  if (lockA && lockB) return { a, b };

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

  if (lockA) return { a, b: chooseB(db.byFamily.get(a)!, b) };
  if (lockB) return { a: chooseA(db.byFamily.get(b)!, a), b };

  // nada travado: sorteia a headline, escolhe o melhor corpo para ela
  const newA = db.entries[Math.floor(rng() * db.entries.length)].family;
  return { a: newA, b: chooseB(db.byFamily.get(newA)!, b) };
}
