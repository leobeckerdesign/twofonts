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
 * Janela de coalescência do TECLADO, em ms.
 *
 * Cada passo do corte repinta os 15 cards, remede 42 blocos de texto e
 * reconstrói a vitrine inteira com dezenas de pedidos de fonte. Segurar a seta
 * dispararia isso a cada repetição da tecla, e o que se sente é a tela travando.
 * Um toque isolado aplica na hora; uma rajada aplica uma vez, ao parar.
 *
 * O arrasto NÃO passa por aqui — ele espera o dedo sair do trilho, e o porquê
 * está em `commit`.
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

/**
 * Duração da velada dos nomes no topo, em ms. Igual à transição de opacidade
 * do `#pair-meta` — o texto troca no fundo do vale, com a caixa invisível.
 *
 * Existe porque os dois nomes têm comprimentos diferentes: "Cinzel + IM Fell
 * French Canon SC" e "Baumans + Roboto Condensed" não ocupam a mesma largura, e
 * o bloco é alinhado à direita — trocar o texto na cara do usuário faz os dois
 * saltarem de lugar. Velado, o que se vê é a mesma dissolvência que o campo já
 * faz com os cards: sai, troca, volta.
 */
const NAME_FADE_MS = 180;

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
  private readonly meta = required("pair-meta");
  private readonly nameA = required("name-a");
  private readonly nameB = required("name-b");
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  private readonly spinner = required("busy");

  private step = contrastToStep(0.5);
  private busyTimer: ReturnType<typeof setTimeout> | undefined;
  private busyHide: ReturnType<typeof setTimeout> | undefined;
  private busyShownAt = 0;
  private settle: ReturnType<typeof setTimeout> | undefined;
  private lastInput = Number.NEGATIVE_INFINITY;
  /** O corte de onde o arrasto partiu, para saber se ao soltar houve mudança. */
  private stepAtGrab = 0;
  /**
   * O ponteiro que está arrastando; `null` quando ninguém está.
   *
   * Quem decidia isso era `hasPointerCapture`, e a captura não serve de estado:
   * ela é uma FACILIDADE — faz os eventos continuarem chegando quando o dedo
   * sai do trilho —, e o navegador pode devolvê-la sozinho (uma janela que
   * perde o foco, um gesto do sistema por cima). Quando isso acontecia, o
   * arrasto parava de responder sem soltar nada, e o trilho ficava preso no
   * meio do gesto. O dono do estado agora é este campo; a captura segue sendo
   * pedida, só não é mais consultada.
   */
  private dragPointer: number | null = null;
  private nameSwap: ReturnType<typeof setTimeout> | undefined;
  private pendingNames: { a: string; b: string } | null = null;
  private onContrast: ((value: number) => void) | null = null;

  bind(handlers: Handlers): void {
    this.onContrast = handlers.onContrast;
    this.buildTicks();
    this.paint();

    this.track.addEventListener("pointerdown", (ev) => {
      // Captura para o arrasto sobreviver ao ponteiro sair do trilho. Num
      // ponteiro que o navegador não considera ativo ela levanta NotFoundError,
      // e sem o `try` a exceção derrubaria o resto do gesto — o arrasto morreria
      // por causa da conveniência que existe para melhorá-lo.
      try { this.track.setPointerCapture(ev.pointerId); } catch { /* segue sem captura */ }
      this.dragPointer = ev.pointerId;
      this.track.dataset.dragging = "true";
      this.stepAtGrab = this.step;
      this.track.focus({ preventScroll: true });
      // Sem isto o arrasto seleciona o texto do valor pelo caminho.
      ev.preventDefault();
      this.commit(this.stepAt(ev.clientX));
    });

    this.track.addEventListener("pointermove", (ev) => {
      if (this.dragPointer !== ev.pointerId) return;
      this.commit(this.stepAt(ev.clientX));
    });

    /**
     * Soltar é o que aplica.
     *
     * Vale para o clique também: pressionar move o cursor, soltar troca as
     * fontes. Um clique isolado leva os dois eventos no mesmo instante, então a
     * diferença só aparece quando o dedo continua no trilho — que é exatamente
     * o caso que estávamos consertando.
     */
    const soltar = (ev: PointerEvent): void => {
      if (this.dragPointer !== ev.pointerId) return;
      if (this.track.hasPointerCapture(ev.pointerId)) this.track.releasePointerCapture(ev.pointerId);
      this.dragPointer = null;
      delete this.track.dataset.dragging;
      if (this.step === this.stepAtGrab) return;
      this.busy(true);
      this.onContrast?.(stepToContrast(this.step));
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
    this.setNames(a, b);
    // Não mexe no trilho enquanto o usuário o arrasta.
    if (this.track.dataset.dragging === undefined) {
      this.step = contrastToStep(contrast);
      this.paint();
    }
  }

  /**
   * Troca os nomes por dentro de uma velada, e não à vista.
   *
   * Sem movimento na tela não há velada: o texto entra direto. Uma dissolvência
   * de 180ms com a transição zerada pela preferência do sistema não seria um
   * efeito, seria só um atraso.
   *
   * Trocas encavaladas não reiniciam a velada — a de fora fica de pé e pinta o
   * ÚLTIMO par pedido. Reiniciando, uma rajada deixaria o topo apagado por todo
   * o tempo da rajada.
   */
  private setNames(a: string, b: string): void {
    if (this.nameA.textContent === a && this.nameB.textContent === b) return;

    if (this.reduced) {
      this.nameA.textContent = a;
      this.nameB.textContent = b;
      return;
    }

    this.pendingNames = { a, b };
    if (this.nameSwap !== undefined) return;

    this.meta.classList.add("is-swapping");
    this.nameSwap = setTimeout(() => {
      this.nameSwap = undefined;
      const next = this.pendingNames;
      this.pendingNames = null;
      if (next) {
        this.nameA.textContent = next.a;
        this.nameB.textContent = next.b;
      }
      this.meta.classList.remove("is-swapping");
    }, NAME_FADE_MS);
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

    /*
     * Arrastando, para por aqui: o corte só muda quando o dedo sai do trilho.
     *
     * Antes o primeiro passo do arrasto aplicava na hora — borda de subida — e
     * os seguintes coalesciam numa janela de 160ms. Só que 160ms é menos que
     * uma pausa involuntária da mão: no meio do gesto a janela fechava, o campo
     * dissolvia, remedia 42 blocos de texto e renascia com fontes novas, e
     * seguia assim a cada hesitação. O que se via era a tela tremendo enquanto
     * o cursor ainda estava sendo posicionado — e é impossível escolher um
     * corte olhando para um layout que se refaz debaixo do dedo.
     *
     * Agora o gesto inteiro é só o cursor andando. Solta, e aí sim: esqueleto,
     * fontes novas, cascata. Uma troca por gesto, sempre.
     */
    if (this.track.dataset.dragging !== undefined) return;

    this.busy(true);

    const now = performance.now();
    // A janela conta desde o último TOQUE, não desde a última aplicação:
    // contando da aplicação, uma rajada de setas reabriria a porta a cada 160ms
    // e o campo renasceria três, quatro vezes seguidas.
    const gestoNovo = now - this.lastInput > SETTLE_MS;
    this.lastInput = now;

    clearTimeout(this.settle);
    // Borda de subida para a tecla isolada, que responde na hora. Uma rajada
    // aplica uma vez ao parar — no meio dela só o cursor e o indicador se mexem.
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
