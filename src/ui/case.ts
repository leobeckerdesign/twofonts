/**
 * O case, num modal.
 *
 * A página que explica o pareamento é um documento inteiro e autocontido —
 * fontes e figuras embutidas, 294KB — construído por `docs/case/build.mjs` em
 * `public/`. Aqui ela entra num `<iframe>` dentro de um `<dialog>` nativo.
 *
 * O `<dialog>` é o que faz este arquivo ser curto. `showModal()` já traz o
 * escurecimento do fundo (`::backdrop`), a trava de foco, o Esc, a camada de
 * topo acima de qualquer `z-index` e a inércia do resto da página. Escrever
 * isso à mão é o caminho conhecido para um modal que deixa o Tab escapar por
 * trás — e o app já tem dois painéis disputando teclado.
 *
 * O que sobra para nós é o que o `<dialog>` não faz: carregar o quadro só
 * quando ele é pedido, e fechar no clique fora.
 */

/** Fica em `public/`, então o `dist/` a leva junto. Ver `docs/case/README.md`. */
const CASE_URL = "/espaco-tipografico.html";

/**
 * Há um modal aberto?
 *
 * `showModal()` deixa o resto da página INERTE — sem foco, sem ponteiro —, mas
 * inércia não cobre teclado: a tecla vai para quem tem o foco, dentro do modal,
 * e sobe dali até a janela. Os atalhos globais do app (setas para andar no par,
 * espaço para sortear) escutam na janela, e sem esta pergunta trocariam as
 * fontes por trás do modal enquanto se lê sobre elas.
 */
export const modalAberto = (): boolean =>
  document.querySelector("dialog[open]") !== null;

export function initCase(): void {
  const dialog = document.getElementById("case") as HTMLDialogElement | null;
  const open = document.getElementById("case-open");
  const close = document.getElementById("case-close");
  const frame = document.getElementById("case-frame") as HTMLIFrameElement | null;
  if (!dialog || !open || !close || !frame) return;

  open.addEventListener("click", () => {
    // Só na primeira vez. O `src` vazio não custa rede nenhuma até aqui, e
    // depois de carregado o quadro fica montado — reabrir é instantâneo, e a
    // leitura volta onde parou.
    if (frame.getAttribute("src") === null) frame.setAttribute("src", CASE_URL);
    dialog.showModal();
  });

  close.addEventListener("click", () => dialog.close());

  /**
   * O foco volta para o botão, sempre.
   *
   * O `<dialog>` devolve o foco a quem o tinha ANTES de abrir — e quem abre por
   * clique de mouse nem sempre é um elemento focado (um `.click()` de código não
   * foca nada, e no Safari o clique num botão também não). Nesses casos o foco
   * voltava para o `<body>` e o Tab recomeçava do topo da página. Devolvendo à
   * mão, o ponto de partida é o mesmo em qualquer caminho.
   *
   * Sem anel à vista para quem usa mouse: o CSS só desenha `:focus-visible`, e o
   * navegador não o considera visível depois de uma interação de ponteiro.
   */
  dialog.addEventListener("close", () => open.focus());

  /**
   * Clique fora fecha.
   *
   * O `::backdrop` não é um elemento: o clique nele chega com o PRÓPRIO
   * `<dialog>` como alvo, então comparar alvos não distingue dentro de fora.
   * Quem distingue é a geometria — se o ponto caiu fora do retângulo do
   * cartão, foi no escuro.
   *
   * `clientX === 0 && clientY === 0` é o clique que veio do TECLADO (Enter ou
   * Espaço num botão): sem esta saída, acionar o "fechar" pelo teclado seria
   * lido como um clique no canto superior esquerdo — fora do cartão — e o
   * modal fecharia duas vezes.
   */
  dialog.addEventListener("click", (ev) => {
    if (ev.clientX === 0 && ev.clientY === 0) return;
    const r = dialog.getBoundingClientRect();
    const dentro = ev.clientX >= r.left && ev.clientX <= r.right
      && ev.clientY >= r.top && ev.clientY <= r.bottom;
    if (!dentro) dialog.close();
  });
}
