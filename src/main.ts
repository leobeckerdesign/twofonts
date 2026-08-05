import "./styles.css";
import { initBackground } from "./background";
import { Field } from "./field";
import { loadFont, pinFontFamilies } from "./fonts";
import { fontByFamily, loadPairs, pickPair, weightRoles } from "./pairs";
import { assignRoles } from "./roles";
import type { AppState, PairsData } from "./types";
import { Controls } from "./ui/controls";
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

    const pair = { a, b, roles: weightRoles(data, state.contrast), contrast: state.contrast };
    if (animate) field.swap(pair);
    else field.setPair(pair);

    controls.sync(state.a, state.b, state.contrast);
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
