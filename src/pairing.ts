import type { FontDB } from "./data";
import type { FontEntry, PairState } from "./types";

const BODY_FRIENDLY = new Set(["Sans Serif", "Serif", "Monospace"]);
const TOP_K = 20;

export function splitCosine(a: number[], b: number[]): { pos: number; neg: number } {
  if (a.length === 0 || a.length !== b.length) {
    throw new Error("Vetores de fontes precisam ter a mesma dimensão não vazia");
  }

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
  const amount = Number.isFinite(contrast)
    ? Math.min(1, Math.max(0, contrast))
    : 0.5;
  let score = (1 - amount) * pos + amount * neg;
  if (!BODY_FRIENDLY.has(body.category)) score -= 0.15;
  if (!body.weights.includes(400)) score -= 0.05;
  return score;
}

function randomItem<T>(items: T[], rng: () => number): T {
  if (items.length === 0) throw new Error("Não há fontes disponíveis para o pairing");

  const value = rng();
  const normalized = Number.isFinite(value)
    ? Math.min(1 - Number.EPSILON, Math.max(0, value))
    : 0;
  return items[Math.floor(normalized * items.length)];
}

/** Nunca repete a fonte fixa; evita a seleção anterior quando houver opção. */
function pickTop(
  ranked: FontEntry[],
  disallow: Set<string>,
  avoid: Set<string>,
  rng: () => number,
): FontEntry {
  const allowed = ranked.filter((entry) => !disallow.has(entry.family));
  const fresh = allowed.filter((entry) => !avoid.has(entry.family));
  return randomItem((fresh.length > 0 ? fresh : allowed).slice(0, TOP_K), rng);
}

export function generatePair(
  db: FontDB, state: PairState, rng: () => number = Math.random,
): { a: string; b: string } {
  if (db.entries.length < 2) {
    throw new Error("O pairing requer ao menos duas famílias disponíveis");
  }

  const { a, b, contrast } = state;
  // Locks só valem se a família ainda existir no DB. PairState viaja pela
  // URL (link compartilhado); se o catálogo mudou e a família sumiu, trata
  // o slot como destravado em vez de lançar (fail closed).
  const entryA = db.byFamily.get(a);
  const entryB = db.byFamily.get(b);

  // Invariante: o par devolvido nunca repete a mesma família nos dois slots.
  // A seleção anterior é evitada quando há uma terceira opção, mas pode ser
  // mantida num catálogo de apenas duas famílias.
  const chooseB = (fixedA: FontEntry, currentB: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(fixedA, q, contrast) - pairScore(fixedA, p, contrast));
    return pickTop(ranked, new Set([fixedA.family]), new Set([currentB]), rng).family;
  };
  const chooseA = (fixedB: FontEntry, currentA: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(q, fixedB, contrast) - pairScore(p, fixedB, contrast));
    return pickTop(ranked, new Set([fixedB.family]), new Set([currentA]), rng).family;
  };

  if (state.lockA && entryA && state.lockB && entryB) return { a, b };
  if (state.lockA && entryA) return { a, b: chooseB(entryA, b) };
  if (state.lockB && entryB) return { a: chooseA(entryB, a), b };

  // nada travado (ou lock referenciava família ausente do DB): sorteia a
  // headline, escolhe o melhor corpo para ela
  const newAEntry = randomItem(db.entries, rng);
  return { a: newAEntry.family, b: chooseB(newAEntry, b) };
}
