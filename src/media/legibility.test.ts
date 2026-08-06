import { describe, expect, it } from "vitest";
import type { CardKind } from "../spec";
import {
  contrastRatio,
  hexToRgb,
  luminanceBand,
  MIN_RATIO,
  PALETTES,
  relativeLuminance,
} from "./legibility";

const KINDS: CardKind[] = ["paper", "ink", "accent"];

/** Menor cor cinza cuja luminância relativa atinge o alvo. */
function grayAt(target: number): [number, number, number] {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (relativeLuminance([mid, mid, mid]) < target) lo = mid;
    else hi = mid;
  }
  return [hi, hi, hi];
}

describe("legibilidade", () => {
  it("calcula contraste de acordo com a WCAG", () => {
    const white = hexToRgb(0xffffff);
    const black = hexToRgb(0x000000);
    // Extremos da escala: 21:1 é o teto definido pela fórmula.
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // Simétrico: a ordem dos argumentos não pode importar.
    expect(contrastRatio(white, black)).toBeCloseTo(contrastRatio(black, white), 10);
  });

  it("aponta a faixa para o lado oposto ao texto", () => {
    // Texto escuro sobre papel: o shader não pode escurecer sem limite.
    const [paperLo, paperHi] = luminanceBand("paper");
    expect(paperHi).toBe(1);
    expect(paperLo).toBeGreaterThan(0);

    // Texto claro sobre tinta: o shader não pode clarear sem limite.
    const [inkLo, inkHi] = luminanceBand("ink");
    expect(inkLo).toBe(0);
    expect(inkHi).toBeLessThan(1);
  });

  it("garante o mínimo de contraste no PIOR ponto de cada faixa", () => {
    for (const kind of KINDS) {
      const { text } = PALETTES[kind];
      const [lo, hi] = luminanceBand(kind);
      const lText = relativeLuminance(text);

      // O pior caso é a borda da faixa mais próxima da cor do texto.
      const worst = lText > (lo + hi) / 2 ? grayAt(hi) : grayAt(lo);
      const ratio = contrastRatio(worst, text);

      expect(ratio, `${kind} no pior ponto da faixa`).toBeGreaterThanOrEqual(MIN_RATIO);
    }
  });

  it("mantém o próprio fundo do card dentro da faixa", () => {
    for (const kind of KINDS) {
      const l = relativeLuminance(PALETTES[kind].bg);
      const [lo, hi] = luminanceBand(kind);
      // Se o fundo já violasse a faixa, a trava distorceria o card parado.
      expect(l, `${kind}: fundo fora da faixa [${lo.toFixed(3)}, ${hi.toFixed(3)}]`)
        .toBeGreaterThanOrEqual(lo - 1e-9);
      expect(l).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("dá contraste suficiente entre fundo e texto de cada card, antes de shader", () => {
    for (const kind of KINDS) {
      const { bg, text } = PALETTES[kind];
      expect(contrastRatio(bg, text), `${kind}`).toBeGreaterThanOrEqual(MIN_RATIO);
    }
  });
});
