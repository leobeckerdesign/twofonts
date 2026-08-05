import "./styles.css";
import { initBackground } from "./background";
import { Field } from "./field";
import { loadFont, pinFontFamilies } from "./fonts";
import { fontByFamily, loadPairs, pairsIn, pickPair, weightRoles } from "./pairs";
import { assignRoles } from "./roles";
import type { AppState, PairsData } from "./types";
import { Controls } from "./ui/controls";
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

  shelf.onPick = (pair) => {
    if (pair.a.f === state.a && pair.b.f === state.b) return;
    state = { ...state, a: pair.a.f, b: pair.b.f };
    apply(true);
  };

  // Carrega só os pesos que os cards realmente pedem para este par.
  field.onFontsNeeded = (families) => {
    const roles = weightRoles(data, state.contrast);
    const a = fontByFamily(data, state.a);
    const b = fontByFamily(data, state.b);
    if (!a || !b) return;

    pinFontFamilies(families);
    const assignment = assignRoles(a, b, 0, roles);
    const wanted = new Set<number>([assignment.titleWeight, assignment.bodyWeight]);
    for (const family of families) {
      for (const weight of wanted) void loadFont(family, weight);
    }
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

    // O gerar sorteia entre centenas de pares e a prateleira mostra poucos:
    // sem isto o par ativo quase nunca estaria visível e o destaque não teria
    // o que destacar. Ele entra na frente quando não veio naturalmente.
    const visible = pairsIn(data, state.contrast);
    if (!visible.some((p) => p.a.f === state.a && p.b.f === state.b)) {
      visible.unshift({ a, b });
    }
    shelf.render(visible, { a: state.a, b: state.b }, roles);
    history.replaceState(null, "", `${location.pathname}?${encodeState(state)}`);
  };

  controls.bind({
    onGenerate: () => {
      const next = pickPair(data, state.contrast, { a: state.a, b: state.b });
      if (!next) return;
      state = { ...state, ...next };
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
