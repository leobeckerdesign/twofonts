import { describe, expect, it } from "vitest";
import { generatePair, pairScore, splitCosine } from "../src/pairing";
import { indexFonts } from "../src/data";
import type { FontEntry, PairState } from "../src/types";

const F = (family: string, v: number[], category = "Sans Serif", weights = [400]): FontEntry =>
  ({ family, category, weights, v, x: 0, y: 0 });

const state = (over: Partial<PairState> = {}): PairState =>
  ({ a: "Base", b: "Igual", lockA: false, lockB: false, contrast: 0.5, text: "x", ...over });

describe("splitCosine", () => {
  it("separa componentes positivos e negativos do cosseno", () => {
    // a·b = 1*1 + 1*(-1) = pos 1, neg -1; normas = 2 → 0.5 / 0.5
    expect(splitCosine([1, 1], [1, -1])).toEqual({ pos: 0.5, neg: 0.5 });
  });
  it("idênticos: tudo positivo, nada negativo", () => {
    expect(splitCosine([1, 1], [1, 1])).toEqual({ pos: 1, neg: 0 });
  });
});

describe("pairScore", () => {
  const base = F("Base", [1, 1]);
  it("contrast=0 premia semelhança; contrast=1 premia oposição", () => {
    const igual = F("Igual", [1, 1]);
    const oposto = F("Oposto", [-1, -1]);
    expect(pairScore(base, igual, 0)).toBeGreaterThan(pairScore(base, oposto, 0));
    expect(pairScore(base, oposto, 1)).toBeGreaterThan(pairScore(base, igual, 1));
  });
  it("penaliza corpo pouco legível (Display) e sem peso 400", () => {
    const legivel = F("Legivel", [1, 0]);
    const display = F("Display", [1, 0], "Display");
    const sem400 = F("Sem400", [1, 0], "Sans Serif", [700]);
    expect(pairScore(base, legivel, 0.5)).toBeGreaterThan(pairScore(base, display, 0.5));
    expect(pairScore(base, legivel, 0.5)).toBeGreaterThan(pairScore(base, sem400, 0.5));
  });
});

describe("generatePair", () => {
  const db = indexFonts([
    F("Base", [1, 1]), F("Igual", [1, 1.1]), F("Oposto", [-1, -1]),
    F("Meio", [1, -1]), F("Outro", [0.9, 1]),
  ]);
  it("com ambos locks, devolve o par atual", () => {
    const s = state({ lockA: true, lockB: true });
    expect(generatePair(db, s)).toEqual({ a: "Base", b: "Igual" });
  });
  it("com lockA, mantém A e troca B (nunca devolve o B atual nem o próprio A)", () => {
    const s = state({ lockA: true });
    const out = generatePair(db, s, () => 0);
    expect(out.a).toBe("Base");
    expect(out.b).not.toBe("Igual");
    expect(out.b).not.toBe("Base");
  });
  it("com lockB, mantém B e troca A (nunca devolve o A atual nem o próprio B)", () => {
    const s = state({ lockB: true });
    const out = generatePair(db, s, () => 0);
    expect(out.b).toBe("Igual");
    expect(out.a).not.toBe("Base");
    expect(out.a).not.toBe("Igual");
  });
  it("é determinístico com rng injetado", () => {
    const s = state();
    expect(generatePair(db, s, () => 0)).toEqual(generatePair(db, s, () => 0));
  });

  it("pool vazio após exclusão: não lança, mantém o slot B atual em vez de repetir A (Finding 1)", () => {
    const tinyDb = indexFonts([F("Solo", [1, 1]), F("Only", [1, 1])]);
    const s = state({ a: "Solo", b: "Only", lockA: true });
    expect(() => generatePair(tinyDb, s, () => 0)).not.toThrow();
    const out = generatePair(tinyDb, s, () => 0);
    expect(out.a).toBe("Solo");
    expect(tinyDb.byFamily.has(out.b)).toBe(true);
    expect(out.a).not.toBe(out.b);
  });

  it("lock aponta para família ausente do DB: degrada para destravado, não lança (Finding 2)", () => {
    const s = state({ a: "Fantasma", b: "Igual", lockA: true, lockB: true });
    expect(() => generatePair(db, s, () => 0)).not.toThrow();
    const out = generatePair(db, s, () => 0);
    // lockB era válido e permanece respeitado; só o slot A (família inexistente) destrava
    expect(out.b).toBe("Igual");
    expect(out.a).not.toBe("Fantasma");
    expect(db.byFamily.has(out.a)).toBe(true);
    expect(out.a).not.toBe(out.b);
  });

  it("DB com exatamente 2 famílias, uma travada: escolhe sempre a outra, nunca repete a travada", () => {
    const twoDb = indexFonts([F("Um", [1, 0]), F("Dois", [0, 1])]);
    const s = state({ a: "Um", b: "Dois", lockA: true });
    for (const rngVal of [0, 0.5, 0.99]) {
      const out = generatePair(twoDb, s, () => rngVal);
      expect(out.a).toBe("Um");
      expect(out.b).toBe("Dois");
      expect(out.a).not.toBe(out.b);
    }
  });
});
