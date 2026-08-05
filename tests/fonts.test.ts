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
});
