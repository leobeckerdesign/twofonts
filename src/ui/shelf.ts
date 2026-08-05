import gsap from "gsap";
import { loadFont } from "../fonts";
import { weightFor } from "../pairs";
import type { FontMeta, WeightRole } from "../types";

/** Amostra mínima: o preview pede só estes glifos ao Google, poucos KB por fonte. */
const SAMPLE = "Aa";
/** Fração central onde o ponteiro não rola nada — sem isso a lista nunca para. */
const DEAD_ZONE = 0.18;
const MAX_SPEED = 15;

export interface ShelfPair {
  a: FontMeta;
  b: FontMeta;
}

/**
 * Os representantes do recorte atual do slider. Cada item é um PAR — as duas
 * fontes lado a lado, já nos pesos que a faixa impõe —, então o que se escolhe
 * aqui é o mesmo conceito que o campo mostra: um conjunto, não uma fonte solta.
 */
export class Shelf {
  onPick: ((pair: ShelfPair) => void) | null = null;

  private token = 0;
  private speed = 0;
  private wanted = 0;
  private ticking = false;

  constructor(private readonly root: HTMLElement) {
    this.bindPointerScroll();
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

  render(pairs: ShelfPair[], active: { a: string; b: string }, roles: [WeightRole, WeightRole]): void {
    // Invalida previews em voo: trocar de faixa não pode pintar fonte da antiga.
    const token = ++this.token;
    this.root.replaceChildren();

    for (const pair of pairs) {
      const isActive = pair.a.f === active.a && pair.b.f === active.b;
      const weightA = weightFor(pair.a, roles[0]);
      const weightB = weightFor(pair.b, roles[1]);

      const button = document.createElement("button");
      button.type = "button";
      button.className = `chip${isActive ? " is-active" : ""}`;
      button.setAttribute("aria-pressed", String(isActive));
      button.setAttribute("aria-label", `Usar ${pair.a.f} com ${pair.b.f}`);

      const samples = document.createElement("span");
      samples.className = "chip__samples";
      const nameEl = document.createElement("span");
      nameEl.className = "chip__names";
      nameEl.textContent = `${pair.a.f} + ${pair.b.f}`;

      const sampleA = document.createElement("span");
      sampleA.textContent = SAMPLE;
      sampleA.style.fontWeight = String(weightA);
      const sampleB = document.createElement("span");
      sampleB.textContent = SAMPLE;
      sampleB.style.fontWeight = String(weightB);
      samples.append(sampleA, sampleB);

      button.append(samples, nameEl);
      button.addEventListener("click", () => this.onPick?.(pair));
      this.root.appendChild(button);

      void this.preview(sampleA, pair.a.f, weightA, token);
      void this.preview(sampleB, pair.b.f, weightB, token);
    }
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
}
