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

/** Nunca inventa fallback fora do exclude set: se o pool (top-K já
 *  filtrado pelo exclude) se esgota, devolve undefined — nunca `ranked[0]`,
 *  que ignoraria o próprio exclude (Finding: podia devolver a família
 *  travada, gerando a === b). Quem chama decide o que fazer com undefined
 *  (generatePair mantém o valor atual do slot). Nunca lança. */
function pickTop(
  ranked: FontEntry[], exclude: Set<string>, rng: () => number,
): FontEntry | undefined {
  const filtered = ranked.filter((e) => !exclude.has(e.family));
  const pool = filtered.slice(0, TOP_K);
  if (pool.length > 0) return pool[Math.floor(rng() * pool.length)];
  return undefined;
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

  // Invariante: o par devolvido nunca repete a mesma família nos dois slots,
  // a menos que o DB tenha menos de 2 famílias utilizáveis (caso degenerado,
  // fora de escopo). chooseA/chooseB sempre excluem a família do slot fixo
  // do pool candidato; quando o pool se esgota, mantém o valor atual do
  // slot (currentA/currentB) em vez de devolver algo fora do exclude set.
  const chooseB = (fixedA: FontEntry, currentB: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(fixedA, q, contrast) - pairScore(fixedA, p, contrast));
    const picked = pickTop(ranked, new Set([fixedA.family, currentB]), rng);
    return picked ? picked.family : currentB;
  };
  const chooseA = (fixedB: FontEntry, currentA: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(q, fixedB, contrast) - pairScore(p, fixedB, contrast));
    const picked = pickTop(ranked, new Set([fixedB.family, currentA]), rng);
    return picked ? picked.family : currentA;
  };

  if (state.lockA && entryA && state.lockB && entryB) return { a, b };
  if (state.lockA && entryA) return { a, b: chooseB(entryA, b) };
  if (state.lockB && entryB) return { a: chooseA(entryB, a), b };

  // nada travado (ou lock referenciava família ausente do DB): sorteia a
  // headline, escolhe o melhor corpo para ela
  const newAEntry = db.entries[Math.floor(rng() * db.entries.length)];
  return { a: newAEntry.family, b: chooseB(newAEntry, b) };
}
