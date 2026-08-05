import { describe, expect, it } from "vitest";
import {
  WORLD,
  lodForScale,
  lodWithHysteresis,
  screenPos,
  visibleEntries,
} from "../src/map/lod";

const view = { x: 0, y: 0, scale: 1, w: 1000, h: 800 };

describe("lodForScale", () => {
  it("mapeia zoom para níveis de detalhe", () => {
    expect(lodForScale(0.2)).toBe("dot");
    expect(lodForScale(0.7)).toBe("name");
    expect(lodForScale(2.0)).toBe("card");
  });

  it("usa histerese para não oscilar nos thresholds", () => {
    expect(lodWithHysteresis(0.49, "dot")).toBe("dot");
    expect(lodWithHysteresis(0.52, "dot")).toBe("name");
    expect(lodWithHysteresis(1.1, "dot")).toBe("card");
    expect(lodWithHysteresis(0.46, "name")).toBe("name");
    expect(lodWithHysteresis(0.43, "name")).toBe("dot");
    expect(lodWithHysteresis(0.92, "card")).toBe("card");
    expect(lodWithHysteresis(0.85, "card")).toBe("name");
    expect(lodWithHysteresis(0.4, "card")).toBe("dot");
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
