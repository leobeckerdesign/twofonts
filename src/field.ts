import gsap from "gsap";
import { Observer } from "gsap/Observer";
import { LAYOUTS, type Layout, type LayoutContext } from "./layouts";
import { initMedia, type MediaEngine } from "./media/shaders";
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
/** Piso do encolhimento: abaixo disso o texto deixa de ser legível de qualquer jeito. */
const MIN_FONT_PX = 9;

/**
 * Card e tipografia 25% menores, juntos.
 *
 * Mora aqui, e não nos corpos do `layouts.json`, porque a escala do campo é um
 * `transform`: encolhe largura, tipo, respiro, filete e mídia na MESMA
 * proporção. Mexer nos corpos encolheria só o texto, e o respiro de 30/32/26px
 * do card ficaria para trás — deixaria de ser proporcional.
 */
const CONTENT_SCALE = 0.75;
/**
 * Raio do canto do card, em px DE TELA — os mesmos dois valores que os cards da
 * vitrine usam, e na mesma quebra (`MOBILE_BREAKPOINT` é 720, igual à do CSS).
 *
 * O valor vive aqui, e não no CSS, porque o campo é o único que sabe por quanto
 * cada card está sendo escalado; ver o uso em `layout`. O CSS declara o mesmo
 * número como ponto de partida, para o card já nascer arredondado no primeiro
 * quadro, antes de a primeira medição acontecer.
 */
const CARD_RADIUS = 22;
const CARD_RADIUS_MOBILE = 18;

/**
 * Largura ÚTIL do elemento. `clientWidth` sozinho ainda inclui o respiro
 * interno, e o card tem 32px de cada lado — usá-lo cru liberava 64px de
 * vazamento antes de o ajuste sequer começar a agir.
 */
const contentWidth = (el: HTMLElement): number => {
  const cs = getComputedStyle(el);
  return el.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight);
};

/**
 * Largura da linha mais larga do elemento, em px de layout.
 *
 * `scrollWidth` NÃO serve aqui, e era esse o furo: num bloco com overflow
 * visível ele volta grudado na largura do conteúdo mesmo quando uma palavra
 * passa da borda. `scrollWidth > max` nunca dava verdadeiro, então o ajuste
 * nunca disparava. O Range mede as caixas de linha de verdade — que é o que o
 * olho vê vazar.
 */
const lineWidth = (el: HTMLElement): number => {
  const rects = document.createRange();
  rects.selectNodeContents(el);
  const list = rects.getClientRects();
  if (list.length === 0) return 0;

  let widest = 0;
  for (const r of list) widest = Math.max(widest, r.width);

  // `getClientRects` já vem com o `scale` do campo aplicado; o limite, não.
  const own = el.offsetWidth;
  if (own === 0) return 0;
  const zoom = el.getBoundingClientRect().width / own;
  return zoom > 0 ? widest / zoom : widest;
};

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
  /** Dispara quando o par novo está de fato na tela, fontes medidas e tudo. */
  onSettled: (() => void) | null = null;

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
  /** Null quando o WebGL não sobe; aí as caixas ficam no gradiente do CSS. */
  private readonly media: MediaEngine | null = initMedia();

  /**
   * `ignoreScroll` é um seletor de área onde a roda e o arrasto NÃO rolam o
   * campo. O observador escuta na janela — é o que faz a rolagem funcionar em
   * qualquer lugar da tela —, então quem tem rolagem própria, como o editor
   * lateral, precisa se declarar aqui ou o campo anda junto por baixo.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly ignoreScroll: string | null = null,
  ) {
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
      // Sem isto o atalho de movimento reduzido nunca avisava que terminou, e
      // quem depende do aviso — o indicador de carregamento — ficava aceso para
      // sempre. Justo o público que pediu menos movimento na tela.
      this.onSettled?.();
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
      // O `catch` importa: fonte que falha em carregar REJEITA, e a rejeição
      // abortaria esta função antes de tirar o esqueleto — o campo ficaria em
      // osso e o indicador aceso por causa de um arquivo que não veio.
      Promise.resolve(ready).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, REVEAL_TIMEOUT_MS)),
    ]);
    if (token !== this.revealToken) return;   // outro par assumiu no meio

    // As métricas da webfont só existem agora. A primeira passada mediu contra
    // a fallback, então remede antes de revelar — ainda sob o esqueleto, para o
    // ajuste não aparecer como texto pulando na tela.
    for (const s of this.slots) this.fitText(s.card);
    // Encolher muda a altura do card, e a altura é o que posiciona o campo.
    this.layout();

    this.skeleton(false);
    this.onSettled?.();
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
    this.media?.destroy();
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
      // O motor de mídia lê os dois: o id semeia o sorteio, o tipo dá a paleta.
      card.dataset.card = layout.id;
      card.dataset.kind = layout.kind;

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
      this.scale = CONTENT_SCALE * gsap.utils.clamp(0.3, 0.72, fw / 780);
      // Margem e espaçamento saem da escala, então já vêm reduzidos junto.
      this.margin = Math.max(12, 20 * this.scale);
      this.spacing = Math.round(SPACING_BASE * this.scale * 1.15);
    } else {
      // Média geométrica: `min` deixava o card pequeno em tela larga. O teto
      // por altura impede card mais alto que a área visível.
      const geo = Math.sqrt((fw / REF_W) * (fh / REF_H));
      this.scale = CONTENT_SCALE * gsap.utils.clamp(0.8, 3.2, Math.min(1.3 * geo, fh / 520));
      // Acompanha a escala, senão o parallax (27 * escala) vazaria pela borda.
      this.margin = Math.max(24, 44 * this.scale);
      const density = gsap.utils.clamp(1, 1.7, (fw / fh) / (REF_W / REF_H));
      // O espaçamento vem da ALTURA da tela, não da escala, então precisa do
      // fator explícito. Sem ele o card encolhia e o vão entre cards não, e a
      // composição ficava rala em vez de menor.
      this.spacing = Math.round(SPACING_BASE * (fh / REF_H) * 1.3 * CONTENT_SCALE / density);
    }
    this.total = this.slots.length * this.spacing;
  }

  private layout = (): void => {
    this.metrics();
    const fw = this.root.clientWidth;
    const room = Math.max(140, fw - this.margin * 2);
    const lanes = this.isMobile ? LANES_MOBILE : LANES;
    const raio = this.isMobile ? CARD_RADIUS_MOBILE : CARD_RADIUS;

    for (const s of this.slots) {
      // O card mantém a largura de projeto; quem cresce é o .zoom. Se não
      // couber entre as margens, a escala cede — nunca a margem.
      const k = Math.min(this.scale, room / s.layout.w);
      s.card.style.width = `${s.layout.w}px`;
      s.zoom.style.transform = `scale(${k.toFixed(4)})`;
      // O raio é o ÚNICO valor do card que NÃO acompanha a escala. Tudo o mais
      // aqui dentro é composição — respiro, corpo, entrelinha — e cresce junto
      // com ela; o canto arredondado não é composição, é o vocabulário da
      // interface, o mesmo dos cards da vitrine ao lado. Dividido pela escala,
      // ele chega à tela sempre com a mesma medida: fixo no CSS, os 22px
      // virariam 11px no celular (escala 0,51) e 26px em 1920 (escala 1,19), e
      // a coluna da direita continuaria nos 22 em qualquer uma das duas.
      s.card.style.borderRadius = `${(raio / k).toFixed(2)}px`;

      s.w = s.layout.w * k;
      s.h = (s.card.offsetHeight || 300) * k;
      s.holder.style.width = `${s.w}px`;
      s.x = this.margin + lanes[s.index % lanes.length] * (fw - s.w - this.margin * 2);
      s.base = s.index * this.spacing;
    }

    // Só reamostra o que mudou de tamanho; as sementes ficam onde estão.
    this.media?.measure();
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

      for (const node of s.card.querySelectorAll<HTMLElement>(".t")) {
        node.style.fontFamily = `"${roles.title.f}", serif`;
        node.style.fontWeight = String(roles.titleWeight);
      }
      for (const node of s.card.querySelectorAll<HTMLElement>(".p")) {
        node.style.fontFamily = `"${roles.body.f}", sans-serif`;
        node.style.fontWeight = String(roles.bodyWeight);
      }

      // DEPOIS da fonte e do peso. Medir antes media a fallback, e o corpo que
      // "cabia" transbordava assim que a família de verdade entrava.
      this.fitText(s.card);
    }

    this.layout();
    // Depois do layout: a caixa só tem tamanho quando o card já mediu.
    this.media?.scan(this.root, `${pair.a.f}|${pair.b.f}|${pair.contrast}`);
    return this.onFontsNeeded?.([...needed]);
  }

  /**
   * A razão de contraste é global e não conhece a largura de cada card, então
   * um título longo em contraste alto transbordava. Aqui cada texto encolhe até
   * caber — a intenção de escala é preservada onde couber, e nenhum layout novo
   * pode vazar por engano. Só roda a cada repintura, nunca no loop de animação.
   *
   * IDEMPOTENTE de propósito: guarda o corpo DECLARADO e sempre parte dele. Sem
   * isso a segunda passada, a que roda quando a webfont enfim chega, só saberia
   * encolher de novo — e um card medido antes contra uma fallback mais larga
   * ficaria pequeno para sempre.
   */
  private fitText(card: HTMLElement): void {
    for (const node of card.querySelectorAll<HTMLElement>(".t, .p")) {
      const declared = node.dataset.fs ?? node.style.fontSize;
      if (declared === "") continue;
      node.dataset.fs = declared;
      node.style.fontSize = declared;
      node.style.overflowWrap = "";

      let size = Number.parseFloat(declared);
      if (!Number.isFinite(size)) continue;

      // O limite é a caixa de conteúdo do PAI. Do card não servia por dois
      // motivos: `clientWidth` ainda inclui os 32px de respiro de cada lado, o
      // que liberava 64px de vazamento; e dentro de `split`, `rows` ou coluna o
      // espaço real é uma fração da largura do card.
      const parent = node.parentElement;
      if (parent === null) continue;
      const max = contentWidth(parent);
      if (max <= 0) continue;

      let guard = 0;
      let widest = lineWidth(node);
      while (widest > max && size > MIN_FONT_PX && guard++ < 8) {
        // Salta direto para a proporção que cabe; converge em uma ou duas voltas.
        size = Math.max(MIN_FONT_PX, size * (max / widest) * 0.98);
        node.style.fontSize = `${size.toFixed(1)}px`;
        widest = lineWidth(node);
      }

      // Só quando encolher já não resolve — uma palavra só, mais larga que o
      // card, no piso de 9px. Quebrar no meio é feio, mas é melhor que o card
      // cortar a palavra na borda. Encolher vem primeiro justamente para isto
      // quase nunca acontecer.
      if (widest > max) node.style.overflowWrap = "break-word";
    }
  }

  private bind(): void {
    Observer.create({
      target: window,
      type: "wheel,touch",
      // Resolvido UMA vez, na criação: o alvo precisa existir no HTML estático.
      ignore: this.ignoreScroll ?? undefined,
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
