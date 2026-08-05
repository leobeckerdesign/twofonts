import { describe, expect, it } from "vitest";
import { indexFonts } from "../src/data";

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
});
