import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_COLUMNS,
  ATLAS_TILE_SIZE,
  COMPACT_ATLAS,
  atlasBackgroundPosition,
  atlasSourceRect,
  preferredFontAtlas,
} from "../src/map/atlas";

afterEach(() => vi.unstubAllGlobals());

describe("font atlas", () => {
  it("mapeia o índice para o tile correto", () => {
    expect(atlasSourceRect(0)).toEqual({
      x: 0,
      y: 0,
      width: ATLAS_TILE_SIZE,
      height: ATLAS_TILE_SIZE,
    });
    expect(atlasSourceRect(ATLAS_COLUMNS + 2)).toMatchObject({
      x: ATLAS_TILE_SIZE * 2,
      y: ATLAS_TILE_SIZE,
    });
  });

  it("gera posições CSS estáveis inclusive nas bordas", () => {
    expect(atlasBackgroundPosition(0)).toEqual({ x: "0%", y: "0%" });
    expect(atlasBackgroundPosition(ATLAS_COLUMNS - 1).x).toBe("100%");
    expect(atlasBackgroundPosition(ATLAS_COLUMNS * ATLAS_COLUMNS - 1)).toEqual({
      x: "100%",
      y: "100%",
    });
  });

  it("falha de forma segura para índices inválidos", () => {
    expect(atlasSourceRect(-1)).toEqual(atlasSourceRect(0));
    expect(atlasBackgroundPosition(Number.NaN)).toEqual({ x: "0%", y: "0%" });
  });

  it("seleciona o atlas compacto em viewports móveis", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(preferredFontAtlas()).toEqual(COMPACT_ATLAS);
  });
});
