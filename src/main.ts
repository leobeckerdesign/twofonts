import "./styles.css";
import { initBackground } from "./background";
import { Field } from "./field";
import { loadFont, pinFontFamilies } from "./fonts";
import { fontByFamily, loadPairs, pairsIn, pickPair, weightRoles } from "./pairs";
import { assignRoles } from "./roles";
import type { AppState, FontMeta, PairsData } from "./types";
import { CONTRAST_STEPS, Controls, stepToContrast } from "./ui/controls";
import { Shelf } from "./ui/shelf";
import { decodeState, encodeState } from "./url-state";

const loading = document.getElementById("loading")!;
const fieldRoot = document.getElementById("field")!;

function fail(message: string): void {
  loading.classList.remove("is-done");
  loading.textContent = message;
}

/** Só usa o par da URL se as duas famílias ainda existirem no catálogo. */
function stateFromUrl(data: PairsData): AppState | null {
  const url = decodeState(location.search.slice(1));
  if (!url.a || !url.b) return null;
  if (!fontByFamily(data, url.a) || !fontByFamily(data, url.b)) return null;
  return { a: url.a, b: url.b, contrast: url.contrast };
}

async function boot(): Promise<void> {
  initBackground(document.getElementById("bg") as HTMLCanvasElement);

  let data: PairsData;
  try {
    data = await loadPairs();
  } catch {
    fail("Não foi possível carregar o catálogo de pares.");
    return;
  }

  const url = decodeState(location.search.slice(1));
  const first = pickPair(data, url.contrast);
  if (!first) {
    fail("O catálogo de pares veio vazio.");
    return;
  }

  let state: AppState = stateFromUrl(data) ?? { ...first, contrast: url.contrast };

  const field = new Field(fieldRoot);
  const controls = new Controls();
  const shelf = new Shelf(document.getElementById("shelf")!);

  // Lista de pares do corte ativo e onde estamos nela: as setas caminham por
  // aqui, e é a mesma lista que a prateleira exibe.
  let current: { a: FontMeta; b: FontMeta }[] = [];
  let cursor = 0;
  let renderedContrast = Number.NaN;

  shelf.onPick = (pair) => {
    if (pair.a.f === state.a && pair.b.f === state.b) return;
    state = { ...state, a: pair.a.f, b: pair.b.f };
    apply(true);
  };

  // Carrega só os pesos que os cards realmente pedem, e devolve a promessa:
  // é ela que tira o esqueleto e dispara a cascata.
  field.onFontsNeeded = (families) => {
    const roles = weightRoles(data, state.contrast);
    const a = fontByFamily(data, state.a);
    const b = fontByFamily(data, state.b);
    if (!a || !b) return;

    pinFontFamilies(families);
    const assignment = assignRoles(a, b, 0, roles);
    const weights = new Set<number>([assignment.titleWeight, assignment.bodyWeight]);
    const jobs: Promise<boolean>[] = [];
    for (const family of families) {
      for (const weight of weights) jobs.push(loadFont(family, weight));
    }
    return Promise.all(jobs);
  };

  const apply = (animate: boolean): void => {
    const a = fontByFamily(data, state.a);
    const b = fontByFamily(data, state.b);
    if (!a || !b) return;

    const roles = weightRoles(data, state.contrast);
    const pair = { a, b, roles, contrast: state.contrast };
    if (animate) field.swap(pair);
    else field.setPair(pair);

    controls.sync(state.a, state.b, state.contrast);

    // O sortear escolhe entre centenas de pares: se o atual não pertencer à
    // lista da faixa, entra na frente para o destaque ter o que destacar.
    const sameCut = renderedContrast === state.contrast;
    let list = sameCut ? current : pairsIn(data, state.contrast);
    let index = list.findIndex((p) => p.a.f === state.a && p.b.f === state.b);
    const outsider = index < 0;

    if (!sameCut || outsider) {
      // Rotaciona a lista para começar no par ativo. Sem isso, um par sorteado
      // no fim da faixa obrigaria a prateleira a carregar todos os lotes até
      // ele — centenas de fontes de uma vez só para mostrar o destaque.
      list = outsider
        ? [{ a, b }, ...list]
        : [...list.slice(index), ...list.slice(0, index)];
      index = 0;
      current = list;
      cursor = 0;
      shelf.render(current, { a: state.a, b: state.b }, roles);
      renderedContrast = state.contrast;
    } else {
      // Andar de seta não muda a lista: só o destaque se move.
      current = list;
      cursor = index;
      shelf.setActive({ a: state.a, b: state.b });
    }
    shelf.reveal(cursor);
    history.replaceState(null, "", `${location.pathname}?${encodeState(state)}`);
  };

  /** Avança ou volta dentro do corte atual, dando a volta nas pontas. */
  const move = (delta: number): void => {
    if (current.length < 2) return;
    const next = (cursor + delta + current.length) % current.length;
    const pair = current[next];
    state = { ...state, a: pair.a.f, b: pair.b.f };
    apply(true);
  };

  document.getElementById("prev")!.addEventListener("click", () => move(-1));
  document.getElementById("next")!.addEventListener("click", () => move(1));

  addEventListener("keydown", (ev) => {
    const target = ev.target as HTMLElement | null;
    if (target?.isContentEditable || target instanceof HTMLInputElement) return;
    if (ev.key === "ArrowLeft") { ev.preventDefault(); move(-1); }
    if (ev.key === "ArrowRight") { ev.preventDefault(); move(1); }
  });

  controls.bind({
    onGenerate: () => {
      // Sortear é sortear de verdade: o corte também muda, senão o botão só
      // percorreria a mesma faixa e a barra viraria decoração.
      const step = Math.floor(Math.random() * CONTRAST_STEPS);
      const contrast = stepToContrast(step);
      const next = pickPair(data, contrast, { a: state.a, b: state.b });
      if (!next) return;
      state = { ...state, ...next, contrast };
      apply(true);
    },
    onContrast: (contrast) => {
      // Mudar o contraste muda a faixa: o par atual pode não pertencer a ela,
      // então sorteia um novo. É o slider governando de fato a seleção.
      state = { ...state, contrast };
      const next = pickPair(data, contrast, { a: state.a, b: state.b });
      if (next) state = { ...state, ...next };
      apply(true);
    },
    onCopyLink: () => {
      navigator.clipboard?.writeText(location.href)
        .then(() => controls.flash("copiado"))
        .catch(() => controls.flash("falhou"));
    },
  });

  apply(false);
  loading.classList.add("is-done");
}

void boot();
