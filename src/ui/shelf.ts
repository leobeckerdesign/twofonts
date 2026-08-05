import gsap from "gsap";
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
  private ticking = false;

  private pairs: ShelfPair[] = [];
  private shown = 0;
  private active = { a: "", b: "" };
  private roles: [WeightRole, WeightRole] = ["regular", "regular"];
  private moreButton: HTMLButtonElement | null = null;

  constructor(private readonly root: HTMLElement) {
    this.bindPointerScroll();
  }

  render(pairs: ShelfPair[], active: { a: string; b: string }, roles: [WeightRole, WeightRole]): void {
    // Invalida previews em voo: trocar de recorte não pode pintar fonte da faixa antiga.
    this.token += 1;
    this.pairs = pairs;
    this.active = active;
    this.roles = roles;
    this.shown = 0;
    this.moreButton = null;
    this.root.replaceChildren();
    this.root.scrollLeft = 0;
    this.appendBatch();
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

    void this.preview(sampleA, pair.a.f, weightA, token);
    void this.preview(sampleB, pair.b.f, weightB, token);
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
   * Rolagem pela posição do ponteiro: mouse à direita do centro corre para a
   * direita, à esquerda para a esquerda, mais rápido quanto mais longe. No
   * toque não se aplica — lá o próprio arraste nativo já rola o bloco.
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
      this.startTicker();
    }, { passive: true });

    this.root.addEventListener("pointerleave", () => { this.wanted = 0; });
  }

  private startTicker(): void {
    if (this.ticking) return;
    this.ticking = true;
    gsap.ticker.add(this.step);
  }

  /** Aceleração suave; para de consumir frames quando a lista está parada. */
  private step = (): void => {
    this.speed += (this.wanted - this.speed) * 0.12;
    if (Math.abs(this.speed) < 0.05 && this.wanted === 0) {
      this.speed = 0;
      this.ticking = false;
      gsap.ticker.remove(this.step);
      return;
    }
    this.root.scrollLeft += this.speed;
  };
}
