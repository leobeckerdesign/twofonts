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
  if (scale < 0.55) return "dot";
  if (scale < 1.4) return "name";
  return "card";
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
  entries: T[],
  view: View,
  pad = 200,
): T[] {
  return entries.filter((e) => {
    const { sx, sy } = screenPos(e, view);
    return sx > -pad && sx < view.w + pad && sy > -pad && sy < view.h + pad;
  });
}
