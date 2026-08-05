import { afterEach, describe, expect, it, vi } from "vitest";
import { indexFonts, loadFontDB, parseFontEntries } from "../src/data";

const fixture = [
  { family: "Lora", category: "Serif", weights: [400, 700], v: [0.1, -0.2], x: 0.5, y: 0.5 },
  { family: "Inter", category: "Sans Serif", weights: [400], v: [0.3, 0.1], x: 0.2, y: 0.8 },
];

describe("indexFonts", () => {
  it("indexa por família e preserva a lista", () => {
    const db = indexFonts(fixture);
    expect(db.entries).toHaveLength(2);
    expect(db.byFamily.get("Lora")?.category).toBe("Serif");
    expect(db.byFamily.get("Nope")).toBeUndefined();
  });

  it("rejeita catálogo vazio e famílias duplicadas", () => {
    expect(() => indexFonts([])).toThrow(/vazio/);
    expect(() => indexFonts([fixture[0], fixture[0]])).toThrow(/duplicada/);
  });
});

describe("parseFontEntries", () => {
  it("valida shape, coordenadas e dimensões dos vetores", () => {
    expect(parseFontEntries(fixture)).toEqual(fixture);
    expect(() => parseFontEntries([{ ...fixture[0], x: 2 }])).toThrow(/campos inválidos/);
    expect(() => parseFontEntries([fixture[0], { ...fixture[1], v: [0.2] }]))
      .toThrow(/vetor inconsistente/);
  });
});

describe("loadFontDB", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falha fechado em erro HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(loadFontDB()).rejects.toThrow("HTTP 503");
  });

  it("valida o JSON antes de indexar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ family: "quebrada" }],
    }));
    await expect(loadFontDB()).rejects.toThrow(/campos inválidos/);
  });
});
