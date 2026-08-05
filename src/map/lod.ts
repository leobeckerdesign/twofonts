export const WORLD = 4000;

export type LOD = "dot" | "name" | "card";

export interface View {
  x: number;
  y: number;
  scale: number;
  w: number;
  h: number;
}

export function lodForScale(scale: number): LOD {
  if (scale < 0.48) return "dot";
  if (scale < 0.95) return "name";
  return "card";
}

/** Avoids rebuilding the DOM when zoom oscillates around a LOD boundary. */
export function lodWithHysteresis(scale: number, previous: LOD | null): LOD {
  if (previous === null) return lodForScale(scale);
  if (previous === "dot") {
    if (scale >= 1) return "card";
    return scale >= 0.52 ? "name" : "dot";
  }
  if (previous === "name") {
    if (scale < 0.44) return "dot";
    if (scale >= 1) return "card";
    return "name";
  }
  if (scale < 0.44) return "dot";
  return scale < 0.86 ? "name" : "card";
}

export function screenPos(
  e: { x: number; y: number },
  view: View,
): { sx: number; sy: number } {
  return {
    sx: e.x * WORLD * view.scale + view.x,
    sy: e.y * WORLD * view.scale + view.y,
  };
}

export function visibleEntries<T extends { x: number; y: number }>(
  entries: readonly T[],
  view: View,
  pad = 200,
): T[] {
  return entries.filter((e) => {
    const { sx, sy } = screenPos(e, view);
    return sx > -pad && sx < view.w + pad && sy > -pad && sy < view.h + pad;
  });
}
