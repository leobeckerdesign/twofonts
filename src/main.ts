import "./styles.css";
import gsap from "gsap";
import { initBackground } from "./background";
import { BootController, type BootSnapshot } from "./boot";
import { Camera } from "./camera";
import { loadFontDB, type FontDB } from "./data";
import { failedFonts, pinFontFamilies } from "./fonts";
import { Arc } from "./map/arc";
import { FontAtlas, loadFontAtlas, preferredFontAtlas } from "./map/atlas";
import { CardLayer } from "./map/cards";
import { FontField } from "./map/field";
import { WORLD } from "./map/lod";
import { PairBuffer } from "./pair-buffer";
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
const fieldCanvas = document.getElementById("font-field") as HTMLCanvasElement;
const arcLayer = document.getElementById("arc-layer") as unknown as SVGSVGElement;
const loading = document.getElementById("loading")!;
const loadingPhase = document.getElementById("loading-phase")!;
const loadingPercent = document.getElementById("loading-percent")!;
const loadingProgress = document.getElementById("loading-progress")!;
const loadingTrack = document.getElementById("loading-track")!;
const loadingRetry = document.getElementById("loading-retry") as HTMLButtonElement;
const notice = document.getElementById("notice")!;
const familyA = document.getElementById("family-a")!;
const familyB = document.getElementById("family-b")!;
const fontCount = document.getElementById("font-count")!;

const BOOT_DETAILS: Readonly<Record<string, string>> = {
  catalog: "lendo embeddings e coordenadas do espaço latente",
  atlas: "decodificando 1.807 previews em uma textura local",
  scene: "montando canvas, câmera e camada interativa",
  pair: "carregando as duas fontes reais do specimen",
  warm: "preparando os próximos pares para troca instantânea",
  ready: "aquecendo o primeiro frame composto",
};

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

function updateLoading(snapshot: BootSnapshot): void {
  const percent = Math.round(snapshot.progress * 100);
  loadingPhase.textContent = snapshot.message;
  loadingPercent.textContent = `${String(percent).padStart(2, "0")}%`;
  loadingProgress.style.transform = `scaleX(${snapshot.progress})`;
  loadingTrack.setAttribute("aria-valuenow", String(percent));
  const detail = document.getElementById("loading-detail");
  if (detail && snapshot.phaseId) detail.textContent = BOOT_DETAILS[snapshot.phaseId] ?? detail.textContent;
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
  const scale = gsap.utils.clamp(0.24, 1.55, Math.min(fitWidth, fitHeight));
  const hudOffset = viewport.clientHeight * 0.16 / scale;
  return { x, y: y + hudOffset, scale };
}

function afterFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const next = (remaining: number): void => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => next(remaining - 1));
    };
    next(count);
  });
}

async function startApp(): Promise<void> {
  let db: FontDB;
  let state: PairState;
  let atlas: FontAtlas;
  let camera: Camera;
  let layer: CardLayer;
  let field: FontField;
  let arc: Arc;
  let specimen: Specimen;
  let controls: Controls;
  let pairBuffer: PairBuffer;
  const atlasAsset = preferredFontAtlas();
  let commitRevision = 0;
  let settleTimer: number | null = null;
  let warmupTimer: number | null = null;
  let pairCommitBusy = false;
  let interactionsReady = false;

  const scheduleScene = (): void => {
    const movingView = camera.view();
    field.request(movingView, false);
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      const settledView = camera.view();
      field.request(settledView, true);
      layer.render(settledView);
    }, 110);
  };

  const scheduleWarmup = (delay = 360): void => {
    if (warmupTimer !== null) clearTimeout(warmupTimer);
    warmupTimer = window.setTimeout(() => {
      void pairBuffer.prime(state).then(
        () => {
          layer.refreshFonts();
          scheduleScene();
        },
        () => showNotice("O próximo par será preparado sob demanda.", "error"),
      );
    }, delay);
  };

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
    pinFontFamilies([state.a, state.b]);
    layer.setActive([state.a, state.b]);
    field.setActive([state.a, state.b]);
    layer.render(camera.view());
    field.request(camera.view(), true);

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
      const usable = availableDB(db);
      if (recoveryAttempt < 1 && usable && (result.a.loaded || result.b.loaded)) {
        state = { ...state, ...generatePair(usable, state) };
        pairBuffer.interrupt(state);
        await commit(true, recoveryAttempt + 1);
        return;
      }
      showNotice("Algumas webfonts não responderam; o mapa segue disponível com previews locais.", "error");
    }

    arc.show(a, b);
    layer.refreshFonts();
    scheduleScene();
  };

  const runInteractiveCommit = (animateCamera: boolean): void => {
    pairCommitBusy = true;
    const generateButton = document.getElementById("generate") as HTMLButtonElement;
    generateButton.disabled = true;
    generateButton.setAttribute("aria-busy", "true");
    void commit(animateCamera)
      .then(
        () => scheduleWarmup(0),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : "Não foi possível trocar o par";
          showNotice(message, "error");
        },
      )
      .finally(() => {
        pairCommitBusy = false;
        generateButton.disabled = false;
        generateButton.removeAttribute("aria-busy");
      });
  };

  const bindInteractions = (): void => {
    controls.bind({
      onGenerate: () => {
        if (!interactionsReady) return;
        if (pairCommitBusy) {
          showNotice("O par atual ainda está sendo aplicado.");
          return;
        }
        if (state.lockA && state.lockB) {
          showNotice("As duas fontes estão travadas. Destrave A ou B para gerar.");
          return;
        }
        const usable = availableDB(db);
        if (!usable) {
          showNotice("Não há duas fontes disponíveis para gerar um par.", "error");
          return;
        }

        const prepared = pairBuffer.take(state);
        if (!prepared && pairBuffer.isLoading) {
          showNotice("O próximo par ainda está sendo preparado.");
          return;
        }
        state = prepared
          ? { ...state, ...prepared }
          : { ...state, ...generatePair(usable, state) };
        pairBuffer.interrupt(state);
        runInteractiveCommit(true);
      },
      onContrast: (contrast) => {
        state = { ...state, contrast };
        pairBuffer.interrupt(state);
        controls.sync(state);
        persistState(state);
        scheduleWarmup();
      },
      onToggleLock: (slot) => {
        state = slot === "a"
          ? { ...state, lockA: !state.lockA }
          : { ...state, lockB: !state.lockB };
        pairBuffer.interrupt(state);
        controls.sync(state);
        persistState(state);
        scheduleWarmup(0);
      },
    });

    specimen.onTextEdit = (text) => {
      state = { ...state, text: text.slice(0, MAX_TEXT_LENGTH) };
      persistState(state);
    };

    layer.onPick = (family) => {
      if (!interactionsReady) return;
      if (pairCommitBusy) {
        showNotice("O par atual ainda está sendo aplicado.");
        return;
      }
      if (state.lockA && state.lockB) {
        showNotice("As duas fontes estão travadas.");
        return;
      }
      const next = state.lockA ? { ...state, b: family } : { ...state, a: family };
      if (next.a === next.b) {
        showNotice("Escolha duas famílias diferentes para formar o par.");
        return;
      }
      state = next;
      pairBuffer.interrupt(state);
      runInteractiveCommit(false);
    };
  };

  const boot = new BootController([
    {
      id: "catalog",
      message: "mapeando 1.807 famílias",
      weight: 22,
      timeoutMs: 15_000,
      run: async ({ signal, report }) => {
        report(0.04);
        db = await loadFontDB("/fonts-map.json", {
          signal,
          onProgress: (progress) => report(0.08 + progress * 0.84),
        });
        state = initialState(db);
        fontCount.textContent = `${db.entries.length.toLocaleString("pt-BR")} famílias`;
        report(1);
      },
    },
    {
      id: "atlas",
      message: "revelando as formas tipográficas",
      weight: 38,
      timeoutMs: 18_000,
      run: async ({ signal, report }) => {
        report(0.06);
        atlas = await loadFontAtlas(atlasAsset, signal);
        document.documentElement.style.setProperty("--font-atlas", `url("${atlasAsset.url}")`);
        report(1);
      },
    },
    {
      id: "scene",
      message: "construindo o mapa fluido",
      weight: 14,
      run: ({ report }) => {
        camera = new Camera(world, viewport);
        layer = new CardLayer(world, db.entries);
        field = new FontField(fieldCanvas, db.entries, atlas);
        arc = new Arc(arcLayer);
        specimen = new Specimen();
        controls = new Controls();
        pairBuffer = new PairBuffer(db, { target: 2 });
        camera.onChange = scheduleScene;
        addEventListener("resize", scheduleScene);
        bindInteractions();
        field.draw(camera.view(), true);
        layer.render(camera.view());
        report(1);
      },
    },
    {
      id: "pair",
      message: "carregando o primeiro par",
      weight: 15,
      timeoutMs: 18_000,
      run: async ({ report }) => {
        report(0.08);
        await commit(true);
        report(1);
      },
    },
    {
      id: "warm",
      message: "aquecendo os próximos pares",
      weight: 8,
      timeoutMs: 22_000,
      run: async ({ signal, report }) => {
        const warmController = new AbortController();
        const abortWarmup = (): void => warmController.abort();
        signal.addEventListener("abort", abortWarmup, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            pairBuffer.prime(
              state,
              ({ progress, ready, target }) => report(
                progress,
                `preparando pares ${ready}/${target}`,
              ),
              warmController.signal,
            ),
            new Promise<void>((resolve) => {
              timer = setTimeout(() => {
                warmController.abort();
                resolve();
              }, 12_000);
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          signal.removeEventListener("abort", abortWarmup);
        }
        layer.refreshFonts();
        report(1);
      },
    },
    {
      id: "ready",
      message: "compondo o primeiro frame",
      weight: 3,
      run: async ({ report }) => {
        field.draw(camera.view(), true);
        layer.render(camera.view());
        initBackground(document.getElementById("bg") as HTMLCanvasElement);
        report(0.55);
        await afterFrames(2);
        report(1);
      },
    },
  ], {
    minimumVisibleMs: 1_600,
    completionMessage: "experiência pronta",
  });

  boot.subscribe(updateLoading);
  await boot.start();
  interactionsReady = true;
  viewport.removeAttribute("inert");
  viewport.setAttribute("aria-busy", "false");
  document.getElementById("hud")?.removeAttribute("inert");
  loading.setAttribute("aria-hidden", "true");
  loading.classList.add("is-done");
}

void startApp().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "erro desconhecido";
  loading.classList.add("is-error");
  loading.setAttribute("role", "alert");
  loadingPhase.textContent = "não foi possível preparar a experiência";
  const detail = document.getElementById("loading-detail");
  if (detail) detail.textContent = message;
  notice.textContent = message;
  notice.dataset.kind = "error";
  notice.classList.add("is-visible");
  loadingRetry.hidden = false;
  loadingRetry.addEventListener("click", () => location.reload(), { once: true });
  console.error("twofonts:", error);
});
