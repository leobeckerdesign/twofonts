import { loadFont } from "../fonts";
import { weightFor } from "../pairs";
import type { FontMeta, WeightRole } from "../types";

/**
 * O primeiro nome da família, e é ele que o card escreve em corpo grande.
 *
 * "Libre Baskerville" vira "Libre". O nome inteiro em 40px não cabe na coluna
 * sem quebrar em duas linhas ou receber reticências — e reticências no meio de
 * uma AMOSTRA escondem justamente o que ela existe para mostrar. O nome
 * completo continua dito embaixo, na legenda em mono, que é a única linha do
 * card que não troca de fonte e por isso pode ser cortada sem perder nada.
 *
 * A exceção são as famílias que começam por uma SIGLA. "PT Serif" cortada no
 * primeiro espaço vira "PT", "IBM Plex Sans" vira "IBM", "DM Mono" vira "DM" —
 * duas letras num card de 40px, e nenhuma delas é o nome da fonte. Quando o
 * primeiro pedaço não tem minúscula (é sigla) ou tem no máximo duas letras, o
 * nome leva a palavra seguinte junto. É por isso que a regra olha a CAIXA e não
 * só o tamanho: "Agu Display" e "Cal Sans" param na primeira palavra, que é
 * onde o nome de fato acaba — o que vem depois é o estilo.
 */
function firstName(family: string): string {
  const parts = family.split(" ");
  const head = parts[0];
  if (parts.length < 2 || head === undefined) return family;
  const isSigla = head.length <= 2 || head === head.toUpperCase();
  return isSigla ? `${head} ${parts[1]}` : head;
}

/**
 * Quantos pares por lote.
 *
 * Eram 24, medida da fileira horizontal, onde cada item era um chip de 150px e
 * uma dúzia cabia na tela. Em pé o item é um card e só três ou quatro aparecem
 * de uma vez — e o primeiro lote é o que o indicador de carregamento espera.
 * Doze pares já são duas telas de rolagem, por metade do custo de abertura.
 */
const BATCH = 12;

/* ---------- lente ----------
   Aumento por proximidade do ponteiro, como o dock do macOS. A mecânica é a do
   `dock` do ibelick (motion-primitives) — queda LINEAR ao longo de um alcance
   fixo e mola `{mass:.1, stiffness:150, damping:12}` —, mas o pico aqui é outro.

   Lá, e na versão horizontal disto, o item cresce 28%. Num card de coluna
   inteira isso seria caricato: 28% de 300px são 84px saltando por cima do
   campo, e os vizinhos empurrados quase um card de distância. A lente encolheu
   para 6% — o suficiente para o card sob o cursor se destacar do empilhamento,
   pouco o bastante para a coluna continuar uma coluna. */
const DOCK_PEAK = 1.06;
/** Alcance da lente, em px de conteúdo: pouco mais de um card, então 2 a 3 participam. */
const DOCK_RANGE = 210;
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
 * Os pares do recorte atual do slider, empilhados numa coluna à direita.
 *
 * Cada card escreve as duas fontes com o próprio primeiro nome, nos pesos que a
 * faixa impõe — o que se escolhe aqui é um conjunto, o mesmo conceito que o
 * campo aplica. Em pé há espaço para a amostra ser a palavra inteira em corpo
 * de leitura, e não o par de glifos `Aa` que a fileira horizontal comportava.
 *
 * A lista de um recorte tem centenas de pares, e carregar todas as fontes de
 * uma vez seria pesado demais: os itens entram em lotes, sob demanda.
 */
export class Shelf {
  onPick: ((pair: ShelfPair) => void) | null = null;

  private token = 0;
  private frame: number | null = null;
  private last = 0;

  private pairs: ShelfPair[] = [];
  private shown = 0;
  private active = { a: "", b: "" };
  private roles: [WeightRole, WeightRole] = ["regular", "regular"];
  private moreButton: HTMLButtonElement | null = null;
  /** Previews do lote em voo; só o `render` os coleta, para saber quando parar de esconder. */
  private pending: Promise<unknown>[] = [];

  /** Estado das molas da lente, um por card. */
  private items: DockItem[] = [];
  /**
   * Ponteiro em coordenada da CAIXA (topo da coluna = 0); `null` quando saiu.
   *
   * Na versão horizontal isto era coordenada de conteúdo, com o `scrollLeft` já
   * somado — dava certo porque a própria lente rolava a fileira, e o valor era
   * recalculado no mesmo frame. Aqui quem rola é a roda do usuário, e um valor
   * de conteúdo guardado envelhece entre um `pointermove` e o próximo: a lente
   * ficaria acesa num card que já saiu de baixo do cursor. Guardando a posição
   * na caixa, o `scrollTop` entra na conta na hora de usar, sempre atual.
   */
  private pointer: number | null = null;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private readonly root: HTMLElement) {
    this.bindPointer();
  }

  /**
   * Devolve uma promessa que resolve quando os previews do PRIMEIRO lote
   * assentam.
   *
   * Quem espera por ela é o indicador de carregamento. Sem isso a vitrine
   * reaparecia na hora e os cards iam trocando de fonte um a um conforme cada
   * arquivo chegava — o efeito de coisa carregando torto que o Leo apontou.
   * Esperando, o lote aparece junto e já na fonte certa.
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
    this.root.scrollTop = 0;

    this.pending = [];
    this.appendBatch();
    // `allSettled`: fonte que falha não pode segurar a vitrine escondida.
    return Promise.allSettled(this.pending);
  }

  /**
   * Move o destaque sem reconstruir a coluna. Navegar pelas setas dentro do
   * mesmo corte não muda a lista — recriar dezenas de cards a cada clique só
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
   * pelas setas pode saltar além do lote carregado; sem isto o card ativo
   * simplesmente não existiria na coluna.
   */
  reveal(index: number): void {
    if (index < 0 || index >= this.pairs.length) return;
    while (this.shown <= index && this.shown < this.pairs.length) this.appendBatch();

    const chip = this.root.querySelectorAll<HTMLElement>(".chip:not(.chip--more)")[index];
    if (!chip) return;
    const target = chip.offsetTop - (this.root.clientHeight - chip.offsetHeight) / 2;
    const max = this.root.scrollHeight - this.root.clientHeight;
    this.root.scrollTo({ top: Math.max(0, Math.min(max, target)), behavior: "smooth" });
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
    // Cards novos entraram: a lente precisa conhecê-los antes do próximo frame.
    this.indexDock();
  }

  private buildMore(remaining: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip chip--more";
    const plus = document.createElement("span");
    plus.className = "chip__plus";
    plus.textContent = "+";
    const label = document.createElement("span");
    label.className = "chip__pair";
    label.textContent = `carregar mais`;
    const count = document.createElement("span");
    count.className = "chip__pair chip__count";
    count.textContent = `${remaining} restantes`;
    button.append(plus, label, count);
    button.addEventListener("click", () => this.appendBatch());
    return button;
  }

  private chip(pair: ShelfPair, token: number): HTMLButtonElement {
    const isActive = pair.a.f === this.active.a && pair.b.f === this.active.b;
    const weightA = weightFor(pair.a, this.roles[0]);
    const weightB = weightFor(pair.b, this.roles[1]);
    const wordA = firstName(pair.a.f);
    const wordB = firstName(pair.b.f);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${isActive ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", `Usar ${pair.a.f} com ${pair.b.f}`);
    button.title = `${pair.a.f} + ${pair.b.f}`;

    // As duas amostras são as duas primeiras linhas do card, uma sob a outra —
    // é a mesma leitura vertical que o par tem no palco, título em cima e texto
    // embaixo, e não dois glifos lado a lado disputando a mesma linha de base.
    const sampleA = document.createElement("span");
    sampleA.className = "chip__word";
    sampleA.textContent = wordA;
    sampleA.style.fontWeight = String(weightA);
    const sampleB = document.createElement("span");
    sampleB.className = "chip__word chip__word--second";
    sampleB.textContent = wordB;
    sampleB.style.fontWeight = String(weightB);

    // A legenda em mono é o que o primeiro nome não diz: "Libre" pode ser
    // Baskerville ou Franklin, e são fontes sem parentesco nenhum.
    const caption = document.createElement("span");
    caption.className = "chip__pair";
    caption.textContent = `${pair.a.f} + ${pair.b.f}`;

    button.append(sampleA, sampleB, caption);
    button.addEventListener("click", () => this.onPick?.(pair));

    this.pending.push(
      this.preview(sampleA, pair.a.f, weightA, wordA, token),
      this.preview(sampleB, pair.b.f, weightB, wordB, token),
    );
    return button;
  }

  /** Só aplica a fonte quando ela existe de fato — nada de nome renderizado
   *  numa fonte substituta, que é o que fazia a versão antiga mentir.
   *
   *  O subset pedido ao Google é a PALAVRA que o card escreve, e não mais um
   *  `Aa` fixo: são poucos glifos a mais, e sem eles a amostra cairia na fonte
   *  de reserva justamente nas letras que ela precisa mostrar. */
  private async preview(
    node: HTMLElement, family: string, weight: number, sample: string, token: number,
  ): Promise<void> {
    const ok = await loadFont(family, weight, sample);
    if (!ok || token !== this.token || !node.isConnected) return;
    node.style.fontFamily = `"${family}", serif`;
  }

  /**
   * A lente segue o ponteiro; a rolagem é da roda.
   *
   * Deitada, a vitrine rolava sozinha pela posição do cursor: era a única
   * afordância que ela tinha, porque roda vertical não anda com fileira
   * horizontal. Em pé isso vira estorvo — a roda já rola a coluna (o campo se
   * declara alheio a `#gallery`), e uma lista que desliza sozinha sob o cursor
   * afasta o card justamente de quem foi clicá-lo.
   *
   * No toque não se aplica: lá o arraste nativo já rola, e sem hover não existe
   * lente.
   */
  private bindPointer(): void {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    this.root.addEventListener("pointermove", (e) => {
      const r = this.root.getBoundingClientRect();
      if (r.height === 0) return;
      this.pointer = e.clientY - r.top;
      this.startTicker();
    }, { passive: true });

    this.root.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.startTicker();
    });

    // Rolar move os cards por baixo de um cursor parado: sem isto a lente só
    // recalcularia no próximo movimento do mouse, e ficaria acesa no lugar
    // errado durante toda a rolagem.
    this.root.addEventListener("scroll", () => {
      if (this.pointer !== null) this.startTicker();
    }, { passive: true });
  }

  /** Reindexa os cards da lente. A coluna se reconstrói; as molas, não sobrevivem. */
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

  /** Integra as molas e solta o frame quando todas assentam. */
  private step = (time: number): void => {
    // Passo de tempo REAL e com teto: a mola é integrada, e um frame perdido
    // (aba em segundo plano) com dt grande a faria explodir.
    const dt = this.last === 0
      ? 1 / 60
      : Math.min(0.032, Math.max(0.001, (time - this.last) / 1000));
    this.last = time;

    this.frame = this.magnify(dt) ? requestAnimationFrame(this.step) : null;
  };

  /**
   * A lente. Devolve `true` enquanto alguma mola ainda está em movimento.
   *
   * Duas passadas: a primeira integra a escala de cada card, a segunda converte
   * o que cada um cresceu em deslocamento dos vizinhos. É a segunda que faz a
   * pilha respirar, em vez de os cards se sobreporem.
   */
  private magnify(dt: number): boolean {
    if (this.items.length === 0) return false;
    if (this.reduced) return false;

    // O ponteiro é guardado em coordenada da CAIXA; o conteúdo rolou desde
    // então, e é aqui que a rolagem entra na conta.
    const alvo = this.pointer === null ? null : this.pointer + this.root.scrollTop;
    let viva = false;

    for (const item of this.items) {
      const meio = item.el.offsetTop + item.el.offsetHeight / 2;
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

    // Quanto do crescimento total fica ACIMA do ponteiro. Subtrair isso ancora a
    // lente no cursor: o que está em cima abre para cima, o que está embaixo
    // para baixo, e o card sob o dedo fica onde está.
    //
    // O card sob o cursor entra pela FRAÇÃO dele que fica acima do dedo, e não
    // inteiro nem de fora. Contando por card inteiro, o de baixo do cursor
    // escorregava metade do que crescia.
    let ancora = 0;
    if (alvo !== null) {
      for (const item of this.items) {
        const topo = item.el.offsetTop;
        const alt = item.el.offsetHeight;
        const extra = alt * (item.scale - 1);
        if (alvo >= topo + alt) ancora += extra;
        else if (alvo > topo) ancora += extra * ((alvo - topo) / alt);
      }
    }

    let antes = 0;
    for (const item of this.items) {
      const extra = item.el.offsetHeight * (item.scale - 1);
      const desloca = antes + extra / 2 - ancora;
      antes += extra;
      item.el.style.transform = `translateY(${desloca.toFixed(2)}px) scale(${item.scale.toFixed(4)})`;
    }

    return viva;
  }
}
