import { isFontReady } from "../fonts";
import type { FontEntry } from "../types";
import { atlasBackgroundPosition } from "./atlas";
import {
  WORLD,
  lodWithHysteresis,
  screenPos,
  visibleEntries,
  type LOD,
  type View,
} from "./lod";

const DESKTOP_LIMITS: Readonly<Record<LOD, number>> = {
  dot: 2,
  name: 24,
  card: 16,
};
const MOBILE_LIMITS: Readonly<Record<LOD, number>> = {
  dot: 2,
  name: 20,
  card: 12,
};

const CATEGORY_CLASS: Readonly<Record<string, string>> = {
  "Sans Serif": "sans",
  Serif: "serif",
  Display: "display",
  Handwriting: "handwriting",
  Monospace: "monospace",
};

interface Live {
  el: HTMLElement;
  entry: FontEntry;
  index: number;
  lod: LOD | null;
}

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function candidateRect(
  entry: FontEntry,
  sx: number,
  sy: number,
  lod: LOD,
  view: View,
): ScreenRect {
  if (lod === "card") {
    const width = 218 * view.scale + 12;
    const height = 108 * view.scale + 12;
    return { left: sx - 6, top: sy - 6, right: sx + width, bottom: sy + height };
  }

  // Name labels use inverse scaling below scale 1, so their screen footprint
  // remains readable and can be collision-tested in stable pixel units.
  const width = Math.min(270, Math.max(116, entry.family.length * 8 + 44));
  return { left: sx - 5, top: sy - 5, right: sx + width, bottom: sy + 49 };
}

function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function activeScreenOffsets(
  entries: readonly FontEntry[],
  view: View,
  activeFamilies: ReadonlySet<string>,
  lod: LOD,
): ReadonlyMap<string, number> {
  const effectiveLod = lod === "dot" ? "name" : lod;
  const active = entries
    .filter((entry) => activeFamilies.has(entry.family))
    .map((entry) => ({ entry, ...screenPos(entry, view) }))
    .sort((a, b) => a.sx - b.sx || a.sy - b.sy || a.entry.family.localeCompare(b.entry.family));
  if (active.length !== 2) return new Map();

  const [left, right] = active;
  const leftRect = candidateRect(left.entry, left.sx, left.sy, effectiveLod, view);
  const rightRect = candidateRect(right.entry, right.sx, right.sy, effectiveLod, view);
  if (!intersects(leftRect, rightRect)) return new Map();

  const gap = effectiveLod === "card" ? 16 : 10;
  const overlap = leftRect.right + gap - rightRect.left;
  if (overlap <= 0) return new Map();
  const leftShift = -Math.ceil(overlap / 2);
  return new Map([
    [left.entry.family, leftShift],
    [right.entry.family, overlap + leftShift],
  ]);
}

export function selectInteractiveEntries(
  entries: readonly FontEntry[],
  view: View,
  activeFamilies: ReadonlySet<string>,
  lod: LOD,
  limit: number,
): FontEntry[] {
  if (limit <= 0) return [];
  const visiblePad = lod === "card" ? Math.max(240, 218 * view.scale + 24) : 280;
  const visible = visibleEntries(entries, view, visiblePad);
  const centerX = view.w / 2;
  const centerY = view.h / 2;
  const candidates = lod === "dot"
    ? visible.filter((entry) => activeFamilies.has(entry.family))
    : visible;
  const ranked = candidates
    .map((entry) => {
      const { sx, sy } = screenPos(entry, view);
      return {
        entry,
        active: activeFamilies.has(entry.family) ? 1 : 0,
        sx,
        sy,
        distance: (sx - centerX) ** 2 + (sy - centerY) ** 2,
      };
    })
    .sort((a, b) => b.active - a.active || a.distance - b.distance);

  const activeOffsets = activeScreenOffsets(candidates, view, activeFamilies, lod);
  const occupied: ScreenRect[] = [];
  const selected: FontEntry[] = [];
  for (const candidate of ranked) {
    const rect = candidateRect(
      candidate.entry,
      candidate.sx + (activeOffsets.get(candidate.entry.family) ?? 0),
      candidate.sy,
      lod === "dot" ? "name" : lod,
      view,
    );
    if (!candidate.active && occupied.some((placed) => intersects(rect, placed))) continue;
    occupied.push(rect);
    selected.push(candidate.entry);
    if (selected.length >= limit) break;
  }
  return selected;
}

function isMobileViewport(): boolean {
  return typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;
}

function categoryClass(category: string): string {
  return CATEGORY_CLASS[category] ?? "sans";
}

/**
 * Interactive overlay only. The complete catalog lives in FontField's canvas;
 * this layer stays intentionally small and performs no network requests.
 */
export class CardLayer {
  onPick: ((family: string) => void) | null = null;

  private readonly live = new Map<string, Live>();
  private readonly pool: HTMLElement[] = [];
  private readonly indexByFamily: Map<string, number>;
  private activeFamilies = new Set<string>();
  private currentLod: LOD | null = null;

  constructor(
    private readonly world: HTMLElement,
    private readonly entries: readonly FontEntry[],
  ) {
    this.indexByFamily = new Map(entries.map((entry, index) => [entry.family, index]));
  }

  nodeFor(family: string): HTMLElement | undefined {
    return this.live.get(family)?.el;
  }

  setActive(families: Iterable<string>): void {
    this.activeFamilies = new Set(families);
    for (const [family, item] of this.live) {
      item.el.classList.toggle("card--active", this.activeFamilies.has(family));
    }
  }

  refreshFonts(): void {
    for (const item of this.live.values()) this.applyFont(item);
  }

  render(view: View): void {
    const lod = lodWithHysteresis(view.scale, this.currentLod);
    this.currentLod = lod;
    const limits = isMobileViewport() ? MOBILE_LIMITS : DESKTOP_LIMITS;

    const wanted = selectInteractiveEntries(
      this.entries,
      view,
      this.activeFamilies,
      lod,
      limits[lod],
    );

    const keep = new Set(wanted.map((entry) => entry.family));
    for (const [family, item] of this.live) {
      if (!keep.has(family)) this.release(family, item);
    }

    const activeOffsets = activeScreenOffsets(wanted, view, this.activeFamilies, lod);

    for (const entry of wanted) {
      let item = this.live.get(entry.family);
      if (!item) item = this.acquire(entry);

      const targetLod = lod === "dot" ? "name" : lod;
      if (item.lod !== targetLod) this.decorate(item, targetLod);

      const pinned = lod === "dot" && this.activeFamilies.has(entry.family);
      item.el.classList.toggle("card--pinned", pinned);
      const visualScale = targetLod === "name" ? 1 / Math.min(view.scale, 1) : 1;

      const screenOffset = activeOffsets.get(entry.family) ?? 0;
      // Keeping translation before scale in the same transform list preserves
      // the world anchor while name labels counter-scale for readability.
      item.el.style.transform = `translate3d(${entry.x * WORLD + screenOffset / view.scale}px, ${entry.y * WORLD}px, 0) scale(${visualScale})`;
    }
  }

  private acquire(entry: FontEntry): Live {
    const el = this.pool.pop() ?? this.createNode();
    const index = this.indexByFamily.get(entry.family) ?? 0;

    el.className = "card card--enter";
    el.replaceChildren();
    el.dataset.family = entry.family;
    el.setAttribute("aria-label", `Selecionar ${entry.family}`);
    el.style.fontFamily = "";
    el.style.transform = `translate3d(${entry.x * WORLD}px, ${entry.y * WORLD}px, 0)`;

    const item: Live = { el, entry, index, lod: null };
    this.live.set(entry.family, item);
    if (el.parentElement !== this.world) this.world.appendChild(el);
    return item;
  }

  private release(family: string, item: Live): void {
    if (this.live.get(family) !== item) return;
    this.live.delete(family);
    item.el.remove();
    item.el.className = "card";
    item.el.replaceChildren();
    item.el.style.cssText = "";
    item.el.removeAttribute("aria-label");
    delete item.el.dataset.family;
    if (this.pool.length < DESKTOP_LIMITS.name) this.pool.push(item.el);
  }

  private createNode(): HTMLElement {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.clickable = "true";
    el.setAttribute("role", "button");
    el.tabIndex = 0;

    const pick = (): void => {
      const family = el.dataset.family;
      if (family) this.onPick?.(family);
    };
    el.addEventListener("click", pick);
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      pick();
    });
    return el;
  }

  private decorate(item: Live, lod: LOD): void {
    const { el, entry, index } = item;
    if (this.live.get(entry.family) !== item) return;

    item.lod = lod;
    el.className = `card card--${lod} card--category-${categoryClass(entry.category)}`;
    el.classList.toggle("card--active", this.activeFamilies.has(entry.family));

    if (lod === "name") {
      const preview = this.createPreview(index, "card__preview card__preview--mini");
      const name = this.createPart("span", "card__label", entry.family);
      el.replaceChildren(preview, name);
    } else {
      const preview = this.createPreview(index, "card__preview");
      const info = document.createElement("span");
      info.className = "card__info";
      const name = this.createPart("span", "card__name", entry.family);
      const meta = this.createPart(
        "span",
        "card__meta",
        `${entry.category} · ${entry.weights.length} ${entry.weights.length === 1 ? "peso" : "pesos"}`,
      );
      info.replaceChildren(name, meta);
      el.replaceChildren(preview, info);
    }

    this.applyFont(item);
  }

  private createPreview(index: number, className: string): HTMLSpanElement {
    const preview = document.createElement("span");
    const position = atlasBackgroundPosition(index);
    preview.className = className;
    preview.setAttribute("aria-hidden", "true");
    preview.style.setProperty("--preview-x", position.x);
    preview.style.setProperty("--preview-y", position.y);
    return preview;
  }

  private applyFont(item: Live): void {
    const ready = isFontReady(item.entry.family);
    item.el.classList.toggle("card--font-ready", ready);
    if (!ready || item.lod !== "name") {
      item.el.style.fontFamily = "";
      return;
    }
    const family = item.entry.family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    item.el.style.fontFamily = `"${family}", var(--preview-font)`;
  }

  private createPart<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text: string,
  ): HTMLElementTagNameMap[K] {
    const part = document.createElement(tag);
    part.className = className;
    part.textContent = text;
    return part;
  }
}
