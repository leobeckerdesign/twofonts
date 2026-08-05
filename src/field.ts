import gsap from "gsap";
import { Observer } from "gsap/Observer";
import { LAYOUTS, type Layout, type LayoutContext } from "./layouts";
import { assignRoles, sizeRatio } from "./roles";
import type { FontMeta, WeightRole } from "./types";

gsap.registerPlugin(Observer);

const REF_W = 1440;
const REF_H = 820;
const SPACING_BASE = 240;
const BASE_BODY = 15;
/** Multiplicador do título antes da razão de contraste e do fator do layout. */
const TITLE_BASE = 2.2;
/** Amplitude do parallax por profundidade: card pequeno se desloca mais. */
const AMP = { large: 9, medium: 17, small: 27 } as const;
const MOBILE_BREAKPOINT = 720;
/** Teto de espera pelas fontes antes de revelar mesmo assim. */
const REVEAL_TIMEOUT_MS = 3_000;

const LANES = [.04, .62, .30, .86, .16, .70, .44, .02, .78, .36, .58, .10, .92, .24, .66, .48, .82, .14];
/** No celular só existem dois lados; a sobreposição vertical faz o entrelace. */
const LANES_MOBILE = [0, 1, .12, .88, 0, 1, .18, .82, .06, .94, 0, 1, .15, .85, .04, .96, .1, .9];

const tierOf = (w: number) => (w >= 460 ? "large" : w >= 380 ? "medium" : "small");

interface Slot {
  holder: HTMLElement;
  par: HTMLElement;
  zoom: HTMLElement;
  card: HTMLElement;
  layout: Layout;
  index: number;
  tier: keyof typeof AMP;
  base: number;
  x: number;
  w: number;
  h: number;
  near: number;
}

export interface FieldPair {
  a: FontMeta;
  b: FontMeta;
  roles: [WeightRole, WeightRole];
  contrast: number;
}

/**
 * Campo de cards com rolagem infinita.
 *
 * Três camadas aninhadas, cada uma dona de UMA transform: `.slot` recebe o
 * scroll, `.par` o parallax de ponteiro e a proximidade, `.zoom` a escala base.
 * Se duas delas disputassem a mesma propriedade, uma anularia a outra.
 */
export class Field {
  /** Pede as fontes do par. A promessa resolve quando dá para revelar o texto. */
  onFontsNeeded: ((families: string[]) => Promise<unknown> | void) | null = null;

  private slots: Slot[] = [];
  private scroll = 0;
  private target = 0;
  private total = 0;
  private frame: number | null = null;
  private pair: FieldPair | null = null;
  private revealToken = 0;

  private scale = 1.3;
  private margin = 56;
  private spacing = SPACING_BASE;
  private isMobile = false;

  private readonly pointer = { tx: 0, ty: 0, x: 0, y: 0, px: -9999, py: -9999, inside: false };
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly root: HTMLElement) {
    this.build();
    this.bind();
    this.frame = requestAnimationFrame(this.render);
  }

  setPair(pair: FieldPair): void {
    this.pair = pair;
    const ready = this.paint();
    if (this.reduced || document.hidden) {
      this.skeleton(false);
      gsap.set(this.slots.map((s) => s.card), { opacity: 1, y: 0 });
      return;
    }
    this.skeleton(true);
    void this.revealWhenReady(ready);
  }

  /** Troca de par: dissolve, mostra o esqueleto e revela em cascata. */
  swap(pair: FieldPair): void {
    const cards = this.slots.map((s) => s.card);
    if (this.reduced || document.hidden) {
      gsap.set(cards, { opacity: 1, y: 0 });
      this.setPair(pair);
      return;
    }

    gsap.killTweensOf(cards);
    gsap.timeline()
      .to(cards, { opacity: 0, y: 10, duration: .22, stagger: .016, ease: "power2.in" })
      .add(() => {
        this.pair = pair;
        const ready = this.paint();
        this.skeleton(true);
        gsap.set(cards, { opacity: 1, y: 0 });
        void this.revealWhenReady(ready);
      });
  }

  /**
   * O esqueleto some quando as fontes chegam. O teto de espera existe para uma
   * fonte lenta ou morta não deixar o campo em osso para sempre.
   */
  private async revealWhenReady(ready: Promise<unknown> | void): Promise<void> {
    const token = ++this.revealToken;
    await Promise.race([
      Promise.resolve(ready),
      new Promise((resolve) => setTimeout(resolve, REVEAL_TIMEOUT_MS)),
    ]);
    if (token !== this.revealToken) return;   // outro par assumiu no meio

    this.skeleton(false);
    const cards = this.slots.map((s) => s.card);
    gsap.fromTo(
      cards,
      { opacity: 0, y: 16 },
      {
        opacity: 1, y: 0, duration: .62, ease: "power3.out",
        stagger: { each: .045, from: "start" },
      },
    );
  }

  private skeleton(on: boolean): void {
    for (const s of this.slots) s.card.classList.toggle("is-loading", on);
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    gsap.killTweensOf(this.slots.map((s) => s.card));
  }

  private build(): void {
    this.root.innerHTML = "";
    this.slots = LAYOUTS.map((layout, index) => {
      const holder = document.createElement("div");
      holder.className = "slot";
      const par = document.createElement("div");
      par.className = "par";
      const zoom = document.createElement("div");
      zoom.className = "zoom";
      const card = document.createElement("article");
      card.className = `card card--${layout.kind}`;
      card.setAttribute("aria-label", `Exemplo: ${layout.id}`);

      zoom.appendChild(card);
      par.appendChild(zoom);
      holder.appendChild(par);
      this.root.appendChild(holder);

      return {
        holder, par, zoom, card, layout, index,
        tier: tierOf(layout.w), base: 0, x: 0, w: layout.w, h: 300, near: 0,
      };
    });
    this.layout();
    this.floatIdle();
  }

  /** Escala, margem e espaçamento derivam do viewport; nunca do loop. */
  private metrics(): void {
    const fw = this.root.clientWidth;
    const fh = this.root.clientHeight;
    this.isMobile = fw < MOBILE_BREAKPOINT;

    if (this.isMobile) {
      this.scale = gsap.utils.clamp(0.3, 0.72, fw / 780);
      this.margin = Math.max(12, 20 * this.scale);
      this.spacing = Math.round(SPACING_BASE * this.scale * 1.15);
    } else {
      // Média geométrica: `min` deixava o card pequeno em tela larga. O teto
      // por altura impede card mais alto que a área visível.
      const geo = Math.sqrt((fw / REF_W) * (fh / REF_H));
      this.scale = gsap.utils.clamp(0.8, 3.2, Math.min(1.3 * geo, fh / 520));
      // Acompanha a escala, senão o parallax (27 * escala) vazaria pela borda.
      this.margin = Math.max(24, 44 * this.scale);
      const density = gsap.utils.clamp(1, 1.7, (fw / fh) / (REF_W / REF_H));
      this.spacing = Math.round(SPACING_BASE * (fh / REF_H) * 1.3 / density);
    }
    this.total = this.slots.length * this.spacing;
  }

  private layout = (): void => {
    this.metrics();
    const fw = this.root.clientWidth;
    const room = Math.max(140, fw - this.margin * 2);
    const lanes = this.isMobile ? LANES_MOBILE : LANES;

    for (const s of this.slots) {
      // O card mantém a largura de projeto; quem cresce é o .zoom. Se não
      // couber entre as margens, a escala cede — nunca a margem.
      const k = Math.min(this.scale, room / s.layout.w);
      s.card.style.width = `${s.layout.w}px`;
      s.zoom.style.transform = `scale(${k.toFixed(4)})`;

      s.w = s.layout.w * k;
      s.h = (s.card.offsetHeight || 300) * k;
      s.holder.style.width = `${s.w}px`;
      s.x = this.margin + lanes[s.index % lanes.length] * (fw - s.w - this.margin * 2);
      s.base = s.index * this.spacing;
    }
  };

  private floatIdle(): void {
    if (this.reduced) return;
    this.slots.forEach(({ card }, i) => {
      gsap.to(card, {
        y: 7 + (i % 3) * 5, x: i % 2 ? 4 : -4,
        duration: 4.2 + (i % 5) * 0.8,
        repeat: -1, yoyo: true, ease: "sine.inOut", delay: i * 0.28,
      });
    });
  }

  private paint(): Promise<unknown> | void {
    const pair = this.pair;
    if (!pair) return;

    const ratio = sizeRatio(pair.contrast);
    const needed = new Set<string>();

    for (const s of this.slots) {
      const roles = assignRoles(pair.a, pair.b, s.index, pair.roles);
      const fsBody = BASE_BODY * s.layout.bodyScale;
      const context: LayoutContext = {
        ...roles,
        fsBody,
        fsTitle: fsBody * ratio * s.layout.titleScale * TITLE_BASE,
        contrastPct: Math.round(pair.contrast * 100),
      };

      s.card.innerHTML = s.layout.html(context);
      needed.add(roles.title.f);
      needed.add(roles.body.f);
      this.fitText(s.card);

      for (const node of s.card.querySelectorAll<HTMLElement>(".t")) {
        node.style.fontFamily = `"${roles.title.f}", serif`;
        node.style.fontWeight = String(roles.titleWeight);
      }
      for (const node of s.card.querySelectorAll<HTMLElement>(".p")) {
        node.style.fontFamily = `"${roles.body.f}", sans-serif`;
        node.style.fontWeight = String(roles.bodyWeight);
      }
    }

    this.layout();
    return this.onFontsNeeded?.([...needed]);
  }

  /**
   * A razão de contraste é global e não conhece a largura de cada card, então
   * um título longo em contraste alto transbordava. Aqui cada texto encolhe até
   * caber — a intenção de escala é preservada onde couber, e nenhum layout novo
   * pode vazar por engano. Só roda a cada repintura, nunca no loop de animação.
   */
  private fitText(card: HTMLElement): void {
    const max = card.clientWidth;
    if (max <= 0) return;

    for (const node of card.querySelectorAll<HTMLElement>(".t, .p")) {
      let size = Number.parseFloat(node.style.fontSize);
      if (!Number.isFinite(size)) continue;

      let guard = 0;
      while (node.scrollWidth > max && size > 9 && guard++ < 8) {
        // Salta direto para a proporção que cabe; converge em uma ou duas voltas.
        size = Math.max(9, size * (max / node.scrollWidth) * 0.98);
        node.style.fontSize = `${size.toFixed(1)}px`;
      }
    }
  }

  private bind(): void {
    Observer.create({
      target: window,
      type: "wheel,touch",
      onChangeY: (self) => {
        this.target += self.deltaY * 1.6;
        document.getElementById("hint")?.classList.add("is-gone");
      },
    });

    this.root.addEventListener("pointermove", (e) => {
      const r = this.root.getBoundingClientRect();
      this.pointer.tx = gsap.utils.mapRange(0, r.width, 1, -1, e.clientX - r.left);
      this.pointer.ty = gsap.utils.mapRange(0, r.height, 1, -1, e.clientY - r.top);
      this.pointer.px = e.clientX - r.left;
      this.pointer.py = e.clientY - r.top;
      this.pointer.inside = true;
    }, { passive: true });

    this.root.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      this.pointer.tx = 0;
      this.pointer.ty = 0;
    });

    addEventListener("resize", this.layout);
  }

  /** Topo e base podem cortar — é a rolagem. As laterais, nunca: quem garante
   *  isso é o cálculo de `s.x`, que desconta a largura do card e as margens. */
  private render = (): void => {
    this.scroll += (this.target - this.scroll) * 0.09;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.09;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.09;

    for (const s of this.slots) {
      const span = s.h + this.margin * 2;
      const y = gsap.utils.wrap(-span, this.total - span, s.base - this.scroll);
      // Sem cursor não há parallax; no celular ele só empurraria o card para fora.
      const amp = this.isMobile ? 0 : AMP[s.tier] * this.scale;
      const px = amp * this.pointer.x;
      const py = amp * this.pointer.y;

      s.holder.style.transform = `translate3d(${s.x}px, ${y}px, 0)`;

      let want = 0;
      if (this.pointer.inside) {
        const cx = s.x + s.w / 2 + px;
        const cy = y + s.h / 2 + py;
        const d = Math.hypot(this.pointer.px - cx, this.pointer.py - cy);
        want = gsap.utils.clamp(0, 1, 1 - d / (440 * this.scale));
      }
      s.near += (want - s.near) * 0.12;

      s.par.style.transform =
        `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px) scale(${(1 + s.near * 0.035).toFixed(4)})`;
      s.card.style.zIndex = String(Math.round(s.near * 100));
    }

    this.frame = requestAnimationFrame(this.render);
  };
}
