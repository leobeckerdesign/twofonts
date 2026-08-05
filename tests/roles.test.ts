import { describe, expect, it } from "vitest";
import { assignRoles, canSetBody, sizeRatio } from "../src/roles";
import type { FontMeta } from "../src/types";

const sans: FontMeta = { f: "Alfa", c: "Sans Serif", w: { light: 300, regular: 400, bold: 700 } };
const serif: FontMeta = { f: "Beta", c: "Serif", w: { regular: 400, bold: 700 } };
const display: FontMeta = { f: "Gama", c: "Display", w: { regular: 400 } };

describe("canSetBody", () => {
  it("só aceita categorias que aguentam texto corrido", () => {
    expect(canSetBody(sans)).toBe(true);
    expect(canSetBody(serif)).toBe(true);
    expect(canSetBody(display)).toBe(false);
  });
});

describe("sizeRatio", () => {
  it("cresce com o contraste", () => {
    expect(sizeRatio(1)).toBeGreaterThan(sizeRatio(0));
  });

  it("clampa entrada inválida sem devolver NaN", () => {
    expect(Number.isFinite(sizeRatio(Number.NaN))).toBe(true);
    expect(sizeRatio(9)).toBe(sizeRatio(1));
    expect(sizeRatio(-9)).toBe(sizeRatio(0));
  });
});

describe("assignRoles", () => {
  const roles = ["bold", "light"] as const;

  it("alterna os papéis entre cards para as duas fontes circularem", () => {
    const par = assignRoles(sans, serif, 0, [...roles]);
    const impar = assignRoles(sans, serif, 1, [...roles]);
    expect(par.title.f).toBe("Alfa");
    expect(impar.title.f).toBe("Beta");
    expect(impar.swapped).toBe(true);
  });

  it("nunca deixa uma display no texto corrido se a outra servir", () => {
    for (const index of [0, 1, 2, 3]) {
      const a = assignRoles(display, sans, index, [...roles]);
      expect(a.body.f).toBe("Alfa");
      expect(a.title.f).toBe("Gama");
    }
  });

  it("mantém a ordem quando nenhuma das duas serve para corpo", () => {
    const outra: FontMeta = { f: "Delta", c: "Handwriting", w: { regular: 400 } };
    const a = assignRoles(display, outra, 0, [...roles]);
    expect(a.title.f).toBe("Gama");
    expect(a.body.f).toBe("Delta");
  });

  it("o peso segue o papel, não a fonte", () => {
    const par = assignRoles(sans, serif, 0, [...roles]);
    const impar = assignRoles(sans, serif, 1, [...roles]);
    // Quem está no título usa o peso de título da faixa (bold) nos dois casos.
    expect(par.titleWeight).toBe(700);
    expect(impar.titleWeight).toBe(700);
    // Beta não tem light: cai para o mais próximo (400).
    expect(par.bodyWeight).toBe(400);
    expect(impar.bodyWeight).toBe(300);
  });
});
