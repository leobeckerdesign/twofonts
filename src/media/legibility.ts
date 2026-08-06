import type { CardKind } from "../spec";

/**
 * Legibilidade como restrição, não como gosto.
 *
 * Um shader de fundo não pode caminhar na direção da cor do texto que vai por
 * cima. Aqui a regra vira número: dada a cor do texto do card e a razão de
 * contraste exigida, sai a FAIXA de luminância em que o shader tem permissão de
 * variar. O shader recebe essa faixa como uniform e trava dentro dela.
 *
 * Referência: WCAG 2.2, razão de contraste (L1 + 0.05) / (L2 + 0.05).
 */

export type Rgb = readonly [number, number, number];

/** Alvo usado para CALCULAR a faixa. Fica acima do mínimo exigido, de margem. */
const TARGET_RATIO = 5.0;

/** Mínimo que a verificação empírica precisa encontrar. AA para texto corrido. */
export const MIN_RATIO = 4.5;

export const hexToRgb = (hex: number): Rgb => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

/** Linearização sRGB de verdade, não a aproximação por gama 2.2. */
const toLinear = (c: number): number =>
  c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

export const relativeLuminance = ([r, g, b]: Rgb): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface CardPalette {
  /** fundo do card */
  bg: Rgb;
  /** cor do texto que vai por cima do shader */
  text: Rgb;
  /** tom vizinho, para onde o campo caminha */
  near: Rgb;
  /** destaque, usado com parcimônia no topo do campo */
  accent: Rgb;
}

/**
 * Tons VIZINHOS de propósito. Misturar papel com tinta direto dava contraste
 * que brigava com o texto em vez de sustentar. O destaque entra só na crista.
 */
export const PALETTES: Record<CardKind, CardPalette> = {
  paper: {
    bg: hexToRgb(0xe9e5dd),
    text: hexToRgb(0x131310),
    near: hexToRgb(0xd6cfc0),
    accent: hexToRgb(0xf05524),
  },
  ink: {
    bg: hexToRgb(0x131310),
    text: hexToRgb(0xe9e5dd),
    near: hexToRgb(0x24241d),
    accent: hexToRgb(0x8a3a18),
  },
  accent: {
    bg: hexToRgb(0xf05524),
    text: hexToRgb(0x14120f),
    near: hexToRgb(0xd8481c),
    accent: hexToRgb(0xffb08a),
  },
};

/**
 * Faixa de luminância permitida ao shader, em [lo, hi].
 *
 * Texto escuro obriga o fundo a permanecer claro; texto claro obriga o
 * contrário. A faixa é sempre um lado só: o shader pode se afastar da cor do
 * texto à vontade, e aproximar-se só até o limite do contraste.
 */
export function luminanceBand(kind: CardKind, ratio = TARGET_RATIO): [number, number] {
  const { text, bg } = PALETTES[kind];
  const lText = relativeLuminance(text);
  const lBg = relativeLuminance(bg);

  if (lBg >= lText) {
    // Fundo claro, texto escuro: não pode escurecer além do limite.
    return [Math.min(1, ratio * (lText + 0.05) - 0.05), 1];
  }
  // Fundo escuro, texto claro: não pode clarear além do limite.
  return [0, Math.max(0, (lText + 0.05) / ratio - 0.05)];
}
