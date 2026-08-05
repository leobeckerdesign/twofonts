import type { FontEntry } from "../types";
import { FontAtlas } from "./atlas";
import { WORLD, type View } from "./lod";

const DETAIL_LIMIT = 96;

const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  "Sans Serif": "#82b8ff",
  Serif: "#ffc36a",
  Display: "#ff6f91",
  Handwriting: "#b893ff",
  Monospace: "#68e0c2",
};

export interface FieldPoint {
  entry: FontEntry;
  index: number;
  sx: number;
  sy: number;
  distance: number;
}

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? "#c5c2ba";
}

export function visibleFieldPoints(
  entries: readonly FontEntry[],
  view: View,
  pad = 100,
): FieldPoint[] {
  const centerX = view.w / 2;
  const centerY = view.h / 2;
  const points: FieldPoint[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const sx = entry.x * WORLD * view.scale + view.x;
    const sy = entry.y * WORLD * view.scale + view.y;
    if (sx < -pad || sx > view.w + pad || sy < -pad || sy > view.h + pad) continue;

    points.push({
      entry,
      index,
      sx,
      sy,
      distance: (sx - centerX) ** 2 + (sy - centerY) ** 2,
    });
  }

  return points;
}

export function selectDetailedPoints(
  points: readonly FieldPoint[],
  activeFamilies: ReadonlySet<string>,
  limit = DETAIL_LIMIT,
  cellSize = 56,
): FieldPoint[] {
  if (limit <= 0) return [];
  const ranked = [...points]
    .sort((a, b) => {
      const activeA = activeFamilies.has(a.entry.family) ? 1 : 0;
      const activeB = activeFamilies.has(b.entry.family) ? 1 : 0;
      return activeB - activeA || a.distance - b.distance || a.index - b.index;
    });
  const selected: FieldPoint[] = [];
  const occupied = new Set<string>();

  for (const point of ranked) {
    const active = activeFamilies.has(point.entry.family);
    const cell = `${Math.floor(point.sx / cellSize)}:${Math.floor(point.sy / cellSize)}`;
    if (!active && occupied.has(cell)) continue;
    selected.push(point);
    occupied.add(cell);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Screen-space layer for the whole catalog. Camera gestures only redraw this
 * canvas; expensive glyph detail is requested after the gesture settles.
 */
export class FontField {
  private readonly context: CanvasRenderingContext2D;
  private activeFamilies = new Set<string>();
  private latestView: View | null = null;
  private wantsDetail = false;
  private animationFrame: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly entries: readonly FontEntry[],
    private readonly atlas: FontAtlas,
  ) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D indisponível para o mapa");
    this.context = context;
  }

  setActive(families: Iterable<string>): void {
    this.activeFamilies = new Set(families);
  }

  request(view: View, detail = false): void {
    this.latestView = { ...view };
    this.wantsDetail = this.wantsDetail || detail;
    if (this.animationFrame !== null) return;

    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      const next = this.latestView;
      const drawDetail = this.wantsDetail;
      this.wantsDetail = false;
      if (next) this.draw(next, drawDetail);
    });
  }

  draw(view: View, detail: boolean): void {
    const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 1.35);
    const width = Math.max(1, Math.round(view.w * dpr));
    const height = Math.max(1, Math.round(view.h * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = `${view.w}px`;
      this.canvas.style.height = `${view.h}px`;
    }

    const context = this.context;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, view.w, view.h);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const points = visibleFieldPoints(this.entries, view);
    const baseRadius = view.scale < 0.48 ? 1.25 : 1.7;

    context.save();
    const groups = new Map<string, FieldPoint[]>();
    for (const point of points) {
      if (this.activeFamilies.has(point.entry.family)) continue;
      const color = categoryColor(point.entry.category);
      const group = groups.get(color) ?? [];
      group.push(point);
      groups.set(color, group);
    }
    context.globalAlpha = 0.52;
    for (const [color, group] of groups) {
      context.fillStyle = color;
      context.beginPath();
      for (const point of group) {
        context.moveTo(point.sx + baseRadius, point.sy);
        context.arc(point.sx, point.sy, baseRadius, 0, Math.PI * 2);
      }
      context.fill();
    }

    for (const point of points) {
      if (!this.activeFamilies.has(point.entry.family)) continue;
      const radius = baseRadius + 2.8;
      context.globalAlpha = 0.95;
      context.fillStyle = "#ff5a2a";
      context.beginPath();
      context.arc(point.sx, point.sy, radius, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.28;
      context.strokeStyle = "#ff5a2a";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(point.sx, point.sy, radius + 7, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();

    if (!detail) return;

    const overview = view.scale < 0.42;
    const previews = selectDetailedPoints(
      points,
      this.activeFamilies,
      overview ? 48 : DETAIL_LIMIT,
      overview ? 74 : 56,
    );
    const size = overview ? 34 : Math.min(78, Math.max(26, 32 * view.scale));
    context.save();
    for (const point of previews) {
      const active = this.activeFamilies.has(point.entry.family);
      const previewSize = active ? size * 1.22 : size;
      context.globalAlpha = active ? 0.58 : overview ? 0.38 : view.scale > 1 ? 0.26 : 0.18;
      this.atlas.draw(
        context,
        point.index,
        point.sx - previewSize / 2,
        point.sy - previewSize / 2,
        previewSize,
      );
    }
    context.restore();
  }

  destroy(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }
}
