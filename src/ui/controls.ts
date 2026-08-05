interface Handlers {
  onGenerate: () => void;
  onContrast: (value: number) => void;
  onCopyLink: () => void;
}

/** Dez marcações; o slider anda em inteiros e converte para 0..1 aqui. */
export const CONTRAST_STEPS = 10;
const LAST_STEP = CONTRAST_STEPS - 1;

export const stepToContrast = (step: number): number =>
  Math.min(1, Math.max(0, step / LAST_STEP));

export const contrastToStep = (contrast: number): number =>
  Math.round(Math.min(1, Math.max(0, contrast)) * LAST_STEP);

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento obrigatório #${id} não encontrado.`);
  return el as T;
}

/**
 * Sem travas e sem escolher qual fonte é título: o algoritmo entrega o par e
 * cada card distribui os papéis. Restam o eixo de contraste e o gerar.
 */
export class Controls {
  private readonly contrast = required<HTMLInputElement>("contrast");
  private readonly generate = required<HTMLButtonElement>("generate");
  private readonly share = required<HTMLButtonElement>("share");
  private readonly nameA = required("name-a");
  private readonly nameB = required("name-b");

  bind(handlers: Handlers): void {
    this.buildTicks();
    this.generate.addEventListener("click", handlers.onGenerate);
    this.share.addEventListener("click", handlers.onCopyLink);

    // O slider anda em dez posições inteiras: sem isso, um micro toque gerava
    // um par novo a cada centésimo.
    let lastStep = Number(this.contrast.value);
    this.contrast.addEventListener("input", () => {
      const step = Number(this.contrast.value);
      if (step === lastStep) return;
      lastStep = step;
      handlers.onContrast(stepToContrast(step));
    });

    addEventListener("keydown", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (ev.code !== "Space" || target?.isContentEditable) return;
      // Barra de espaço em botão/slider já tem função nativa.
      if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement) return;
      ev.preventDefault();
      handlers.onGenerate();
    });
  }

  sync(a: string, b: string, contrast: number): void {
    this.nameA.textContent = a;
    this.nameB.textContent = b;
    const step = contrastToStep(contrast);
    // Não mexe no slider enquanto o usuário o arrasta.
    if (document.activeElement !== this.contrast) {
      this.contrast.value = String(step);
    }
    this.contrast.setAttribute("aria-valuetext", `corte ${step + 1} de ${CONTRAST_STEPS}`);
  }

  private buildTicks(): void {
    const ticks = document.getElementById("contrast-ticks");
    if (!ticks || ticks.childElementCount > 0) return;
    for (let i = 0; i < CONTRAST_STEPS; i++) ticks.appendChild(document.createElement("i"));
  }

  flash(message: string): void {
    const previous = this.share.textContent;
    this.share.textContent = message;
    setTimeout(() => { this.share.textContent = previous; }, 1600);
  }
}
