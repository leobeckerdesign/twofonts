interface Handlers {
  onGenerate: () => void;
  onContrast: (value: number) => void;
  onCopyLink: () => void;
}

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
    this.generate.addEventListener("click", handlers.onGenerate);
    this.share.addEventListener("click", handlers.onCopyLink);
    this.contrast.addEventListener("input", () => {
      handlers.onContrast(Number(this.contrast.value));
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
    // Não mexe no slider enquanto o usuário o arrasta.
    if (document.activeElement !== this.contrast) {
      this.contrast.value = String(contrast);
    }
    this.contrast.setAttribute("aria-valuetext", `${Math.round(contrast * 100)}% de contraste`);
  }

  flash(message: string): void {
    const previous = this.share.textContent;
    this.share.textContent = message;
    setTimeout(() => { this.share.textContent = previous; }, 1600);
  }
}
