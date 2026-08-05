import { describe, expect, it } from "vitest";
import { DEFAULT_CONTRAST, decodeState, encodeState } from "../src/url-state";

describe("url-state", () => {
  it("faz roundtrip do par e do contraste", () => {
    const state = { a: "Playfair Display", b: "Inter", contrast: 0.75 };
    expect(decodeState(encodeState(state))).toEqual({
      a: "Playfair Display", b: "Inter", contrast: 0.75,
    });
  });

  it("preserva acentos e espaços no nome da família", () => {
    const state = { a: "Bricolage Grotesque", b: "Fraunces", contrast: 0 };
    expect(decodeState(encodeState(state)).a).toBe("Bricolage Grotesque");
  });

  it("devolve famílias nulas quando ausentes, para quem chama validar", () => {
    const decoded = decodeState("c=0.3");
    expect(decoded.a).toBeNull();
    expect(decoded.b).toBeNull();
    expect(decoded.contrast).toBe(0.3);
  });

  it("contraste vazio ou em branco cai no padrão, não em zero", () => {
    // Number("") é 0: sem tratamento, um link truncado viraria harmonia total.
    expect(decodeState("c=").contrast).toBe(DEFAULT_CONTRAST);
    expect(decodeState("c=%20").contrast).toBe(DEFAULT_CONTRAST);
    expect(decodeState("c=abc").contrast).toBe(DEFAULT_CONTRAST);
  });

  it("clampa contraste fora da faixa e preserva os extremos válidos", () => {
    expect(decodeState("c=7").contrast).toBe(1);
    expect(decodeState("c=-3").contrast).toBe(0);
    expect(decodeState("c=0").contrast).toBe(0);
    expect(decodeState("c=1").contrast).toBe(1);
  });

  it("usa a primeira ocorrência de um parâmetro repetido", () => {
    expect(decodeState("a=Lora&a=Inter&zzz=1&c=0.5").a).toBe("Lora");
  });
});
