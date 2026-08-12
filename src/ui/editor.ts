import { loadFont } from "../fonts";
import { weightFor } from "../pairs";
import { esc } from "../render";
import { assignRoles } from "../roles";
import type { FontMeta, WeightRole } from "../types";
import {
  clampTo,
  defaultState,
  LIMITS,
  nearestRole,
  rolesOf,
  slotCss,
  type SlotName,
  type TypesetState,
} from "./typeset";

/**
 * O editor lateral.
 *
 * Um bloco de texto por papel — título e parágrafo — cada um com o próprio
 * peso, caixa, corpo e entrelinha. É INDEPENDENTE dos cards: divide com eles só
 * o par de fontes ativo. O que se escreve aqui não vai para o palco, e o que
 * está escrito nos cards não volta para cá.
 *
 * O painel tem largura FIXA e vive deslocado para fora por `transform`; abrir é
 * trazê-lo de volta ao zero. Animar a largura pediria refluxo do texto a cada
 * frame — o parágrafo reembrulhando 60 vezes por segundo enquanto desliza — e é
 * exatamente o que o desenho não pode ter. Assim o navegador anima uma
 * transformada só, e o conteúdo nem sabe que se mexeu.
 */

const ROLE_LABEL: Record<WeightRole, string> = {
  light: "light",
  regular: "regular",
  bold: "bold",
};

const SLOT_LABEL: Record<SlotName, string> = { title: "título", body: "parágrafo" };

/**
 * A lista suspensa, escrita à mão.
 *
 * O `<select>` nativo foi a primeira tentativa e não serve: a lista dele é
 * desenhada pelo SISTEMA, fora do alcance do CSS — cantos retos, realce azul,
 * fonte do sistema. Num painel que é sobre tipografia, abrir uma janelinha do
 * Windows no meio da amostra é o pior lugar possível para quebrar o desenho.
 *
 * O preço é escrever teclado e ARIA à mão, o mesmo preço que o trilho do dock
 * pagou. As opções são `<button>` de verdade dentro de um `role="listbox"`, e o
 * foco anda por elas: assim Enter e Espaço acionam sozinhos, sem
 * `aria-activedescendant` e sem reimplementar o que o navegador já faz.
 */
function pick(slot: SlotName, kind: string, label: string): string {
  return `<div class="ed__pick" data-pick="${kind}">
    <button class="ed__trigger" type="button" role="combobox" aria-haspopup="listbox"
            aria-expanded="false" aria-label="${label} do ${SLOT_LABEL[slot]}">
      <span class="ed__cap">${label}</span>
      <span class="ed__pickval" data-pickval></span>
      <span class="ed__chev" aria-hidden="true"></span>
    </button>
    <div class="ed__list" role="listbox" aria-label="${label} do ${SLOT_LABEL[slot]}" hidden></div>
  </div>`;
}

/**
 * Uma régua. Mesma anatomia do trilho do dock: a pílula inteira é o controle, o
 * preenchimento cresce da esquerda, o cursor mora na borda dele e o valor fica
 * por dentro. A diferença é que aqui o `input[type=range]` continua existindo,
 * invisível, por cima — ele traz teclado, arrasto e ARIA de graça, e o desenho
 * vem do contêiner.
 *
 * Sem rótulo escrito: o que a régua governa está dito no VALOR que ela mostra —
 * "48px" só pode ser corpo, "1.02" só pode ser entrelinha. Escrever "medida" e
 * "entrelinha" dentro da pílula custava metade do curso do controle para dizer
 * o que o número já dizia. O leitor de tela continua ouvindo o nome inteiro,
 * que vive no `aria-label` do input.
 */
function range(slot: SlotName, kind: "size" | "leading", label: string, unit: string): string {
  const limit = LIMITS[slot][kind];
  return `<div class="ed__pill" data-pill="${kind}">
    <input class="ed__range" type="range" data-range="${kind}"
           min="${limit.min}" max="${limit.max}" step="${limit.step}"
           aria-label="${label} do ${SLOT_LABEL[slot]}${unit}" />
    <b class="ed__value num" data-out="${kind}" aria-hidden="true"></b>
  </div>`;
}

/**
 * Os controles do título ficam ACIMA dele, e os do parágrafo ABAIXO — os dois
 * textos se encontram no meio, encostados, como cairiam numa página de verdade.
 * O que se julga aqui é a conversa entre as duas fontes, e ela não existe com um
 * painel de botões atravessado entre uma e outra.
 */
function slotMarkup(slot: SlotName, text: string): string {
  const field = `<div class="ed__text" data-text contenteditable="plaintext-only" role="textbox"
         aria-multiline="true" spellcheck="false"
         aria-label="Texto do ${SLOT_LABEL[slot]}">${esc(text)}</div>`;
  // UMA linha por papel: peso, corpo, entrelinha. Eram duas, e a segunda
  // carregava a caixa (`Aa AA aa`) ao lado da entrelinha — mas o campo é
  // editável, e escrever em maiúscula ali é digitar em maiúscula. O controle
  // gastava uma linha inteira do painel para fazer o que o teclado já faz, e a
  // altura é justamente o que falta aqui.
  const controls = `<div class="ed__ctls">
      ${pick(slot, "weight", "peso")}
      ${range(slot, "size", "medida", " em pixels")}
      ${range(slot, "leading", "entrelinha", "")}
    </div>`;

  // Sem título de seção: com os controles do título ACIMA dele e os do
  // parágrafo abaixo, dizer "título" e "parágrafo" é legendar o óbvio.
  const inner = slot === "title" ? `${controls}${field}` : `${field}${controls}`;
  return `<section class="ed ed--${slot}" data-slot="${slot}">${inner}</section>`;
}

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento obrigatório #${id} não encontrado.`);
  return el as T;
}

export class Editor {
  /**
   * Avisa quem precisa reagir à abertura. No celular o editor e a vitrine somam
   * mais que a largura da tela, então quem abre um fecha o outro — e quem ata as
   * duas pontas é o `main`, porque nenhum dos dois deve conhecer o outro.
   */
  onToggle: ((open: boolean) => void) | null = null;

  private readonly panel = required("editor");
  private readonly body = required("editor-body");
  private readonly handle = required<HTMLButtonElement>("editor-handle");

  private state: TypesetState;
  private fonts: Record<SlotName, FontMeta | undefined> = { title: undefined, body: undefined };
  private roles: [WeightRole, WeightRole];
  private open = false;

  constructor(roles: [WeightRole, WeightRole]) {
    this.roles = roles;
    this.state = defaultState(roles);
    // O par no topo, na ordem em que aparece embaixo: primeiro a do título,
    // depois a do corpo. É a única legenda que sobrou no painel, e é a que
    // responde à pergunta que a pessoa faz olhando a amostra — qual é esta?
    this.body.innerHTML =
      `<header class="editor__pair">
         <span data-name="title">—</span><i aria-hidden="true">+</i><span data-name="body">—</span>
         <button class="ed__reset" type="button" data-reset>restaurar</button>
       </header>
       ${slotMarkup("title", this.state.title.text)}${slotMarkup("body", this.state.body.text)}`;
    // Recolhido, o corpo continua no DOM, apenas deslocado para fora da tela —
    // e `Tab` levaria para dentro dele, com o foco parando num campo invisível.
    // `inert` tira o painel inteiro da ordem de foco enquanto ele está fechado.
    this.body.inert = true;
    this.bind();
    // A altura livre muda com a janela, e o corte da dissolvência com ela. Havia
    // aqui um `ResizeObserver` medindo a barra de baixo para publicar `--bar-h`:
    // o cartão terminava acima dela e ela não tinha altura fixa. A barra deixou
    // de existir — o trilho subiu para a coluna da direita —, e o teto do cartão
    // virou a própria janela, que o CSS sabe medir sozinho.
    addEventListener("resize", () => this.markOverflow());
    this.paint();
  }

  /**
   * O par ativo. Quem decide qual família fica no título é `assignRoles` com o
   * índice zero — a mesma função, e o mesmo resultado, do primeiro card do
   * palco, correção de legibilidade inclusa. O texto digitado sobrevive; só as
   * famílias e os pesos indisponíveis mudam.
   */
  setPair(a: FontMeta, b: FontMeta, roles: [WeightRole, WeightRole]): void {
    const assignment = assignRoles(a, b, 0, roles);
    this.fonts = { title: assignment.title, body: assignment.body };
    this.roles = roles;
    this.state = {
      title: { ...this.state.title, weight: nearestRole(assignment.title, this.state.title.weight) },
      body: { ...this.state.body, weight: nearestRole(assignment.body, this.state.body.weight) },
    };
    this.paint();
    this.request();
  }

  private bind(): void {
    this.handle.addEventListener("click", () => this.toggle(!this.open));

    // Esc recolhe de qualquer lugar do painel, inclusive de dentro do texto.
    this.panel.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape" || !this.open) return;
      ev.preventDefault();
      // O foco volta para a alça dentro do `toggle`, que é onde ele já precisa
      // ser resgatado quando o fechamento vem do clique.
      this.toggle(false);
    });

    for (const section of this.panel.querySelectorAll<HTMLElement>(".ed")) {
      const slot = section.dataset.slot as SlotName;

      const text = section.querySelector<HTMLElement>("[data-text]");
      text?.addEventListener("input", () => {
        this.state[slot] = { ...this.state[slot], text: text.textContent ?? "" };
        // Escrever muda a altura do conteúdo, e é o que decide a dissolvência.
        this.markOverflow();
      });
      // Colar traz HTML junto — do Word, do Figma, de outra aba. `plaintext-only`
      // já derruba a formatação nos navegadores que o entendem; isto fecha o
      // resto, e de quebra impede que uma colagem gigante trave o painel.
      text?.addEventListener("paste", (ev) => {
        ev.preventDefault();
        const plain = (ev.clipboardData?.getData("text/plain") ?? "").slice(0, 4000);
        document.execCommand("insertText", false, plain);
      });

      for (const box of section.querySelectorAll<HTMLElement>("[data-pick]")) {
        this.bindPick(slot, box);
      }

      for (const input of section.querySelectorAll<HTMLInputElement>("[data-range]")) {
        input.addEventListener("input", () => {
          const kind = input.dataset.range as "size" | "leading";
          this.set(slot, { [kind]: clampTo(input.valueAsNumber, LIMITS[slot][kind]) });
        });
      }
    }

    this.panel.querySelector("[data-reset]")?.addEventListener("click", () => {
      // Volta ao estado de abertura INTEIRO, pesos do corte inclusos — não só
      // ao texto. Restaurar pela metade é o tipo de botão que ninguém confia.
      this.state = defaultState([
        nearestRole(this.fonts.title, this.roles[0]),
        nearestRole(this.fonts.body, this.roles[1]),
      ]);
      for (const section of this.panel.querySelectorAll<HTMLElement>(".ed")) {
        const slot = section.dataset.slot as SlotName;
        const text = section.querySelector<HTMLElement>("[data-text]");
        if (text) text.textContent = this.state[slot].text;
      }
      this.paint();
      this.request();
    });
  }

  /**
   * Abre, fecha e navega uma lista. Tudo o que o `<select>` dava de graça e que
   * agora é nosso: seta abre e anda, Enter e Espaço escolhem (nativo, porque a
   * opção é `<button>`), Esc e o clique fora fecham, e o foco sempre volta para
   * o gatilho — senão ele cairia no `<body>` e o Tab recomeçaria do topo.
   */
  private bindPick(slot: SlotName, box: HTMLElement): void {
    const trigger = box.querySelector<HTMLButtonElement>(".ed__trigger");
    const list = box.querySelector<HTMLElement>(".ed__list");
    if (!trigger || !list) return;
    const kind = box.dataset.pick;

    const opcoes = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>("[data-value]")];
    // `hidden` não é booleano: ele também aceita `"until-found"`, então a
    // pergunta tem de ser explícita para não virar `string | boolean`.
    const aberta = (): boolean => list.hidden === false;

    const abrir = (open: boolean, devolveFoco = true): void => {
      if (open === aberta()) return;
      list.hidden = !open;
      box.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        // Espaço abaixo é o que decide o lado: perto do rodapé do painel a
        // lista abre para CIMA, senão ela nasceria cortada pela rolagem.
        const rect = trigger.getBoundingClientRect();
        const limite = this.body.getBoundingClientRect().bottom;
        box.classList.toggle("is-up", rect.bottom + list.offsetHeight + 12 > limite);
        (opcoes().find((o) => o.getAttribute("aria-selected") === "true") ?? opcoes()[0])?.focus();
      } else if (devolveFoco) {
        trigger.focus();
      }
    };

    trigger.addEventListener("click", () => abrir(!aberta()));

    list.addEventListener("click", (ev) => {
      const option = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-value]");
      if (!option) return;
      const value = option.dataset.value;
      if (kind === "weight") this.set(slot, { weight: value as WeightRole });
      abrir(false);
    });

    box.addEventListener("keydown", (ev) => {
      const itens = opcoes();
      const atual = itens.indexOf(document.activeElement as HTMLButtonElement);

      switch (ev.key) {
        case "ArrowDown": case "ArrowUp": {
          ev.preventDefault();
          if (!aberta()) { abrir(true); return; }
          const passo = ev.key === "ArrowDown" ? 1 : -1;
          // Dá a volta: numa lista de três, insistir na ponta é só travar.
          itens[(atual + passo + itens.length) % itens.length]?.focus();
          return;
        }
        case "Escape":
          if (!aberta()) return;
          // NÃO deixa subir: o mesmo Esc recolheria o painel inteiro, e quem
          // fecha uma lista espera fechar a lista.
          ev.stopPropagation();
          ev.preventDefault();
          abrir(false);
          return;
        case "Tab":
          abrir(false, false);
      }
    });

    // Clique fora fecha. `pointerdown` e não `click`: o clique só chega depois
    // de soltar, e até lá a lista já teria sumido debaixo do dedo.
    document.addEventListener("pointerdown", (ev) => {
      if (!aberta() || box.contains(ev.target as Node)) return;
      abrir(false, false);
    });
  }

  private set(slot: SlotName, patch: Partial<TypesetState[SlotName]>): void {
    this.state = { ...this.state, [slot]: { ...this.state[slot], ...patch } };
    this.paint();
    this.request();
  }

  toggle(open: boolean): void {
    this.open = open;
    this.panel.classList.toggle("is-open", open);
    this.handle.setAttribute("aria-expanded", String(open));
    // A pergunta vem ANTES do `inert`: marcar o painel como inerte já tira o
    // foco de dentro dele, e a resposta seria sempre não.
    const focoDentro = this.body.contains(document.activeElement);
    this.body.inert = !open;
    // Fechar com o cursor dentro de um campo deixava o foco num texto que saiu
    // da tela: o teclado continuava escrevendo, invisível. A alça é o lugar
    // natural para o foco cair, porque é o que reabre.
    if (!open && focoDentro) this.handle.focus();
    if (open) {
      this.panel.querySelector<HTMLElement>(".ed__text")?.focus();
    }
    this.onToggle?.(open);
  }

  /**
   * Pede as fontes DOS DOIS papéis nos pesos escolhidos.
   *
   * O campo carrega só os pesos que o corte impõe; aqui o usuário escolhe outro,
   * e sem este pedido o navegador engorda ou afina o contorno por conta própria.
   * O peso falso é convincente o bastante para passar despercebido — e aí o
   * painel estaria mostrando uma fonte que não existe. As duas famílias já estão
   * fixadas pelo campo, então isto nunca é uma família nova, só uma face a mais.
   */
  private request(): void {
    for (const name of ["title", "body"] as const) {
      const font = this.fonts[name];
      if (!font) continue;
      void loadFont(font.f, weightFor(font, this.state[name].weight));
    }
  }

  /**
   * Marca se o conteúdo passou da altura do cartão. É o que liga a dissolvência
   * da borda de baixo — e ela precisa ser condicional, senão apaga a última
   * linha de controles em toda tela onde tudo cabe.
   */
  private markOverflow(): void {
    this.body.classList.toggle("is-cut", this.body.scrollHeight > this.body.clientHeight + 1);
  }

  /** Desenha o estado inteiro. Barato: são dois blocos e uns poucos botões. */
  private paint(): void {
    for (const section of this.panel.querySelectorAll<HTMLElement>(".ed")) {
      const slot = section.dataset.slot as SlotName;
      const current = this.state[slot];
      const font = this.fonts[slot];

      const text = section.querySelector<HTMLElement>("[data-text]");
      if (text) Object.assign(text.style, slotCss(slot, current, font));

      const nome = this.body.querySelector<HTMLElement>(`[data-name="${slot}"]`);
      if (nome) nome.textContent = font?.f ?? "—";

      this.paintPick(section, "weight", rolesOf(font), current.weight, (role) => ROLE_LABEL[role as WeightRole]);

      for (const input of section.querySelectorAll<HTMLInputElement>("[data-range]")) {
        const kind = input.dataset.range as "size" | "leading";
        const value = current[kind];
        // Não reescreve o que o usuário está arrastando: devolver o valor ao
        // input no meio do gesto faz o polegar pular de volta.
        if (input.valueAsNumber !== value) input.value = String(value);

        // `--pct` é a única variável do desenho, como no trilho do dock: o
        // preenchimento e a posição do cursor derivam dela.
        const limit = LIMITS[slot][kind];
        const pct = ((value - limit.min) / (limit.max - limit.min)) * 100;
        input.parentElement?.style.setProperty("--pct", `${pct.toFixed(2)}%`);

        const out = section.querySelector<HTMLElement>(`[data-out="${kind}"]`);
        if (out) out.textContent = kind === "size" ? `${value}px` : value.toFixed(2);
      }
    }

    // Depois de repintar tudo: corpo e entrelinha mudam a altura do conteúdo.
    this.markOverflow();
  }


  /**
   * Reconstrói uma lista suspensa. Os pesos mudam de família para família — uma
   * sem negrito não pode oferecer a opção —, então as opções são redesenhadas a
   * cada par em vez de nascerem no HTML. A comparação com `data-built` evita
   * refazê-las quando a lista é a mesma, o que fecharia a lista aberta na mão
   * do usuário no meio da escolha.
   */
  private paintPick(
    section: HTMLElement,
    kind: string,
    values: string[],
    active: string,
    label: (value: string) => string,
  ): void {
    const box = section.querySelector<HTMLElement>(`[data-pick="${kind}"]`);
    const list = box?.querySelector<HTMLElement>(".ed__list");
    if (!box || !list) return;

    const wanted = values.join("|");
    if (list.dataset.built !== wanted) {
      list.innerHTML = values
        .map((v) => `<button class="ed__opt" type="button" role="option" data-value="${esc(v)}">${esc(label(v))}</button>`)
        .join("");
      list.dataset.built = wanted;
    }

    const valor = box.querySelector<HTMLElement>("[data-pickval]");
    if (valor) valor.textContent = label(active);

    for (const option of list.querySelectorAll<HTMLButtonElement>("[data-value]")) {
      const on = option.dataset.value === active;
      option.classList.toggle("is-on", on);
      option.setAttribute("aria-selected", String(on));
    }
  }
}
