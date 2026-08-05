import gsap from "gsap";
import { failedFonts, loadFont } from "../fonts";
import type { FontEntry } from "../types";
import { WORLD, lodForScale, visibleEntries, type LOD, type View } from "./lod";

const SUBSET = "AaGgQqRe 0123456789";
const MAX_NODES = 180;
const MAX_CONCURRENT_FONT_LOADS = 6;
const reducedMotion =
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Live {
  el: HTMLElement;
  entry: FontEntry;
  lod: LOD | null;
  revision: number;
  drift?: gsap.core.Tween;
}

interface FontJob {
  item: Live;
  revision: number;
  lod: LOD;
}

export class CardLayer {
  onPick: ((family: string) => void) | null = null;
  onUnavailable: ((family: string) => void) | null = null;

  private live = new Map<string, Live>();
  private pool: HTMLElement[] = [];
  private activeFamilies = new Set<string>();
  private fontQueue: FontJob[] = [];
  private activeFontLoads = 0;

  constructor(
    private world: HTMLElement,
    private entries: FontEntry[],
  ) {}

  nodeFor(family: string): HTMLElement | undefined {
    return this.live.get(family)?.el;
  }

  setActive(families: Iterable<string>): void {
    this.activeFamilies = new Set(families);
    for (const [family, item] of this.live) {
      item.el.classList.toggle("card--active", this.activeFamilies.has(family));
    }
  }

  render(view: View): void {
    const lod = lodForScale(view.scale);
    const visible = visibleEntries(
      this.entries.filter((entry) => !failedFonts.has(entry.family)),
      view,
    );
    // O par ativo nunca perde lugar no pool para a ordem original do catálogo.
    const wanted = [
      ...visible.filter((entry) => this.activeFamilies.has(entry.family)),
      ...visible.filter((entry) => !this.activeFamilies.has(entry.family)),
    ].slice(0, MAX_NODES);
    const keep = new Set(wanted.map((entry) => entry.family));

    for (const [family, item] of this.live) {
      if (!keep.has(family)) this.release(family, item);
    }

    for (const entry of wanted) {
      let item = this.live.get(entry.family);

      if (!item) {
        if (this.live.size >= MAX_NODES) continue;
        item = this.acquire(entry);
      }

      const targetLod = lod === "dot" && this.activeFamilies.has(entry.family)
        ? "name"
        : lod;
      if (item.lod !== targetLod) this.decorate(item, targetLod);

      const pinned = lod === "dot" && this.activeFamilies.has(entry.family);
      item.el.classList.toggle("card--pinned", pinned);
      if (pinned) {
        item.el.style.fontSize = `${18 / view.scale}px`;
      } else {
        item.el.style.removeProperty("font-size");
      }
    }
  }

  private acquire(entry: FontEntry): Live {
    const el = this.pool.pop() ?? this.createNode();

    gsap.killTweensOf(el);
    el.className = "card";
    el.replaceChildren();
    el.dataset.family = entry.family;
    el.setAttribute("aria-label", `Selecionar ${entry.family}`);
    el.style.fontFamily = "";
    gsap.set(el, {
      x: entry.x * WORLD,
      y: entry.y * WORLD,
      opacity: reducedMotion ? 1 : 0,
    });

    if (!reducedMotion) {
      gsap.to(el, {
        opacity: 1,
        duration: 0.4,
        ease: "power2.out",
        overwrite: "auto",
      });
    }

    const item: Live = { el, entry, lod: null, revision: 0 };
    this.live.set(entry.family, item);
    return item;
  }

  private release(family: string, item: Live): void {
    // Uma resposta antiga de fonte não pode remover a nova instância da família.
    if (this.live.get(family) !== item) return;

    this.live.delete(family);
    item.revision += 1;
    item.drift?.kill();
    item.drift = undefined;
    gsap.killTweensOf(item.el);
    item.el.remove();
    item.el.className = "card";
    item.el.replaceChildren();
    item.el.style.fontFamily = "";
    item.el.removeAttribute("aria-label");
    delete item.el.dataset.family;

    if (this.pool.length < MAX_NODES) this.pool.push(item.el);
  }

  private createNode(): HTMLElement {
    const el = document.createElement("div");
    el.className = "card";
    // O Draggable do mundo respeita este contrato e deixa o clique chegar ao card.
    el.dataset.clickable = "true";
    el.setAttribute("role", "button");
    el.tabIndex = 0;

    const pick = () => {
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
    const { el, entry } = item;

    if (this.live.get(entry.family) !== item) return;

    item.lod = lod;
    item.revision += 1;
    const revision = item.revision;
    el.className = `card card--${lod}`;
    el.classList.toggle("card--active", this.activeFamilies.has(entry.family));

    if (el.parentElement !== this.world) this.world.appendChild(el);

    if (lod === "dot") {
      el.replaceChildren();
      el.style.fontFamily = "";
      this.stopDrift(item);
      return;
    }

    this.startDrift(item);

    if (lod === "name") {
      el.textContent = entry.family;
    } else {
      const name = this.createPart("card__name", entry.family);
      const sample = this.createPart("card__sample", "Aa Gg Qq");
      const meta = this.createPart("card__meta", entry.category);
      el.replaceChildren(name, sample, meta);
    }

    this.enqueueFontLoad(item, revision, lod);
  }

  private enqueueFontLoad(item: Live, revision: number, lod: LOD): void {
    const job = { item, revision, lod };
    if (this.activeFamilies.has(item.entry.family)) {
      this.fontQueue.unshift(job);
    } else {
      this.fontQueue.push(job);
    }
    this.pumpFontQueue();
  }

  private pumpFontQueue(): void {
    while (this.activeFontLoads < MAX_CONCURRENT_FONT_LOADS) {
      const job = this.fontQueue.shift();
      if (!job) return;

      const { item, revision, lod } = job;
      if (
        this.live.get(item.entry.family) !== item ||
        item.revision !== revision ||
        item.lod !== lod
      ) {
        continue;
      }

      this.activeFontLoads += 1;
      let request: Promise<boolean>;
      try {
        request = loadFont(
          item.entry.family,
          400,
          lod === "card" ? undefined : SUBSET,
        );
      } catch {
        request = Promise.resolve(false);
      }

      void request
        .then(
          (ok) => this.finishFontLoad(item, revision, ok),
          () => this.finishFontLoad(item, revision, false),
        )
        .finally(() => {
          this.activeFontLoads -= 1;
          this.pumpFontQueue();
        });
    }
  }

  private finishFontLoad(item: Live, revision: number, ok: boolean): void {
    const { el, entry } = item;

    if (!ok && failedFonts.has(entry.family)) {
      this.onUnavailable?.(entry.family);
    }
    if (
      this.live.get(entry.family) !== item ||
      el.dataset.family !== entry.family ||
      item.revision !== revision ||
      item.lod === "dot"
    ) {
      return;
    }

    if (!ok) {
      this.release(entry.family, item);
      return;
    }

    const family = entry.family.replace(/["\\]/g, "\\$&");
    el.style.fontFamily = `"${family}", serif`;

    if (reducedMotion) {
      gsap.set(el, { opacity: 1 });
      return;
    }

    gsap.fromTo(
      el,
      { opacity: 0.35 },
      { opacity: 1, duration: 0.5, ease: "power2.out", overwrite: "auto" },
    );
  }

  private createPart(className: string, text: string): HTMLSpanElement {
    const part = document.createElement("span");
    part.className = className;
    part.textContent = text;
    return part;
  }

  private startDrift(item: Live): void {
    if (reducedMotion || item.drift) return;

    const seed = item.entry.x + item.entry.y;
    item.drift = gsap.to(item.el, {
      y: `+=${8 + seed * 6}`,
      duration: 5 + seed * 4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: seed * 3,
    });
  }

  private stopDrift(item: Live): void {
    item.drift?.kill();
    item.drift = undefined;
    gsap.set(item.el, { y: item.entry.y * WORLD });
  }
}
