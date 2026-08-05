import { describe, expect, it } from "vitest";
import { bucketFor, fontByFamily, pickPair, weightFor, weightRoles } from "../src/pairs";
import type { PairsData } from "../src/types";

const data: PairsData = {
  version: 1,
  fonts: [
    { f: "Alfa", c: "Sans Serif", w: { light: 300, regular: 400, bold: 700 } },
    { f: "Beta", c: "Serif", w: { regular: 400, bold: 700 } },
    { f: "Gama", c: "Display", w: { regular: 400 } },
  ],
  buckets: [
    { c: 0, roles: ["regular", "regular"], pairs: [[0, 1]] },
    { c: 1, roles: ["bold", "light"], pairs: [[0, 2], [1, 2]] },
  ],
};

describe("bucketFor", () => {
  it("escolhe a faixa mais próxima do contraste pedido", () => {
    expect(bucketFor(data, 0)).toBe(0);
    expect(bucketFor(data, 0.4)).toBe(0);
    expect(bucketFor(data, 0.9)).toBe(1);
  });

  it("valor inválido ou fora da faixa não quebra a escolha", () => {
    expect(bucketFor(data, Number.NaN)).toBe(0);
    expect(bucketFor(data, 5)).toBe(1);
    expect(bucketFor(data, -2)).toBe(0);
  });
});

describe("weightRoles", () => {
  it("harmonia usa dois regulares; contraste opõe bold e light", () => {
    expect(weightRoles(data, 0)).toEqual(["regular", "regular"]);
    expect(weightRoles(data, 1)).toEqual(["bold", "light"]);
  });
});

describe("pickPair", () => {
  it("devolve um par da faixa correspondente", () => {
    expect(pickPair(data, 0, undefined, () => 0)).toEqual({ a: "Alfa", b: "Beta" });
  });

  it("evita repetir o par atual quando há alternativa", () => {
    const next = pickPair(data, 1, { a: "Alfa", b: "Gama" }, () => 0);
    expect(next).toEqual({ a: "Beta", b: "Gama" });
  });

  it("mantém o par quando ele é a única opção da faixa", () => {
    expect(pickPair(data, 0, { a: "Alfa", b: "Beta" }, () => 0)).toEqual({ a: "Alfa", b: "Beta" });
  });

  it("é determinístico com rng injetado", () => {
    expect(pickPair(data, 1, undefined, () => 0.99)).toEqual(pickPair(data, 1, undefined, () => 0.99));
  });

  it("devolve null em faixa vazia em vez de par inválido", () => {
    const vazio: PairsData = { ...data, buckets: [{ c: 0, roles: ["regular", "regular"], pairs: [] }] };
    expect(pickPair(vazio, 0)).toBeNull();
  });
});

describe("weightFor", () => {
  it("usa o peso exato quando a família o tem", () => {
    expect(weightFor(fontByFamily(data, "Alfa"), "light")).toBe(300);
    expect(weightFor(fontByFamily(data, "Alfa"), "bold")).toBe(700);
  });

  it("cai para o peso mais próximo quando o papel não existe", () => {
    // Beta não tem light: 400 está mais perto de 300 que 700.
    expect(weightFor(fontByFamily(data, "Beta"), "light")).toBe(400);
    expect(weightFor(fontByFamily(data, "Gama"), "bold")).toBe(400);
  });

  it("família desconhecida não quebra o chamador", () => {
    expect(weightFor(undefined, "bold")).toBe(400);
  });
});
