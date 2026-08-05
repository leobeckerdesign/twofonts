import { describe, expect, it } from "vitest";
import {
  CAMERA_EDGE_MARGIN,
  cameraBounds,
  constrainCamera,
  zoomTransform,
} from "../src/camera";

describe("zoomTransform", () => {
  it("preserva o ponto do mundo sob o foco no wheel", () => {
    const before = { x: -320, y: 140, scale: 0.5 };
    const focus = { x: 700, y: 450 };
    const worldPoint = {
      x: (focus.x - before.x) / before.scale,
      y: (focus.y - before.y) / before.scale,
    };

    const after = zoomTransform(before, focus, focus, 1.25);

    expect(after.x + worldPoint.x * after.scale).toBeCloseTo(focus.x);
    expect(after.y + worldPoint.y * after.scale).toBeCloseTo(focus.y);
  });

  it("acompanha a translação do centro do pinch sem mudar a escala", () => {
    const after = zoomTransform(
      { x: -100, y: -50, scale: 1 },
      { x: 300, y: 200 },
      { x: 345, y: 260 },
      1,
    );

    expect(after).toEqual({ x: -55, y: 10, scale: 1 });
  });

  it("combina mudança de centro e escala mantendo o foco correto", () => {
    const before = { x: 20, y: -80, scale: 0.5 };
    const oldCenter = { x: 200, y: 300 };
    const newCenter = { x: 240, y: 270 };
    const worldPoint = {
      x: (oldCenter.x - before.x) / before.scale,
      y: (oldCenter.y - before.y) / before.scale,
    };

    const after = zoomTransform(before, oldCenter, newCenter, 1);

    expect(after.x + worldPoint.x * after.scale).toBeCloseTo(newCenter.x);
    expect(after.y + worldPoint.y * after.scale).toBeCloseTo(newCenter.y);
  });
});

describe("cameraBounds / constrainCamera", () => {
  it("mantém o mundo inteiro visível quando ele cabe no viewport", () => {
    // WORLD * 0.15 = 600px.
    expect(cameraBounds(0.15, 1_000, 800)).toEqual({
      minX: 0,
      maxX: 400,
      minY: 0,
      maxY: 200,
    });
  });

  it("mantém uma margem visível quando o mundo é maior", () => {
    const bounds = cameraBounds(1, 1_000, 800);

    expect(bounds).toEqual({
      minX: 1_000 - 4_000 - CAMERA_EDGE_MARGIN,
      maxX: CAMERA_EDGE_MARGIN,
      minY: 800 - 4_000 - CAMERA_EDGE_MARGIN,
      maxY: CAMERA_EDGE_MARGIN,
    });
  });

  it("recalcula e clampa a posição para escala e viewport atuais", () => {
    expect(
      constrainCamera(
        { x: 9_999, y: -9_999, scale: 1 },
        1_000,
        800,
      ),
    ).toEqual({
      x: CAMERA_EDGE_MARGIN,
      y: 800 - 4_000 - CAMERA_EDGE_MARGIN,
      scale: 1,
    });
  });

  it("limita a margem à metade de viewports muito pequenos", () => {
    const bounds = cameraBounds(1, 100, 80);

    expect(bounds.maxX).toBe(50);
    expect(bounds.maxY).toBe(40);
  });
});
