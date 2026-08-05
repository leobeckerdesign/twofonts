import "./styles.css";
import gsap from "gsap";
import { initBackground } from "./background";
import { Camera } from "./camera";
import { loadFontDB, type FontDB } from "./data";
import { failedFonts } from "./fonts";
import { Arc } from "./map/arc";
import { CardLayer } from "./map/cards";
import { WORLD } from "./map/lod";
import { generatePair } from "./pairing";
import type { FontEntry, PairState } from "./types";
import { Controls } from "./ui/controls";
import { Specimen, type SpecimenApplyResult } from "./ui/specimen";
import {
  DEFAULT_STATE,
  MAX_TEXT_LENGTH,
  decodeState,
  encodeState,
} from "./url-state";

const world = document.getElementById("world")!;
const viewport = document.getElementById("viewport")!;
const arcLayer = document.getElementById("arc-layer") as unknown as SVGSVGElement;
const loading = document.getElementById("loading")!;
const notice = document.getElementById("notice")!;
const familyA = document.getElementById("family-a")!;
const familyB = document.getElementById("family-b")!;
const fontCount = document.getElementById("font-count")!;

function persistState(state: PairState): void {
  const query = encodeState(state);
  history.replaceState(null, "", `${location.pathname}?${query}${location.hash}`);
}

function showNotice(message: string, kind: "info" | "error" = "info"): void {
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.classList.add("is-visible");
  window.setTimeout(() => notice.classList.remove("is-visible"), 3_200);
}

function availableDB(db: FontDB): FontDB | null {
  const entries = db.entries.filter((entry) => !failedFonts.has(entry.family));
  if (entries.length < 2) return null;
  return {
    entries,
    byFamily: new Map(entries.map((entry) => [entry.family, entry])),
  };
}

function initialState(db: FontDB): PairState {
  const decoded = decodeState(location.search.slice(1));
  const fallbackA = db.byFamily.has(DEFAULT_STATE.a)
    ? DEFAULT_STATE.a
    : db.entries[0].family;
  const fallbackB = db.byFamily.has(DEFAULT_STATE.b) && DEFAULT_STATE.b !== fallbackA
    ? DEFAULT_STATE.b
    : (db.entries.find((entry) => entry.family !== fallbackA)?.family ?? fallbackA);
  const a = db.byFamily.has(decoded.a) ? decoded.a : fallbackA;
  const b = db.byFamily.has(decoded.b) && decoded.b !== a ? decoded.b : fallbackB;

  return { ...decoded, a, b };
}

function pairingFocus(
  a: FontEntry,
  b: FontEntry,
): { x: number; y: number; scale: number } {
  const x = (a.x + b.x) / 2 * WORLD;
  const y = (a.y + b.y) / 2 * WORLD;
  const width = Math.abs(a.x - b.x) * WORLD;
  const height = Math.abs(a.y - b.y) * WORLD;
  const fitWidth = viewport.clientWidth * 0.78 / Math.max(width + 320, 420);
  const fitHeight = viewport.clientHeight * 0.62 / Math.max(height + 260, 420);
  const scale = gsap.utils.clamp(
    0.24,
    1.55,
    Math.min(fitWidth, fitHeight),
  );
  // Desloca o foco para cima, liberando a área ocupada pelo specimen.
  const hudOffset = viewport.clientHeight * 0.16 / scale;
  return { x, y: y + hudOffset, scale };
}

async function boot(): Promise<void> {
  initBackground(document.getElementById("bg") as HTMLCanvasElement);

  const db = await loadFontDB();
  let state = initialState(db);
  let commitRevision = 0;

  fontCount.textContent = `${db.entries.length.toLocaleString("pt-BR")} famílias`;

  const camera = new Camera(world, viewport);
  const layer = new CardLayer(world, db.entries);
  const arc = new Arc(arcLayer);
  const specimen = new Specimen();
  const controls = new Controls();

  const render = (): void => layer.render(camera.view());
  camera.onChange = render;
  addEventListener("resize", render);

  const commit = async (
    animateCamera: boolean,
    recoveryAttempt = 0,
  ): Promise<void> => {
    const revision = ++commitRevision;
    const a = db.byFamily.get(state.a);
    const b = db.byFamily.get(state.b);
    if (!a || !b || a.family === b.family) {
      throw new Error("O estado do pairing não referencia duas fontes válidas");
    }

    persistState(state);
    controls.sync(state);
    familyA.textContent = state.a;
    familyB.textContent = state.b;
    layer.setActive([state.a, state.b]);
    render();

    if (animateCamera) {
      const focus = pairingFocus(a, b);
      camera.flyTo(focus.x, focus.y, focus.scale);
    }

    const result = await specimen.apply(state, {
      aWeights: a.weights,
      bWeights: b.weights,
      report: true,
    }) as SpecimenApplyResult;

    if (revision !== commitRevision || result.superseded) return;

    if (!result.a.loaded || !result.b.loaded) {
      if (recoveryAttempt >= 7) {
        showNotice("A rede bloqueou várias webfonts. Tente novamente em instantes.", "error");
        loading.textContent = "não foi possível carregar as fontes";
        loading.classList.add("is-error");
        return;
      }

      const usable = availableDB(db);
      if (!usable) throw new Error("Não restaram duas webfonts disponíveis");
      state = { ...state, ...generatePair(usable, state) };
      await commit(true, recoveryAttempt + 1);
      return;
    }

    arc.show(a, b);
    layer.setActive([state.a, state.b]);
    render();
    loading.classList.add("is-done");
  };

  controls.bind({
    onGenerate: () => {
      if (state.lockA && state.lockB) {
        showNotice("As duas fontes estão travadas. Destrave A ou B para gerar.");
        return;
      }
      const usable = availableDB(db);
      if (!usable) {
        showNotice("Não há duas fontes disponíveis para gerar um par.", "error");
        return;
      }
      state = { ...state, ...generatePair(usable, state) };
      void commit(true);
    },
    onContrast: (contrast) => {
      state = { ...state, contrast };
      controls.sync(state);
      persistState(state);
    },
    onToggleLock: (slot) => {
      state = slot === "a"
        ? { ...state, lockA: !state.lockA }
        : { ...state, lockB: !state.lockB };
      controls.sync(state);
      persistState(state);
    },
  });

  specimen.onTextEdit = (text) => {
    state = { ...state, text: text.slice(0, MAX_TEXT_LENGTH) };
    persistState(state);
  };

  layer.onPick = (family) => {
    if (state.lockA && state.lockB) {
      showNotice("As duas fontes estão travadas.");
      return;
    }

    const next = state.lockA
      ? { ...state, b: family }
      : { ...state, a: family };
    if (next.a === next.b) {
      showNotice("Escolha duas famílias diferentes para formar o par.");
      return;
    }
    state = next;
    void commit(false);
  };

  render();
  await commit(true);
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  loading.textContent = "não foi possível abrir o mapa";
  loading.classList.add("is-error");
  notice.textContent = message;
  notice.dataset.kind = "error";
  notice.classList.add("is-visible");
  console.error("twofonts:", error);
});
