import { loadFont } from "../fonts";
import { weightFor } from "../pairs";
import type { FontMeta, WeightRole } from "../types";

/** Amostra mínima: o preview pede só estes glifos ao Google, poucos KB por fonte. */
const SAMPLE = "Aa";
/** Fração central onde o ponteiro não rola nada — sem isso a lista nunca para. */
const DEAD_ZONE = 0.18;
const MAX_SPEED = 15;
/** Quantos pares por lote. Cada par pede duas fontes, então o lote custa o dobro. */
const BATCH = 24;

/* ---------- dock ----------
   Aumento por proximidade do ponteiro, como o dock do macOS. Os números vêm do
   `dock` do ibelick (motion-primitives): lá o item vai de 40 a 80 de largura —
   2× — com queda LINEAR ao longo de 150px, e mola `{mass:.1, stiffness:150,
   damping:12}`.

   Duas adaptações. O aumento é por `scale` e não por largura, porque o item
   deles é um ícone quadrado e o nosso é um card com texto: mexer só na largura
   o esticaria. E o pico é bem menor que 2×, porque o card já nasce com 150px.

   O empurrão dos vizinhos, que é a assinatura do dock, sai de `translateX`
   calculado a partir do que cada card cresceu. Assim o efeito inteiro é UMA
   transform por card — sem tocar em layout, que é o que estávamos protegendo. */
const DOCK_PEAK = 1.28;
/** Alcance da lente, em px de conteúdo. Pouco mais de um card, então 2 a 3 participam. */
const DOCK_RANGE = 190;
/** ζ ≈ 1,55 com estes valores: assenta rápido e não passa do ponto. */
const SPRING = { mass: 0.1, stiffness: 150, damping: 12 };
/** Abaixo disto a mola parou, para o laço poder dormir. */
const SPRING_REST = 0.0005;
/**
 * Passo fixo da integração, em segundos.
 *
 * A mola é integrada por Euler, que só é estável enquanto o passo for menor que
 * `2 / (damping/mass)` — aqui 2/120 ≈ 16,7ms, que é EXATAMENTE o frame de
 * 60fps. Integrar com o dt do frame divergia: a escala ia a −191 e depois a
 * 7,8×10⁹. Em sub-passos de 1/240 a margem é de quatro vezes, e um frame longo
 * vira mais sub-passos em vez de uma explosão. (O framer-motion não tem esse
 * problema porque resolve a mola analiticamente, sem integrar.)
 */
const SPRING_STEP = 1 / 240;

interface DockItem {
  el: HTMLElement;
  scale: number;
  vel: number;
}

export interface ShelfPair {
  a: FontMeta;
  b: FontMeta;
}

/**
 * Os pares do recorte atual do slider. Cada item mostra as duas fontes lado a
 * lado, nos pesos que a faixa impõe — o que se escolhe aqui é um conjunto,
 * o mesmo conceito que o campo aplica.
 *
 * A lista de um recorte tem centenas de pares, e carregar todas as fontes de
 * uma vez seria pesado demais: os itens entram em lotes, sob demanda.
 */
export class Shelf {
  onPick: ((pair: ShelfPair) => void) | null = null;

  private token = 0;
  private speed = 0;
  private wanted = 0;
  private frame: number | null = null;
  private last = 0;

  private pairs: ShelfPair[] = [];
  private shown = 0;
  private active = { a: "", b: "" };
  private roles: [WeightRole, WeightRole] = ["regular", "regular"];
  private moreButton: HTMLButtonElement | null = null;
  /** Previews do lote em voo; só o `render` os coleta, para saber quando parar de esconder. */
  private pending: Promise<unknown>[] = [];

  /** Estado das molas do dock, um por card. */
  private items: DockItem[] = [];
  /** Ponteiro em coordenada de conteúdo da fileira; `null` quando saiu. */
  private pointer: number | null = null;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly root: HTMLElement) {
    this.bindPointerScroll();
  }

  /**
   * Devolve uma promessa que resolve quando os previews do PRIMEIRO lote
   * assentam.
   *
   * Quem espera por ela é o indicador de carregamento. Sem isso a prateleira
   * reaparecia na hora e os chips iam trocando de fonte um a um conforme cada
   * arquivo chegava — o efeito de coisa carregando torto que o Leo apontou.
   * Esperando, os 24 aparecem juntos e já na fonte certa.
   */
  render(
    pairs: ShelfPair[], active: { a: string; b: string }, roles: [WeightRole, WeightRole],
  ): Promise<unknown> {
    // Invalida previews em voo: trocar de recorte não pode pintar fonte da faixa antiga.
    this.token += 1;
    this.pairs = pairs;
    this.active = active;
    this.roles = roles;
    this.shown = 0;
    this.moreButton = null;
    this.root.replaceChildren();
    this.root.scrollLeft = 0;

    this.pending = [];
    this.appendBatch();
    // `allSettled`: fonte que falha não pode segurar a prateleira escondida.
    return Promise.allSettled(this.pending);
  }

  /**
   * Move o destaque sem reconstruir a fileira. Navegar pelas setas dentro do
   * mesmo corte não muda a lista — recriar dezenas de chips a cada clique só
   * geraria churn de DOM e reemissão de previews.
   */
  setActive(active: { a: string; b: string }): void {
    this.active = active;
    const chips = this.root.querySelectorAll<HTMLElement>(".chip:not(.chip--more)");
    chips.forEach((chip, i) => {
      const pair = this.pairs[i];
      const on = Boolean(pair) && pair.a.f === active.a && pair.b.f === active.b;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", String(on));
    });
  }

  /**
   * Garante que o par de índice `i` esteja renderizado e visível. A navegação
   * pelas setas pode saltar além do lote carregado; sem isto o chip ativo
   * simplesmente não existiria na fileira.
   */
  reveal(index: number): void {
    if (index < 0 || index >= this.pairs.length) return;
    while (this.shown <= index && this.shown < this.pairs.length) this.appendBatch();

    const chip = this.root.querySelectorAll<HTMLElement>(".chip:not(.chip--more)")[index];
    if (!chip) return;
    const target = chip.offsetLeft - (this.root.clientWidth - chip.offsetWidth) / 2;
    const max = this.root.scrollWidth - this.root.clientWidth;
    this.root.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: "smooth" });
  }

  private appendBatch(): void {
    const token = this.token;
    this.moreButton?.remove();
    this.moreButton = null;

    const end = Math.min(this.shown + BATCH, this.pairs.length);
    for (let i = this.shown; i < end; i++) this.root.appendChild(this.chip(this.pairs[i], token));
    this.shown = end;

    if (this.shown < this.pairs.length) {
      this.moreButton = this.buildMore(this.pairs.length - this.shown);
      this.root.appendChild(this.moreButton);
    }
    // Cards novos entraram: o dock precisa conhecê-los antes do próximo frame.
    this.indexDock();
  }

  private buildMore(remaining: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip chip--more";
    const plus = document.createElement("span");
    plus.className = "chip__plus";
    plus.textContent = "+";
    button.appendChild(plus);
    const label = document.createElement("span");
    label.className = "chip__names";
    label.textContent = `carregar mais`;
    const count = document.createElement("span");
    count.className = "chip__names chip__count";
    count.textContent = `${remaining} restantes`;
    button.append(label, count);
    button.addEventListener("click", () => this.appendBatch());
    return button;
  }

  private chip(pair: ShelfPair, token: number): HTMLButtonElement {
    const isActive = pair.a.f === this.active.a && pair.b.f === this.active.b;
    const weightA = weightFor(pair.a, this.roles[0]);
    const weightB = weightFor(pair.b, this.roles[1]);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${isActive ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", `Usar ${pair.a.f} com ${pair.b.f}`);
    button.title = `${pair.a.f} + ${pair.b.f}`;

    const samples = document.createElement("span");
    samples.className = "chip__samples";
    const sampleA = document.createElement("span");
    sampleA.textContent = SAMPLE;
    sampleA.style.fontWeight = String(weightA);
    const sampleB = document.createElement("span");
    sampleB.textContent = SAMPLE;
    sampleB.style.fontWeight = String(weightB);
    samples.append(sampleA, sampleB);

    // Uma linha por nome: com os dois na mesma linha, cada chip tinha uma
    // largura e a fileira ficava irregular.
    const nameA = document.createElement("span");
    nameA.className = "chip__names";
    nameA.textContent = pair.a.f;
    const nameB = document.createElement("span");
    nameB.className = "chip__names chip__names--second";
    nameB.textContent = pair.b.f;

    button.append(samples, nameA, nameB);
    button.addEventListener("click", () => this.onPick?.(pair));

    this.pending.push(
      this.preview(sampleA, pair.a.f, weightA, token),
      this.preview(sampleB, pair.b.f, weightB, token),
    );
    return button;
  }

  /** Só aplica a fonte quando ela existe de fato — nada de nome renderizado
   *  numa fonte substituta, que é o que fazia a versão antiga mentir. */
  private async preview(
    node: HTMLElement, family: string, weight: number, token: number,
  ): Promise<void> {
    const ok = await loadFont(family, weight, SAMPLE);
    if (!ok || token !== this.token || !node.isConnected) return;
    node.style.fontFamily = `"${family}", serif`;
  }

  /**
   * Rolagem pela posição do ponteiro E lente do dock, do mesmo movimento.
   *
   * Rolagem: mouse à direita do centro corre para a direita, à esquerda para a
   * esquerda, mais rápido quanto mais longe. No toque não se aplica — lá o
   * arraste nativo já rola o bloco, e sem hover não existe dock.
   */
  private bindPointerScroll(): void {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    this.root.addEventListener("pointermove", (e) => {
      const r = this.root.getBoundingClientRect();
      if (r.width === 0) return;
      const offset = (e.clientX - r.left) / r.width * 2 - 1;      // -1 .. 1
      const magnitude = Math.abs(offset);
      this.wanted = magnitude < DEAD_ZONE
        ? 0
        : Math.sign(offset) * ((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE)) ** 2 * MAX_SPEED;
      // Ponteiro em coordenada de CONTEÚDO: a fileira rola, então a posição na
      // tela não serve para achar o card sob o cursor.
      this.pointer = e.clientX - r.left + this.root.scrollLeft;
      this.startTicker();
    }, { passive: true });

    this.root.addEventListener("pointerleave", () => {
      this.wanted = 0;
      this.pointer = null;
      this.startTicker();
    });
  }

  /** Reindexa os cards do dock. A fileira se reconstrói; as molas, não sobrevivem. */
  private indexDock(): void {
    this.items = [...this.root.querySelectorAll<HTMLElement>(".chip")]
      .map((el) => ({ el, scale: 1, vel: 0 }));
  }

  /**
   * `requestAnimationFrame`, e não o ticker do GSAP.
   *
   * É o mesmo relógio por baixo — o ticker do GSAP também roda em rAF — mas
   * aqui não há tween nenhum, só uma mola integrada à mão. Pendurar isso no
   * ticker de uma biblioteca de animação era indireção sem contrapartida, e o
   * campo (`field.ts`) já chama rAF direto.
   */
  private startTicker(): void {
    if (this.frame !== null) return;
    this.last = 0;
    this.frame = requestAnimationFrame(this.step);
  }

  /**
   * Aceleração suave da rolagem e mola do dock, no mesmo frame.
   * Solta o frame quando as duas coisas assentam.
   */
  private step = (time: number): void => {
    // Passo de tempo REAL e com teto: a mola é integrada, e um frame perdido
    // (aba em segundo plano) com dt grande a faria explodir.
    const dt = this.last === 0
      ? 1 / 60
      : Math.min(0.032, Math.max(0.001, (time - this.last) / 1000));
    this.last = time;

    this.speed += (this.wanted - this.speed) * 0.12;
    const rolando = Math.abs(this.speed) >= 0.05 || this.wanted !== 0;
    if (rolando) this.root.scrollLeft += this.speed;
    else this.speed = 0;

    const ampliando = this.magnify(dt);

    this.frame = rolando || ampliando ? requestAnimationFrame(this.step) : null;
  };

  /**
   * A lente. Devolve `true` enquanto alguma mola ainda está em movimento.
   *
   * Duas passadas: a primeira integra a escala de cada card, a segunda converte
   * o que cada um cresceu em deslocamento dos vizinhos. É a segunda que faz o
   * dock parecer um dock, e não cards se sobrepondo.
   */
  private magnify(dt: number): boolean {
    if (this.items.length === 0) return false;
    if (this.reduced) return false;

    const alvo = this.pointer;
    let viva = false;

    for (const item of this.items) {
      const meio = item.el.offsetLeft + item.el.offsetWidth / 2;
      const dist = alvo === null ? Number.POSITIVE_INFINITY : Math.abs(alvo - meio);
      // Queda linear, como no original.
      const destino = dist >= DOCK_RANGE ? 1 : 1 + (DOCK_PEAK - 1) * (1 - dist / DOCK_RANGE);

      for (let resta = dt; resta > 0;) {
        const h = Math.min(SPRING_STEP, resta);
        resta -= h;
        const a = (-SPRING.stiffness * (item.scale - destino) - SPRING.damping * item.vel) / SPRING.mass;
        item.vel += a * h;
        item.scale += item.vel * h;
      }

      if (Math.abs(item.scale - destino) > SPRING_REST || Math.abs(item.vel) > SPRING_REST) viva = true;
      else { item.scale = destino; item.vel = 0; }
    }

    // Quanto do crescimento total fica ANTES do ponteiro. Subtrair isso ancora a
    // lente no cursor: o que está à esquerda abre para a esquerda, o que está à
    // direita para a direita, e o card sob o dedo fica onde está.
    //
    // O card sob o cursor entra pela FRAÇÃO dele que fica à esquerda do dedo, e
    // não inteiro nem de fora. Contando por card inteiro, o de baixo do cursor
    // escorregava metade do que crescia — 21px, medidos.
    let ancora = 0;
    if (alvo !== null) {
      for (const item of this.items) {
        const esq = item.el.offsetLeft;
        const larg = item.el.offsetWidth;
        const extra = larg * (item.scale - 1);
        if (alvo >= esq + larg) ancora += extra;
        else if (alvo > esq) ancora += extra * ((alvo - esq) / larg);
      }
    }

    let antes = 0;
    for (const item of this.items) {
      const extra = item.el.offsetWidth * (item.scale - 1);
      const desloca = antes + extra / 2 - ancora;
      antes += extra;
      item.el.style.transform = `translateX(${desloca.toFixed(2)}px) scale(${item.scale.toFixed(4)})`;
    }

    return viva;
  }
}
