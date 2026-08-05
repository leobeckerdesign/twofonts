import { describe, expect, it } from "vitest";
import { activeScreenOffsets, selectInteractiveEntries } from "../src/map/cards";
import type { FontEntry } from "../src/types";

function font(family: string, x: number, y: number): FontEntry {
  return { family, x, y, category: "Serif", weights: [400], v: [1] };
}

describe("selectInteractiveEntries", () => {
  const view = { x: 0, y: 0, scale: 0.2, w: 1000, h: 800 };

  it("mantém somente o par ativo no overview", () => {
    const entries = [font("A", 0.2, 0.2), font("B", 0.3, 0.3), font("C", 0.4, 0.4)];
    expect(selectInteractiveEntries(entries, view, new Set(["B"]), "dot", 2))
      .toEqual([entries[1]]);
  });

  it("respeita budget, prioriza ativos e evita colisões", () => {
    const entries = [
      font("near", 0.5, 0.5),
      font("same-cell", 0.51, 0.5),
      font("active", 0.9, 0.8),
      font("other", 0.1, 0.1),
    ];
    const selected = selectInteractiveEntries(entries, view, new Set(["active"]), "name", 3);
    expect(selected[0].family).toBe("active");
    expect(selected).toHaveLength(3);
    expect(selected.map((entry) => entry.family)).not.toEqual(
      expect.arrayContaining(["near", "same-cell"]),
    );
  });

  it("evita sobreposição mesmo quando as origens caem em células vizinhas", () => {
    const entries = [
      font("left-boundary", 0.18625, 0.2),
      font("right-boundary", 0.18875, 0.2),
      font("separate", 0.7, 0.7),
    ];

    const selected = selectInteractiveEntries(entries, view, new Set(), "name", 3);
    const families = selected.map((entry) => entry.family);

    expect(families).toContain("separate");
    expect(families).not.toEqual(
      expect.arrayContaining(["left-boundary", "right-boundary"]),
    );
  });

  it("não seleciona elementos quando o budget é zero", () => {
    expect(selectInteractiveEntries([font("A", 0.5, 0.5)], view, new Set(), "name", 0))
      .toEqual([]);
  });

  it("separa o par ativo pela ordem espacial e pela largura em tela", () => {
    const zoomed = { x: 0, y: 0, scale: 1.55, w: 6200, h: 6200 };
    const left = font("left", 0.5, 0.5);
    const right = font("right", 0.5001, 0.5);
    const offsets = activeScreenOffsets(
      [right, left],
      zoomed,
      new Set(["left", "right"]),
      "card",
    );
    const leftX = left.x * 4000 * zoomed.scale + (offsets.get("left") ?? 0);
    const rightX = right.x * 4000 * zoomed.scale + (offsets.get("right") ?? 0);

    expect(offsets.get("left")).toBeLessThan(0);
    expect(offsets.get("right")).toBeGreaterThan(0);
    expect(rightX - leftX).toBeGreaterThan(218 * zoomed.scale);
  });

  it("considera os offsets ativos ao bloquear cards vizinhos", () => {
    const full = { x: 0, y: 0, scale: 1, w: 4000, h: 4000 };
    const entries = [
      font("active-a", 0.5, 0.5),
      font("active-b", 0.5, 0.5),
      font("shifted-neighbor", 0.425, 0.5),
      font("far", 0.2, 0.2),
    ];
    const selected = selectInteractiveEntries(
      entries,
      full,
      new Set(["active-a", "active-b"]),
      "card",
      3,
    );

    expect(selected.map((entry) => entry.family)).toEqual([
      "active-a",
      "active-b",
      "far",
    ]);
  });
});
