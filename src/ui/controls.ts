interface Handlers {
  onGenerate: () => void;
  onContrast: (value: number) => void;
}

/** Dez marcações; o slider anda em inteiros e converte para 0..1 aqui. */
export const CONTRAST_STEPS = 10;
const LAST_STEP = CONTRAST_STEPS - 1;
/** Divisórias internas: dez posições produzem nove marcas. */
const TICKS = CONTRAST_STEPS - 1;

/**
 * Janela de coalescência do slider, em ms.
 *
 * Cada passo do corte repinta os 15 cards, remede 42 blocos de texto e
 * reconstrói a prateleira inteira com dezenas de pedidos de fonte. Num arrasto
 * isso acontecia dez vezes, e o que se sentia era a barra travando.
 *
 * O relógio é `performance.now`, e não o ticker do GSAP: o ticker DORME quando
 * não há animação ativa — é o que acontece com `prefers-reduced-motion`, que
 * desliga a flutuação dos cards. Com o relógio parado o slider respondia uma
 * vez e emudecia. Aqui o controle não pode depender de haver animação em curso.
 */
const SETTLE_MS = 160;

/**
 * Teto do indicador de carregamento, em ms.
 *
 * O aviso de "terminou" vem do campo, e o campo depende de duas coisas que
 * podem não acontecer: uma fonte que talvez não chegue, e um callback de
 * animação que só roda se o ticker estiver de pé. Indicador preso aceso é pior
 * que indicador que apaga cedo, então ele apaga sozinho. Fica acima do teto de
 * espera por fontes do campo (3s), para não cortar a espera legítima.
 */
const BUSY_MAX_MS = 4_000;

/**
 * Piso de exibição do indicador, em ms.
 *
 * Trocar de par pode terminar em 40ms quando as duas famílias já estão em
 * cache, e um sinal que pisca por 40ms lê como falha de desenho, não como
 * resposta. O piso faz toda troca ter o mesmo gesto: aparece, segura, sai.
 * Acima disso quem manda é o trabalho — ele fica até o campo E a prateleira
 * avisarem que terminaram.
 */
const BUSY_MIN_MS = 300;

export const stepToContrast = (step: number): number =>
  Math.min(1, Math.max(0, step / LAST_STEP));

export const contrastToStep = (contrast: number): number =>
  Math.round(Math.min(1, Math.max(0, contrast)) * LAST_STEP);

const clampStep = (step: number): number => Math.min(LAST_STEP, Math.max(0, step));

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento obrigatório #${id} não encontrado.`);
  return el as T;
}

/**
 * O eixo de contraste, e só ele.
 *
 * O trilho é um `div` com `role="slider"`, não um `<input type=range>`: o
 * desenho pede TEXTO dentro do trilho, e nenhum `::-webkit-slider-*` permite
 * isso. O preço é escrever à mão o que o input dava de graça — teclado, ARIA e
 * arrasto — e é o que está aqui embaixo.
 */
export class Controls {
  private readonly track = required("contrast");
  private readonly valueLabel = required("contrast-value");
  private readonly nameA = required("name-a");
  private readonly nameB = required("name-b");

  private readonly spinner = required("busy");

  private step = contrastToStep(0.5);
  private busyTimer: ReturnType<typeof setTimeout> | undefined;
  private busyHide: ReturnType<typeof setTimeout> | undefined;
  private busyShownAt = 0;
  private settle: ReturnType<typeof setTimeout> | undefined;
  private lastInput = Number.NEGATIVE_INFINITY;
  private onContrast: ((value: number) => void) | null = null;

  bind(handlers: Handlers): void {
    this.onContrast = handlers.onContrast;
    this.buildTicks();
    this.paint();

    this.track.addEventListener("pointerdown", (ev) => {
      // Captura para o arrasto sobreviver ao ponteiro sair do trilho.
      this.track.setPointerCapture(ev.pointerId);
      this.track.dataset.dragging = "true";
      this.track.focus({ preventScroll: true });
      // Sem isto o arrasto seleciona o texto do valor pelo caminho.
      ev.preventDefault();
      this.commit(this.stepAt(ev.clientX));
    });

    this.track.addEventListener("pointermove", (ev) => {
      if (!this.track.hasPointerCapture(ev.pointerId)) return;
      this.commit(this.stepAt(ev.clientX));
    });

    const soltar = (ev: PointerEvent): void => {
      if (this.track.hasPointerCapture(ev.pointerId)) this.track.releasePointerCapture(ev.pointerId);
      delete this.track.dataset.dragging;
    };
    this.track.addEventListener("pointerup", soltar);
    this.track.addEventListener("pointercancel", soltar);

    this.track.addEventListener("keydown", (ev) => {
      let next: number;
      switch (ev.key) {
        case "ArrowRight": case "ArrowUp": next = this.step + 1; break;
        case "ArrowLeft": case "ArrowDown": next = this.step - 1; break;
        case "Home": next = 0; break;
        case "End": next = LAST_STEP; break;
        default: return;
      }
      ev.preventDefault();
      this.commit(clampStep(next));
    });

    addEventListener("keydown", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (ev.code !== "Space" || target?.isContentEditable) return;
      // Espaço é o atalho de sortear, mas é TAMBÉM como o teclado aciona um
      // botão em foco. Sem esta saída, escolher um peso no editor pelo teclado
      // trocava o par no mesmo gesto — e o painel media outra fonte. Vale para
      // todo controle focável, não só para os do editor: um chip da prateleira
      // já sofria disto antes de o painel existir.
      if (target?.closest?.("a, button, input, select, textarea, [role=slider]")) return;
      ev.preventDefault();
      handlers.onGenerate();
    });
  }

  sync(a: string, b: string, contrast: number): void {
    this.nameA.textContent = a;
    this.nameB.textContent = b;
    // Não mexe no trilho enquanto o usuário o arrasta.
    if (this.track.dataset.dragging === undefined) {
      this.step = contrastToStep(contrast);
      this.paint();
    }
  }

  /**
   * Sinaliza que um conjunto novo de fontes está a caminho.
   *
   * Duas coisas ao mesmo tempo: a prateleira recua com uma linha varrendo o
   * topo, e o indicador acende no centro da tela. Serve para dois problemas: dá
   * resposta imediata mesmo quando o trabalho foi adiado, e esconde os chips
   * aparecendo um a um conforme cada fonte chega.
   *
   * `busy(false)` NÃO apaga na hora — respeita o piso de `BUSY_MIN_MS` contado
   * desde que acendeu. E acender de novo com ele já aceso não reinicia a
   * contagem: o piso é da APARIÇÃO, não de cada chamada.
   */
  busy(on: boolean): void {
    clearTimeout(this.busyTimer);
    document.getElementById("shelf-wrap")?.classList.toggle("is-busy", on);

    if (on) {
      clearTimeout(this.busyHide);
      if (!this.spinner.classList.contains("is-on")) {
        this.busyShownAt = performance.now();
        this.spinner.classList.add("is-on");
      }
      this.busyTimer = setTimeout(() => this.busy(false), BUSY_MAX_MS);
      return;
    }

    const resto = BUSY_MIN_MS - (performance.now() - this.busyShownAt);
    clearTimeout(this.busyHide);
    this.busyHide = setTimeout(() => this.spinner.classList.remove("is-on"), Math.max(0, resto));
  }

  /** Passo sob o ponteiro. O trilho inteiro é área útil, ponta a ponta. */
  private stepAt(clientX: number): number {
    const r = this.track.getBoundingClientRect();
    if (r.width <= 0) return this.step;
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(t * LAST_STEP);
  }

  private commit(step: number): void {
    if (step === this.step) return;
    this.step = step;
    // PINTA NA HORA. O trabalho pesado espera, o cursor não: com o input nativo
    // o navegador movia o polegar de graça, e aqui o dono do desenho sou eu.
    this.paint();
    this.busy(true);

    const now = performance.now();
    // A janela conta desde o último TOQUE, não desde a última aplicação.
    // Contando da aplicação, um arrasto contínuo reabria a porta a cada 160ms e
    // o campo dissolvia e renascia três, quatro vezes seguidas — era esse
    // estroboscópio que se via ao arrastar.
    const gestoNovo = now - this.lastInput > SETTLE_MS;
    this.lastInput = now;

    clearTimeout(this.settle);
    // Borda de subida para o clique isolado, que responde na hora. O arrasto
    // aplica uma vez ao parar — no meio dele só o cursor e o indicador se mexem.
    if (gestoNovo) this.onContrast?.(stepToContrast(step));
    else this.settle = setTimeout(() => this.onContrast?.(stepToContrast(this.step)), SETTLE_MS);
  }

  /** Desenho do trilho. Uma variável só: o resto o CSS deriva. */
  private paint(): void {
    const pct = (this.step / LAST_STEP) * 100;
    this.track.style.setProperty("--pct", `${pct}%`);
    this.track.setAttribute("aria-valuenow", String(this.step + 1));
    this.track.setAttribute("aria-valuetext", `corte ${this.step + 1} de ${CONTRAST_STEPS}`);
    this.valueLabel.textContent = `${this.step + 1}/${CONTRAST_STEPS}`;
  }

  private buildTicks(): void {
    const ticks = this.track.querySelector(".scrubber__ticks");
    if (!ticks || ticks.childElementCount > 0) return;
    for (let i = 1; i <= TICKS; i++) {
      const tick = document.createElement("i");
      tick.style.left = `${(i / CONTRAST_STEPS) * 100}%`;
      ticks.appendChild(tick);
    }
  }
}
