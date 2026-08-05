import { describe, expect, it } from "vitest";
import { WORLD, lodForScale, screenPos, visibleEntries } from "../src/map/lod";

const view = { x: 0, y: 0, scale: 1, w: 1000, h: 800 };

describe("lodForScale", () => {
  it("mapeia zoom para níveis de detalhe", () => {
    expect(lodForScale(0.2)).toBe("dot");
    expect(lodForScale(1.0)).toBe("name");
    expect(lodForScale(2.0)).toBe("card");
  });
});

describe("screenPos / visibleEntries", () => {
  it("projeta mundo→tela", () => {
    expect(screenPos({ x: 0.5, y: 0.5 }, view)).toEqual({ sx: WORLD / 2, sy: WORLD / 2 });
    expect(screenPos({ x: 0, y: 0 }, { ...view, x: 100, y: 50 })).toEqual({ sx: 100, sy: 50 });
  });

  it("filtra só o que está no viewport (com margem)", () => {
    const inside = { x: 0.1, y: 0.1 };
    const outside = { x: 0.9, y: 0.9 };
    const near = { x: 0.26, y: 0.1 };
    expect(visibleEntries([inside, outside, near], view, 200)).toEqual([inside, near]);
  });
});
