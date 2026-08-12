/**
 * A vitrine como gaveta.
 *
 * No desktop a coluna da direita é mobília: fica, e não recolhe. Aqui não há o
 * que decidir — sobra tela para o palco e para a lista ao mesmo tempo, e uma
 * alça para esconder o que não atrapalha só somaria um controle.
 *
 * No celular a conta muda. A coluna aberta mede 320px sobre uma tela de 390, e
 * o que ela cobre é o palco — a única coisa que o app existe para mostrar. Então
 * ela nasce RECOLHIDA, com a lombada de fora, e abre no toque. É a mesma
 * mecânica do editor na borda oposta, e de propósito: quem aprendeu a alça de um
 * lado já sabe a do outro.
 *
 * A classe não desenha nada. Ela liga `is-open`, mantém o `aria-expanded`
 * honesto e cuida do que o CSS não alcança: o `inert` do corpo e o resgate do
 * foco. O deslocamento é do CSS, e só existe dentro da consulta de mídia — é o
 * que faz o desktop continuar exatamente como estava.
 */

/** A MESMA quebra do CSS e do campo. Três lugares, um número — se um andar sozinho, a gaveta some ou trava. */
const MOBILE = "(max-width: 720px)";

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento obrigatório #${id} não encontrado.`);
  return el as T;
}

export class Gallery {
  /**
   * Avisa quem precisa reagir à abertura. No celular os dois painéis somam mais
   * que a largura da tela, então quem abre um fecha o outro — e é o `main` que
   * ata as duas pontas, porque nenhum dos dois deve conhecer o outro.
   */
  onToggle: ((open: boolean) => void) | null = null;

  private readonly panel = required("gallery");
  private readonly body = required("gallery-body");
  private readonly handle = required<HTMLButtonElement>("gallery-handle");
  private readonly mq = matchMedia(MOBILE);
  private open = false;

  constructor() {
    this.handle.addEventListener("click", () => this.toggle(!this.open));

    // Esc recolhe de qualquer lugar da coluna, inclusive de dentro do trilho.
    this.panel.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape" || !this.open || !this.mq.matches) return;
      ev.preventDefault();
      this.toggle(false);
    });

    // Girar o aparelho atravessa a quebra: o corpo não pode ficar `inert` numa
    // largura em que a coluna está à vista, e é isto que devolve o estado certo.
    this.mq.addEventListener("change", () => this.apply());
    this.apply();
  }

  /** `true` só onde a coluna é gaveta. No desktop ela é fixa, e recolher não é uma operação que exista. */
  get collapsible(): boolean {
    return this.mq.matches;
  }

  toggle(open: boolean): void {
    // Fora do celular não há gaveta, e um pedido para fechar não pode esconder
    // a coluna fixa. A comparação também corta o eco: `main` cruza este método
    // com o do editor, e sem ela um fecharia o outro de volta.
    if (!this.mq.matches || open === this.open) return;
    this.open = open;
    this.apply();
    this.onToggle?.(open);
  }

  private apply(): void {
    const gaveta = this.mq.matches;
    // Recolhida, a coluna continua no DOM, apenas deslocada para fora da tela —
    // e `Tab` levaria o foco para dentro dela, parando num card invisível.
    const visivel = !gaveta || this.open;

    this.panel.classList.toggle("is-open", this.open);
    this.handle.setAttribute("aria-expanded", String(this.open));

    // A pergunta vem ANTES do `inert`: marcar o corpo como inerte já tira o foco
    // de dentro dele, e a resposta seria sempre não.
    const focoDentro = this.body.contains(document.activeElement);
    this.body.inert = !visivel;
    // Fechar com o foco num card deixava o teclado num alvo fora da tela. A
    // lombada é o lugar natural para ele cair, porque é o que reabre.
    if (!visivel && focoDentro) this.handle.focus();
  }
}
