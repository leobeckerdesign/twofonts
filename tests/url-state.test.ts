import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, decodeState, encodeState } from "../src/url-state";

describe("url-state", () => {
  it("faz roundtrip completo", () => {
    const s = { a: "Lora", b: "Inter", lockA: true, lockB: false, contrast: 0.7, text: "Olá" };
    expect(decodeState(encodeState(s))).toEqual(s);
  });

  it("querystring vazia devolve o default", () => {
    expect(decodeState("")).toEqual(DEFAULT_STATE);
  });

  it("clampa contraste inválido e ignora params desconhecidos", () => {
    const s = decodeState("c=7&zzz=1");
    expect(s.contrast).toBe(1);
    expect(decodeState("c=abc").contrast).toBe(DEFAULT_STATE.contrast);
  });

  it("trata contraste vazio e famílias vazias como defaults", () => {
    expect(decodeState("c=&a=%20&b=")).toMatchObject({
      a: DEFAULT_STATE.a,
      b: DEFAULT_STATE.b,
      contrast: DEFAULT_STATE.contrast,
    });
  });

  it("limita texto vindo de uma URL hostil", () => {
    expect(decodeState(`t=${"x".repeat(2_000)}`).text).toHaveLength(500);
  });
});
