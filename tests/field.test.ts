import { describe, expect, it } from "vitest";
import { categoryColor, selectDetailedPoints, visibleFieldPoints } from "../src/map/field";
import type { FontEntry } from "../src/types";

function entry(family: string, x: number, y: number): FontEntry {
  return { family, x, y, category: "Serif", weights: [400], v: [1] };
}

describe("font field", () => {
  const view = { x: 0, y: 0, scale: 1, w: 4000, h: 4000 };

  it("mantém somente pontos dentro do viewport", () => {
    const points = visibleFieldPoints([
      entry("center", 0.5, 0.5),
      entry("outside", 2, 2),
    ], view, 0);
    expect(points.map((point) => point.entry.family)).toEqual(["center"]);
  });

  it("prioriza o par ativo e depois a proximidade do centro", () => {
    const points = visibleFieldPoints([
      entry("near", 0.51, 0.5),
      entry("far-active", 0.9, 0.9),
      entry("far", 0.8, 0.8),
    ], view);
    const selected = selectDetailedPoints(points, new Set(["far-active"]), 2);
    expect(selected.map((point) => point.entry.family)).toEqual(["far-active", "near"]);
  });

  it("respeita um budget de detalhes igual a zero", () => {
    const points = visibleFieldPoints([entry("center", 0.5, 0.5)], view);
    expect(selectDetailedPoints(points, new Set(), 0)).toEqual([]);
  });

  it("usa uma paleta estável com fallback", () => {
    expect(categoryColor("Serif")).toBe("#ffc36a");
    expect(categoryColor("Unknown")).toBe("#c5c2ba");
  });
});
