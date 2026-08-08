import { describe, expect, it } from "vitest";
import spec from "./layouts.json";
import { clashes, sequence, toneOf } from "./sequence";
import type { CardSpec, LayoutsFile } from "./spec";

/**
 * A regra: nunca dois brancos chapados juntos, nunca dois pretos chapados
 * juntos. Aqui ela é INVARIANTE, não "deu certo com o baralho de hoje" — os
 * casos sintéticos cobrem proporções que o arquivo atual não tem.
 */

const FILE = spec as LayoutsFile;

const card = (id: string, kind: CardSpec["kind"], backdrop = false): CardSpec => ({
  id,
  kind,
  w: 400,
  bodyScale: 1,
  titleScale: 1,
  blocks: backdrop
    ? [{ type: "image", src: "/x.jpg", flow: "absolute", inset: [0, 0, 0, 0] }]
    : [{ type: "title", text: "x" }],
});

/**
 * Vizinhos que violam a regra, contando a COSTURA.
 *
 * O campo é um laço (`gsap.utils.wrap` em field.ts), então o último card
 * encosta no primeiro. Medir só a fila deixaria esse par de fora — e ele é tão
 * visível quanto qualquer outro.
 */
const violations = (cards: CardSpec[]): string[] => {
  const out: string[] = [];
  for (let i = 1; i < cards.length; i++) {
    if (clashes(cards[i - 1], cards[i])) out.push(`${cards[i - 1].id}|${cards[i].id}`);
  }
  if (cards.length > 2 && clashes(cards[cards.length - 1], cards[0])) {
    out.push(`costura ${cards[cards.length - 1].id}|${cards[0].id}`);
  }
  return out;
};

/** Permutação: mesmos cards, mesma quantidade, sem inventar nem perder. */
const isPermutation = (a: CardSpec[], b: CardSpec[]): boolean =>
  a.length === b.length &&
  [...a].map((c) => c.id).sort().join() === [...b].map((c) => c.id).sort().join();

describe("sequência por contraste", () => {
  it("separa o tom chapado do tom com foto por baixo", () => {
    // O que faz a regra ser satisfazível: foto e cinza não são extremo chapado.
    expect(toneOf(card("a", "paper"))).toBe(1);
    expect(toneOf(card("b", "ink"))).toBe(0);
    expect(toneOf(card("c", "accent"))).toBe(0.55);
    expect(toneOf(card("d", "ink", true))).toBeGreaterThan(0);
    expect(toneOf(card("e", "paper", true))).toBeLessThan(1);

    // Banda não é fundo: o `nome` tem foto, mas o card atrás segue preto.
    const banda = card("f", "ink");
    banda.blocks = [{ type: "image", src: "/x.jpg", h: 199, bleed: true }];
    expect(toneOf(banda)).toBe(0);
  });

  it("não deixa dois brancos nem dois pretos juntos no baralho real", () => {
    const ordered = sequence(FILE.cards);
    expect(isPermutation(ordered, FILE.cards)).toBe(true);
    expect(violations(ordered), "vizinhos do mesmo extremo chapado").toEqual([]);
  });

  it("melhora de verdade — a ordem do arquivo violava a regra", () => {
    // Sem isto o teste acima passaria mesmo se `sequence` fosse a identidade.
    expect(violations(FILE.cards).length).toBeGreaterThan(0);
  });

  it("segura em proporções que o arquivo de hoje não tem", () => {
    const decks: [string, CardSpec[]][] = [
      ["só claros e escuros equilibrados", [
        card("p1", "paper"), card("p2", "paper"), card("p3", "paper"),
        card("i1", "ink"), card("i2", "ink"), card("i3", "ink"),
      ]],
      ["muito preto, com foto de sobra", [
        card("i1", "ink"), card("i2", "ink"), card("i3", "ink"), card("i4", "ink"),
        card("f1", "ink", true), card("f2", "ink", true), card("f3", "ink", true),
        card("p1", "paper"),
      ]],
      // 4 brancos num ciclo exigem 4 separadores, então o baralho tem de ter
      // pelo menos 4 não-brancos. Com 3 seria impossível, não difícil.
      ["muito branco", [
        card("p1", "paper"), card("p2", "paper"), card("p3", "paper"), card("p4", "paper"),
        card("g", "accent"), card("f", "paper", true), card("i", "ink"), card("f2", "ink", true),
      ]],
      ["um cinza no meio de extremos", [
        card("p1", "paper"), card("p2", "paper"), card("g", "accent"),
        card("i1", "ink"), card("i2", "ink"),
      ]],
    ];

    for (const [nome, deck] of decks) {
      const ordered = sequence(deck);
      expect(isPermutation(ordered, deck), `${nome}: perdeu ou duplicou card`).toBe(true);
      expect(violations(ordered), `${nome}`).toEqual([]);
    }
  });

  /**
   * Baralho escolhido a dedo não prova nada: prova o que eu já imaginei. Aqui a
   * afirmação é contra o LIMITE TEÓRICO — sempre que a regra for satisfazível
   * (nenhum extremo passa de ⌈n/2⌉, senão faltam separadores), o algoritmo tem
   * de chegar a zero violações.
   */
  it("fecha a volta: o último card não pode chocar com o primeiro", () => {
    const ordered = sequence(FILE.cards);
    expect(clashes(ordered[ordered.length - 1], ordered[0]), "costura do laço").toBe(false);
  });

  it("chega a zero sempre que a regra é possível, em 3000 baralhos sorteados", () => {
    // PRNG próprio: `Math.random` deixaria a falha irreproduzível.
    let seed = 0xc0ffee;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    let possiveis = 0;
    for (let round = 0; round < 3000; round++) {
      const n = 3 + Math.floor(rand() * 18);
      const deck: CardSpec[] = [];
      for (let i = 0; i < n; i++) {
        const r = rand();
        deck.push(
          r < 0.4 ? card(`w${i}`, "paper")
            : r < 0.8 ? card(`b${i}`, "ink")
              : r < 0.9 ? card(`g${i}`, "accent")
                : card(`f${i}`, "ink", true),
        );
      }

      const ordered = sequence(deck);
      expect(isPermutation(ordered, deck), `baralho ${round}: perdeu card`).toBe(true);

      const brancos = deck.filter((c) => toneOf(c) === 1).length;
      const pretos = deck.filter((c) => toneOf(c) === 0).length;
      // Teto do CICLO, não da fila: num laço cada extremo precisa de separador
      // dos dois lados, então o limite é ⌊n/2⌋ e não ⌈n/2⌉.
      const teto = Math.floor(n / 2);
      if (brancos <= teto && pretos <= teto) {
        possiveis++;
        expect(
          violations(ordered),
          `baralho ${round} (n=${n} brancos=${brancos} pretos=${pretos})`,
        ).toEqual([]);
      }
    }
    // Se o sorteio quase nunca cair no caso possível, o teste não testou nada.
    expect(possiveis).toBeGreaterThan(500);
  });

  it("é determinística: repintar não pode reembaralhar o campo", () => {
    const a = sequence(FILE.cards).map((c) => c.id);
    const b = sequence(FILE.cards).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it("não quebra com baralho degenerado", () => {
    expect(sequence([])).toEqual([]);
    const um = [card("a", "ink")];
    expect(sequence(um).map((c) => c.id)).toEqual(["a"]);
    // Só pretos: a regra é impossível, mas não pode perder card nem estourar.
    const sos = [card("i1", "ink"), card("i2", "ink"), card("i3", "ink")];
    expect(isPermutation(sequence(sos), sos)).toBe(true);
  });
});
