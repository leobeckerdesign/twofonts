import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { loadFont } from "../fonts";
import type { PairState } from "../types";

gsap.registerPlugin(Flip);

const HEADLINE_WEIGHT = 700;
const BODY_WEIGHT = 400;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface SpecimenApplyOptions {
  /** Pesos existentes no catálogo para a fonte A. O mais próximo de 700 é usado. */
  aWeights?: readonly number[];
  /** Pesos existentes no catálogo para a fonte B. O mais próximo de 400 é usado. */
  bWeights?: readonly number[];
  /** Retorna um relatório de carregamento sem alterar a chamada padrão Promise<void>. */
  report?: boolean;
}

export interface SpecimenFontResult {
  family: string;
  weight: number;
  loaded: boolean;
}

export interface SpecimenApplyResult {
  a: SpecimenFontResult;
  b: SpecimenFontResult;
  /** true quando outra chamada de apply substituiu esta antes do carregamento terminar. */
  superseded: boolean;
}

type ApplyWithoutReport = Omit<SpecimenApplyOptions, "report"> & {
  report?: false;
};

type ApplyWithReport = Omit<SpecimenApplyOptions, "report"> & {
  report: true;
};

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento obrigatório #${id} não encontrado.`);
  return element;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function nearestWeight(
  available: readonly number[] | undefined,
  preferred: number,
): number {
  let nearest = preferred;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of available ?? []) {
    if (!Number.isFinite(candidate) || candidate < 1 || candidate > 1000) continue;

    const weight = Math.round(candidate);
    const distance = Math.abs(weight - preferred);
    if (distance < nearestDistance || (distance === nearestDistance && weight > nearest)) {
      nearest = weight;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function fontStack(family: string, fallback: "serif" | "sans-serif"): string {
  const escaped = family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}", ${fallback}`;
}

async function safelyLoadFont(family: string, weight: number): Promise<boolean> {
  try {
    return await loadFont(family, weight);
  } catch {
    return false;
  }
}

export class Specimen {
  onTextEdit: ((text: string) => void) | null = null;

  /** Último resultado vigente; chamadas substituídas não sobrescrevem este valor. */
  lastResult: SpecimenApplyResult | null = null;

  private readonly headline = requiredElement("spec-headline");
  private readonly body = requiredElement("spec-body");
  private applyRevision = 0;
  private animations: gsap.core.Animation[] = [];

  constructor() {
    this.headline.addEventListener("input", () => {
      this.onTextEdit?.(this.headline.textContent ?? "");
    });

    if (!this.headline.hasAttribute("role")) this.headline.setAttribute("role", "textbox");
    if (!this.headline.hasAttribute("aria-label")) {
      this.headline.setAttribute("aria-label", "Texto de demonstração");
    }
    if (!this.headline.hasAttribute("aria-multiline")) {
      this.headline.setAttribute("aria-multiline", "false");
    }
  }

  /**
   * Troca as fontes sem subset, pois o texto é editável.
   *
   * A assinatura padrão continua retornando Promise<void>. Passe `report: true`
   * para receber falhas, pesos escolhidos e saber se a chamada foi substituída.
   */
  apply(state: PairState): Promise<void>;
  apply(state: PairState, options: ApplyWithoutReport): Promise<void>;
  apply(state: PairState, options: ApplyWithReport): Promise<SpecimenApplyResult>;
  async apply(
    state: PairState,
    options: SpecimenApplyOptions = {},
  ): Promise<void | SpecimenApplyResult> {
    const revision = ++this.applyRevision;
    const aWeight = nearestWeight(options.aWeights, HEADLINE_WEIGHT);
    const bWeight = nearestWeight(options.bWeights, BODY_WEIGHT);

    // Faz o estado vindo da URL aparecer imediatamente e não move o caret se
    // o usuário já estiver editando exatamente o mesmo texto.
    if (this.headline.textContent !== state.text) {
      this.headline.textContent = state.text;
    }

    this.stopAnimations();

    const [aLoaded, bLoaded] = await Promise.all([
      safelyLoadFont(state.a, aWeight),
      safelyLoadFont(state.b, bWeight),
    ]);
    const result: SpecimenApplyResult = {
      a: { family: state.a, weight: aWeight, loaded: aLoaded },
      b: { family: state.b, weight: bWeight, loaded: bLoaded },
      superseded: revision !== this.applyRevision,
    };

    // Uma resposta antiga nunca pode repor fontes sobre um par mais recente.
    if (result.superseded) return options.report ? result : undefined;

    this.lastResult = result;
    const targets = [this.headline, this.body];

    if (prefersReducedMotion()) {
      if (aLoaded) {
        this.headline.style.fontFamily = fontStack(state.a, "serif");
        this.headline.style.fontWeight = String(aWeight);
      } else {
        this.headline.style.fontFamily = "serif";
        this.headline.style.removeProperty("font-weight");
      }
      if (bLoaded) {
        this.body.style.fontFamily = fontStack(state.b, "sans-serif");
        this.body.style.fontWeight = String(bWeight);
      } else {
        this.body.style.fontFamily = "sans-serif";
        this.body.style.removeProperty("font-weight");
      }
      gsap.set(targets, { opacity: 1, x: 0, y: 0, clearProps: "scale" });
      return options.report ? result : undefined;
    }

    const flipState = Flip.getState(targets);
    if (aLoaded) {
      this.headline.style.fontFamily = fontStack(state.a, "serif");
      this.headline.style.fontWeight = String(aWeight);
    } else {
      this.headline.style.fontFamily = "serif";
      this.headline.style.removeProperty("font-weight");
    }
    if (bLoaded) {
      this.body.style.fontFamily = fontStack(state.b, "sans-serif");
      this.body.style.fontWeight = String(bWeight);
    } else {
      this.body.style.fontFamily = "sans-serif";
      this.body.style.removeProperty("font-weight");
    }

    const flip = Flip.from(flipState, {
      duration: 0.7,
      ease: "power3.out",
      absolute: true,
    });
    const reveal = gsap.fromTo(
      targets,
      { opacity: 0.3, y: 8 },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: "power2.out",
      },
    );
    this.animations = [flip, reveal];

    return options.report ? result : undefined;
  }

  private stopAnimations(): void {
    for (const animation of this.animations) animation.kill();
    this.animations = [];

    const targets = [this.headline, this.body];
    Flip.killFlipsOf(targets, true);
    gsap.killTweensOf(targets);
    gsap.set(targets, { opacity: 1, y: 0 });
  }
}
