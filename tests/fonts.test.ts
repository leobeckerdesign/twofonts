import { describe, expect, it } from "vitest";
import { fontCssUrl } from "../src/fonts";

describe("fontCssUrl", () => {
  it("monta a URL css2 com peso e display=swap", () => {
    expect(fontCssUrl("Playfair Display", 700)).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap",
    );
  });

  it("anexa subset text= urlencoded quando fornecido", () => {
    expect(fontCssUrl("Lora", 400, "Aa é")).toContain("&text=Aa%20%C3%A9");
  });

  it("codifica caracteres que poderiam quebrar a query", () => {
    const url = fontCssUrl("Fonte & Outra", 400);
    expect(url).toContain("family=Fonte+%26+Outra:wght@400");
    expect(new URL(url).searchParams.getAll("family")).toHaveLength(1);
  });

  it("normaliza peso inválido e ignora subset vazio", () => {
    expect(fontCssUrl("Lora", Number.NaN, "")).toBe(
      "https://fonts.googleapis.com/css2?family=Lora:wght@400&display=swap",
    );
  });
});
