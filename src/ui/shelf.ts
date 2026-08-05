import { loadFont } from "../fonts";
import { weightFor } from "../pairs";
import type { FontMeta, WeightRole } from "../types";

/** Amostra mínima: o preview pede só estes glifos ao Google, poucos KB por fonte. */
const SAMPLE = "Aa";

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

  constructor(private readonly root: HTMLElement) {}

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
