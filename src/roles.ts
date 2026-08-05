import type { FontMeta, WeightRole } from "./types";

/** Categorias que aguentam texto corrido. Display e manuscrita não entram. */
const BODY_FRIENDLY = new Set(["Sans Serif", "Serif", "Monospace"]);

/** Razão entre corpo de título e corpo de texto nos extremos do slider. */
const SIZE_RATIO_MIN = 1.55;
const SIZE_RATIO_MAX = 3.4;

export interface Assignment {
  title: FontMeta;
  body: FontMeta;
  titleWeight: number;
  bodyWeight: number;
  /** true quando o par foi invertido em relação à ordem original */
  swapped: boolean;
}

export function canSetBody(font: FontMeta): boolean {
  return BODY_FRIENDLY.has(font.c);
}

/** Contraste de medida: harmonia aproxima os corpos, contraste os afasta. */
export function sizeRatio(contrast: number): number {
  const c = Number.isFinite(contrast) ? Math.min(1, Math.max(0, contrast)) : 0.5;
  return SIZE_RATIO_MIN + (SIZE_RATIO_MAX - SIZE_RATIO_MIN) * c;
}

function weightOf(font: FontMeta, role: WeightRole): number {
  const exact = font.w[role];
  if (exact !== undefined) return exact;
  const target = role === "light" ? 300 : role === "bold" ? 700 : 400;
  const available = Object.values(font.w).filter((w): w is number => typeof w === "number");
  if (available.length === 0) return 400;
  return available.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best));
}

/**
 * Distribui as duas fontes do par entre título e corpo.
 *
 * O par é simétrico, então alternamos por card para que as DUAS apareçam nos
 * dois papéis ao longo do campo. A legibilidade tem a última palavra: uma
 * display nunca fica com o texto corrido se a outra servir. Os pesos seguem o
 * PAPEL, não a fonte — quem está no título usa o peso de título da faixa.
 */
export function assignRoles(
  a: FontMeta,
  b: FontMeta,
  cardIndex: number,
  roles: [WeightRole, WeightRole],
): Assignment {
  let title = a;
  let body = b;
  let swapped = false;

  // Alterna a orientação para as duas fontes circularem pelos dois papéis.
  if (cardIndex % 2 === 1) {
    title = b;
    body = a;
    swapped = true;
  }

  // Corrige se a inversão jogou uma fonte inadequada no texto corrido.
  if (!canSetBody(body) && canSetBody(title)) {
    const t = title;
    title = body;
    body = t;
    swapped = !swapped;
  }

  return {
    title,
    body,
    titleWeight: weightOf(title, roles[0]),
    bodyWeight: weightOf(body, roles[1]),
    swapped,
  };
}
