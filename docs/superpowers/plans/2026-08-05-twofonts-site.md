# twofonts — Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o site twofonts — mapa latente navegável de 1.807 fontes do Google Fonts com pairing por métrica fontjoy e coreografias GSAP.

**Architecture:** Site estático em três camadas: fundo shader WebGL (fallback CSS), mundo pan/zoom em DOM com cards virtualizados por LOD, e HUD fixo com specimen + controles. Toda a lógica de pairing roda no client sobre `public/fonts-map.json` (já gerado).

**Tech Stack:** Vite, TypeScript vanilla, GSAP (Draggable, InertiaPlugin, Flip), Vitest. Sem framework de UI.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-05-twofonts-design.md` — em conflito, a spec vence
- Texto tipográfico SEMPRE em DOM; WebGL só no fundo
- Fail closed: fonte que falha ao carregar sai do mapa e do gerador
- `prefers-reduced-motion` desliga drift, coreografias e loop do shader
- Webfonts de cards com subset `text=`; fontes do specimen carregam charset completo (são editáveis)
- Estado completo compartilhável via querystring (`?a=&b=&c=&la=&lb=&t=`)
- Desktop-first; dark; sem contas/persistência (v1 = experimento puro)
- Commits frequentes, mensagens `feat:/test:/style:` em pt-BR

## Estrutura de arquivos

```
index.html
src/
  main.ts          — bootstrap e fiação entre módulos
  types.ts         — FontEntry, PairState
  data.ts          — fetch + indexação do fonts-map.json
  pairing.ts       — métrica fontjoy + generatePair (puro, testado)
  url-state.ts     — encode/decode do estado (puro, testado)
  fonts.ts         — loader Google Fonts, registro fail-closed
  background.ts    — shader de fundo + fallback
  camera.ts        — pan/zoom/flyTo do mundo
  map/lod.ts       — LOD + virtualização (puro, testado)
  map/cards.ts     — pool de cards DOM, drift, decoração por LOD
  map/arc.ts       — arco SVG entre o par ativo
  ui/specimen.ts   — specimen editável com transição Flip
  ui/controls.ts   — slider de contraste, locks, gerar
  styles.css
tests/             — pairing, url-state, lod, data, fonts(url)
```

---

### Task 1: Scaffold + módulo de dados

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/styles.css`, `src/types.ts`, `src/data.ts`, `src/main.ts`
- Test: `tests/data.test.ts`

**Interfaces:**
- Produces: `FontEntry {family, category, weights: number[], v: number[], x, y}`, `PairState {a, b, lockA, lockB, contrast, text}`, `indexFonts(entries): FontDB {entries, byFamily: Map}`, `loadFontDB(url?): Promise<FontDB>`

- [ ] **Step 1: Instalar dependências**

```bash
cd C:\AI_Workspace\twofonts
npm init -y
npm i gsap
npm i -D vite typescript vitest
```

Em `package.json`, definir `"scripts": {"dev": "vite", "build": "vite build", "test": "vitest run"}` e `"type": "module"`.

- [ ] **Step 2: Criar tsconfig.json e vite.config.ts**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "skipLibCheck": true, "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

```ts
import { defineConfig } from "vite";
export default defineConfig({});
```

- [ ] **Step 3: Criar src/types.ts**

```ts
export interface FontEntry {
  family: string;
  category: string;
  weights: number[];
  v: number[];
  x: number;
  y: number;
}

export interface PairState {
  a: string;
  b: string;
  lockA: boolean;
  lockB: boolean;
  contrast: number; // 0..1
  text: string;     // headline do specimen
}
```

- [ ] **Step 4: Escrever teste que falha (tests/data.test.ts)**

```ts
import { describe, expect, it } from "vitest";
import { indexFonts } from "../src/data";

const fixture = [
  { family: "Lora", category: "Serif", weights: [400, 700], v: [0.1, -0.2], x: 0.5, y: 0.5 },
  { family: "Inter", category: "Sans Serif", weights: [400], v: [0.3, 0.1], x: 0.2, y: 0.8 },
];

describe("indexFonts", () => {
  it("indexa por família e preserva a lista", () => {
    const db = indexFonts(fixture);
    expect(db.entries).toHaveLength(2);
    expect(db.byFamily.get("Lora")?.category).toBe("Serif");
    expect(db.byFamily.get("Nope")).toBeUndefined();
  });
});
```

Run: `npx vitest run tests/data.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 5: Implementar src/data.ts**

```ts
import type { FontEntry } from "./types";

export interface FontDB {
  entries: FontEntry[];
  byFamily: Map<string, FontEntry>;
}

export function indexFonts(entries: FontEntry[]): FontDB {
  return { entries, byFamily: new Map(entries.map((e) => [e.family, e])) };
}

export async function loadFontDB(url = "/fonts-map.json"): Promise<FontDB> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fonts-map.json: HTTP ${res.status}`);
  return indexFonts(await res.json());
}
```

Run: `npx vitest run tests/data.test.ts` — Expected: PASS.

- [ ] **Step 6: index.html + styles.css base + main.ts stub**

index.html (corpo; Vite injeta o script):

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>twofonts</title>
</head>
<body>
  <canvas id="bg"></canvas>
  <div id="viewport">
    <div id="world">
      <svg id="arc-layer" width="4000" height="4000"></svg>
    </div>
  </div>
  <aside id="hud">
    <div id="specimen">
      <h1 id="spec-headline" contenteditable="true" spellcheck="false">Beleza é função</h1>
      <p id="spec-body" contenteditable="true" spellcheck="false">O pareamento de fontes é o equilíbrio entre semelhança e contraste — formas que conversam sem competir.</p>
    </div>
    <div id="controls">
      <button id="lock-a" aria-pressed="false" title="Travar headline">A</button>
      <input id="contrast" type="range" min="0" max="1" step="0.01" value="0.5" />
      <button id="lock-b" aria-pressed="false" title="Travar corpo">B</button>
      <button id="generate">gerar</button>
    </div>
  </aside>
</body>
</html>
```

styles.css (fundação; refino estético na Task 9):

```css
:root {
  --bg: #0d0d0f; --ink: #ececec; --muted: #8a8a90; --accent: #f05524;
  --card-bg: rgba(255, 255, 255, 0.04); --card-border: rgba(255, 255, 255, 0.10);
}
* { margin: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--ink);
  font-family: system-ui, sans-serif; }
#bg { position: fixed; inset: 0; z-index: 0; }
#viewport { position: fixed; inset: 0; z-index: 1; overflow: hidden; cursor: grab; }
#viewport:active { cursor: grabbing; }
#world { position: absolute; width: 4000px; height: 4000px; transform-origin: 0 0; }
#arc-layer { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
#hud { position: fixed; inset: auto 0 0 0; z-index: 2; display: flex; flex-direction: column;
  align-items: center; gap: 16px; padding: 24px; pointer-events: none; }
#hud > * { pointer-events: auto; }
```

main.ts stub:

```ts
import "./styles.css";
import { loadFontDB } from "./data";

loadFontDB().then((db) => console.log(`twofonts: ${db.entries.length} famílias`));
```

- [ ] **Step 7: Verificar dev server**

Run: `npx vite build` — Expected: build ok. Preview no browser: console mostra `twofonts: 1807 famílias`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold vite + módulo de dados"
```

---

### Task 2: Métrica de pairing (fontjoy) + gerador

**Files:**
- Create: `src/pairing.ts`
- Test: `tests/pairing.test.ts`

**Interfaces:**
- Consumes: `FontEntry`, `PairState`, `FontDB` (Task 1)
- Produces: `splitCosine(a: number[], b: number[]): {pos: number, neg: number}`, `pairScore(headline: FontEntry, body: FontEntry, contrast: number): number`, `generatePair(db: FontDB, state: PairState, rng?: () => number): {a: string, b: string}`

- [ ] **Step 1: Escrever testes que falham**

```ts
import { describe, expect, it } from "vitest";
import { generatePair, pairScore, splitCosine } from "../src/pairing";
import { indexFonts } from "../src/data";
import type { FontEntry, PairState } from "../src/types";

const F = (family: string, v: number[], category = "Sans Serif", weights = [400]): FontEntry =>
  ({ family, category, weights, v, x: 0, y: 0 });

const state = (over: Partial<PairState> = {}): PairState =>
  ({ a: "Base", b: "Igual", lockA: false, lockB: false, contrast: 0.5, text: "x", ...over });

describe("splitCosine", () => {
  it("separa componentes positivos e negativos do cosseno", () => {
    // a·b = 1*1 + 1*(-1) = pos 1, neg -1; normas = 2 → 0.5 / 0.5
    expect(splitCosine([1, 1], [1, -1])).toEqual({ pos: 0.5, neg: 0.5 });
  });
  it("idênticos: tudo positivo, nada negativo", () => {
    expect(splitCosine([1, 1], [1, 1])).toEqual({ pos: 1, neg: 0 });
  });
});

describe("pairScore", () => {
  const base = F("Base", [1, 1]);
  it("contrast=0 premia semelhança; contrast=1 premia oposição", () => {
    const igual = F("Igual", [1, 1]);
    const oposto = F("Oposto", [-1, -1]);
    expect(pairScore(base, igual, 0)).toBeGreaterThan(pairScore(base, oposto, 0));
    expect(pairScore(base, oposto, 1)).toBeGreaterThan(pairScore(base, igual, 1));
  });
  it("penaliza corpo pouco legível (Display) e sem peso 400", () => {
    const legivel = F("Legivel", [1, 0]);
    const display = F("Display", [1, 0], "Display");
    const sem400 = F("Sem400", [1, 0], "Sans Serif", [700]);
    expect(pairScore(base, legivel, 0.5)).toBeGreaterThan(pairScore(base, display, 0.5));
    expect(pairScore(base, legivel, 0.5)).toBeGreaterThan(pairScore(base, sem400, 0.5));
  });
});

describe("generatePair", () => {
  const db = indexFonts([
    F("Base", [1, 1]), F("Igual", [1, 1.1]), F("Oposto", [-1, -1]),
    F("Meio", [1, -1]), F("Outro", [0.9, 1]),
  ]);
  it("com ambos locks, devolve o par atual", () => {
    const s = state({ lockA: true, lockB: true });
    expect(generatePair(db, s)).toEqual({ a: "Base", b: "Igual" });
  });
  it("com lockA, mantém A e troca B (nunca devolve o B atual nem o próprio A)", () => {
    const s = state({ lockA: true });
    const out = generatePair(db, s, () => 0);
    expect(out.a).toBe("Base");
    expect(out.b).not.toBe("Igual");
    expect(out.b).not.toBe("Base");
  });
  it("é determinístico com rng injetado", () => {
    const s = state();
    expect(generatePair(db, s, () => 0)).toEqual(generatePair(db, s, () => 0));
  });
});
```

Run: `npx vitest run tests/pairing.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implementar src/pairing.ts**

```ts
import type { FontDB } from "./data";
import type { FontEntry, PairState } from "./types";

const BODY_FRIENDLY = new Set(["Sans Serif", "Serif"]);
const TOP_K = 20;

export function splitCosine(a: number[], b: number[]): { pos: number; neg: number } {
  let pos = 0, neg = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] * b[i];
    if (p >= 0) pos += p; else neg += p;
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  // sqrt(na*nb) e não sqrt(na)*sqrt(nb): o segundo produz 2.0000000000000004
  // para na=nb=2 e quebra igualdade exata nos testes
  const norm = Math.sqrt(na * nb) || 1;
  return { pos: pos / norm, neg: -neg / norm + 0 }; // +0 normaliza -0
}

/** Score do par: contraste modula entre semelhança (pos) e oposição (neg);
 *  o slot body leva penalidade de legibilidade — é a releitura direta da
 *  métrica do fontjoy (cosseno decomposto em metades). */
export function pairScore(headline: FontEntry, body: FontEntry, contrast: number): number {
  const { pos, neg } = splitCosine(headline.v, body.v);
  let score = (1 - contrast) * pos + contrast * neg;
  if (!BODY_FRIENDLY.has(body.category)) score -= 0.15;
  if (!body.weights.includes(400)) score -= 0.05;
  return score;
}

function pickTop(
  ranked: FontEntry[], exclude: Set<string>, rng: () => number,
): FontEntry {
  const pool = ranked.filter((e) => !exclude.has(e.family)).slice(0, TOP_K);
  return pool[Math.floor(rng() * pool.length)];
}

export function generatePair(
  db: FontDB, state: PairState, rng: () => number = Math.random,
): { a: string; b: string } {
  const { a, b, lockA, lockB, contrast } = state;
  if (lockA && lockB) return { a, b };

  const chooseB = (fixedA: FontEntry, excludeB: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(fixedA, q, contrast) - pairScore(fixedA, p, contrast));
    return pickTop(ranked, new Set([fixedA.family, excludeB]), rng).family;
  };
  const chooseA = (fixedB: FontEntry, excludeA: string): string => {
    const ranked = [...db.entries]
      .sort((p, q) => pairScore(q, fixedB, contrast) - pairScore(p, fixedB, contrast));
    return pickTop(ranked, new Set([fixedB.family, excludeA]), rng).family;
  };

  if (lockA) return { a, b: chooseB(db.byFamily.get(a)!, b) };
  if (lockB) return { a: chooseA(db.byFamily.get(b)!, a), b };

  // nada travado: sorteia a headline, escolhe o melhor corpo para ela
  const newA = db.entries[Math.floor(rng() * db.entries.length)].family;
  return { a: newA, b: chooseB(db.byFamily.get(newA)!, b) };
}
```

- [ ] **Step 3: Rodar testes**

Run: `npx vitest run tests/pairing.test.ts` — Expected: PASS (todos).

- [ ] **Step 4: Commit**

```bash
git add src/pairing.ts tests/pairing.test.ts && git commit -m "feat: métrica de pairing fontjoy + gerador com locks"
```

---

### Task 3: Estado na URL

**Files:**
- Create: `src/url-state.ts`
- Test: `tests/url-state.test.ts`

**Interfaces:**
- Consumes: `PairState` (Task 1)
- Produces: `DEFAULT_STATE: PairState`, `encodeState(s: PairState): string`, `decodeState(qs: string): PairState`

- [ ] **Step 1: Escrever testes que falham**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, decodeState, encodeState } from "../src/url-state";

describe("url-state", () => {
  it("faz roundtrip completo", () => {
    const s = { a: "Lora", b: "Inter", lockA: true, lockB: false, contrast: 0.7, text: "Olá" };
    expect(decodeState(encodeState(s))).toEqual(s);
  });
  it("querystring vazia devolve o default", () => {
    expect(decodeState("")).toEqual(DEFAULT_STATE);
  });
  it("clampa contraste inválido e ignora params desconhecidos", () => {
    const s = decodeState("c=7&zzz=1");
    expect(s.contrast).toBe(1);
    expect(decodeState("c=abc").contrast).toBe(DEFAULT_STATE.contrast);
  });
});
```

Run: `npx vitest run tests/url-state.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implementar src/url-state.ts**

```ts
import type { PairState } from "./types";

export const DEFAULT_STATE: PairState = {
  a: "Playfair Display", b: "Inter", lockA: false, lockB: false,
  contrast: 0.5, text: "Beleza é função",
};

export function encodeState(s: PairState): string {
  const p = new URLSearchParams();
  p.set("a", s.a);
  p.set("b", s.b);
  p.set("c", String(s.contrast));
  if (s.lockA) p.set("la", "1");
  if (s.lockB) p.set("lb", "1");
  if (s.text !== DEFAULT_STATE.text) p.set("t", s.text);
  return p.toString();
}

export function decodeState(qs: string): PairState {
  const p = new URLSearchParams(qs);
  const c = Number(p.get("c"));
  return {
    a: p.get("a") ?? DEFAULT_STATE.a,
    b: p.get("b") ?? DEFAULT_STATE.b,
    lockA: p.get("la") === "1",
    lockB: p.get("lb") === "1",
    contrast: Number.isFinite(c) && p.get("c") !== null
      ? Math.min(1, Math.max(0, c)) : DEFAULT_STATE.contrast,
    text: p.get("t") ?? DEFAULT_STATE.text,
  };
}
```

Run: `npx vitest run tests/url-state.test.ts` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/url-state.ts tests/url-state.test.ts && git commit -m "feat: estado do pairing serializado na URL"
```

---

### Task 4: LOD + virtualização (lógica pura)

**Files:**
- Create: `src/map/lod.ts`
- Test: `tests/lod.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro)
- Produces: `WORLD = 4000`, `type LOD = "dot" | "name" | "card"`, `interface View {x, y, scale, w, h}`, `lodForScale(scale): LOD`, `screenPos(e: {x,y}, view): {sx, sy}`, `visibleEntries<T extends {x,y}>(entries: T[], view: View, pad?): T[]`

Convenção de coordenadas: card na tela em `sx = e.x * WORLD * scale + view.x` (idem `sy`). `view.x/y` é a translação do `#world` em px de tela.

- [ ] **Step 1: Escrever testes que falham**

```ts
import { describe, expect, it } from "vitest";
import { WORLD, lodForScale, screenPos, visibleEntries } from "../src/map/lod";

const view = { x: 0, y: 0, scale: 1, w: 1000, h: 800 };

describe("lodForScale", () => {
  it("mapeia zoom para níveis de detalhe", () => {
    expect(lodForScale(0.2)).toBe("dot");
    expect(lodForScale(1.0)).toBe("name");
    expect(lodForScale(2.0)).toBe("card");
  });
});

describe("screenPos / visibleEntries", () => {
  it("projeta mundo→tela", () => {
    expect(screenPos({ x: 0.5, y: 0.5 }, view)).toEqual({ sx: WORLD / 2, sy: WORLD / 2 });
    expect(screenPos({ x: 0, y: 0 }, { ...view, x: 100, y: 50 })).toEqual({ sx: 100, sy: 50 });
  });
  it("filtra só o que está no viewport (com margem)", () => {
    const inside = { x: 0.1, y: 0.1 };   // 400,400 → visível em 1000x800
    const outside = { x: 0.9, y: 0.9 };  // 3600,3600 → fora
    const near = { x: 0.26, y: 0.1 };    // 1040,400 → fora mas dentro do pad 200
    expect(visibleEntries([inside, outside, near], view, 200)).toEqual([inside, near]);
  });
});
```

Run: `npx vitest run tests/lod.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implementar src/map/lod.ts**

```ts
export const WORLD = 4000;

export type LOD = "dot" | "name" | "card";

export interface View { x: number; y: number; scale: number; w: number; h: number }

export function lodForScale(scale: number): LOD {
  if (scale < 0.55) return "dot";
  if (scale < 1.4) return "name";
  return "card";
}

export function screenPos(e: { x: number; y: number }, view: View): { sx: number; sy: number } {
  return { sx: e.x * WORLD * view.scale + view.x, sy: e.y * WORLD * view.scale + view.y };
}

export function visibleEntries<T extends { x: number; y: number }>(
  entries: T[], view: View, pad = 200,
): T[] {
  return entries.filter((e) => {
    const { sx, sy } = screenPos(e, view);
    return sx > -pad && sx < view.w + pad && sy > -pad && sy < view.h + pad;
  });
}
```

Run: `npx vitest run tests/lod.test.ts` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/map/lod.ts tests/lod.test.ts && git commit -m "feat: LOD e virtualização do mapa"
```

---

### Task 5: Loader de webfonts (fail closed)

**Files:**
- Create: `src/fonts.ts`
- Test: `tests/fonts.test.ts` (só a parte pura; o runtime é verificado no browser na Task 7)

**Interfaces:**
- Consumes: nada
- Produces: `fontCssUrl(family: string, weight?: number, text?: string): string`, `loadFont(family: string, weight?: number, text?: string): Promise<boolean>`, `failedFonts: Set<string>`

- [ ] **Step 1: Teste da parte pura (falhando)**

```ts
import { describe, expect, it } from "vitest";
import { fontCssUrl } from "../src/fonts";

describe("fontCssUrl", () => {
  it("monta a URL css2 com peso e display=swap", () => {
    expect(fontCssUrl("Playfair Display", 700)).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap",
    );
  });
  it("anexa subset text= urlencoded quando fornecido", () => {
    expect(fontCssUrl("Lora", 400, "Aa é")).toContain("&text=Aa%20%C3%A9");
  });
});
```

Run: `npx vitest run tests/fonts.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implementar src/fonts.ts**

```ts
export const failedFonts = new Set<string>();
const requested = new Map<string, Promise<boolean>>();

export function fontCssUrl(family: string, weight = 400, text?: string): string {
  const fam = family.replace(/ /g, "+");
  let url = `https://fonts.googleapis.com/css2?family=${fam}:wght@${weight}&display=swap`;
  if (text) url += `&text=${encodeURIComponent(text)}`;
  return url;
}

/** Injeta o stylesheet e resolve true quando a fonte está utilizável.
 *  Fail closed: qualquer falha marca a família em failedFonts. */
export function loadFont(family: string, weight = 400, text?: string): Promise<boolean> {
  const key = `${family}|${weight}|${text ?? ""}`;
  const hit = requested.get(key);
  if (hit) return hit;

  const job = new Promise<boolean>((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontCssUrl(family, weight, text);
    const fail = () => { failedFonts.add(family); resolve(false); };
    link.onerror = fail;
    link.onload = async () => {
      try {
        await document.fonts.load(`${weight} 16px "${family}"`, text ?? "aegnRQ");
        document.fonts.check(`${weight} 16px "${family}"`, text ?? "aegnRQ")
          ? resolve(true) : fail();
      } catch { fail(); }
    };
    document.head.appendChild(link);
    setTimeout(fail, 8000); // timeout: rede lenta não pode travar o mapa
  });
  requested.set(key, job);
  return job;
}
```

Run: `npx vitest run tests/fonts.test.ts` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/fonts.ts tests/fonts.test.ts && git commit -m "feat: loader de webfonts com subset e fail closed"
```

---

### Task 6: Câmera pan/zoom/flyTo

**Files:**
- Create: `src/camera.ts`
- Modify: `src/main.ts` (instanciar câmera)

**Interfaces:**
- Consumes: `WORLD`, `View` (Task 4)
- Produces: `class Camera { x; y; scale; onChange: (() => void) | null; view(): View; flyTo(cx, cy, scale, dur?): gsap.core.Tween }` — `cx/cy` em px do mundo, centraliza no viewport

- [ ] **Step 1: Implementar src/camera.ts**

```ts
import gsap from "gsap";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { WORLD, type View } from "./map/lod";

gsap.registerPlugin(Draggable, InertiaPlugin);

export class Camera {
  x = 0; y = 0; scale = 0.4;
  readonly minScale = 0.15;
  readonly maxScale = 3;
  onChange: (() => void) | null = null;
  private drag: Draggable;

  constructor(private world: HTMLElement, private viewport: HTMLElement) {
    this.x = (viewport.clientWidth - WORLD * this.scale) / 2;
    this.y = (viewport.clientHeight - WORLD * this.scale) / 2;
    this.apply();

    const cam = this;
    this.drag = Draggable.create(world, {
      inertia: true,
      onDrag() { cam.x = this.x; cam.y = this.y; cam.onChange?.(); },
      onThrowUpdate() { cam.x = this.x; cam.y = this.y; cam.onChange?.(); },
    })[0];

    viewport.addEventListener("wheel", (ev) => this.wheel(ev), { passive: false });
  }

  view(): View {
    return { x: this.x, y: this.y, scale: this.scale,
             w: this.viewport.clientWidth, h: this.viewport.clientHeight };
  }

  private apply() {
    gsap.set(this.world, { x: this.x, y: this.y, scale: this.scale });
    this.onChange?.();
  }

  private wheel(ev: WheelEvent) {
    ev.preventDefault();
    const next = gsap.utils.clamp(this.minScale, this.maxScale,
      this.scale * Math.exp(-ev.deltaY * 0.0012));
    const k = next / this.scale;
    // zoom focal: o ponto sob o cursor permanece sob o cursor
    this.x = ev.clientX - (ev.clientX - this.x) * k;
    this.y = ev.clientY - (ev.clientY - this.y) * k;
    this.scale = next;
    this.apply();
    this.drag.update();
  }

  flyTo(cx: number, cy: number, scale: number, dur = 1.2): gsap.core.Tween {
    const v = this.view();
    return gsap.to(this, {
      x: v.w / 2 - cx * scale, y: v.h / 2 - cy * scale, scale,
      duration: dur, ease: "power3.inOut", overwrite: "auto",
      onUpdate: () => { this.apply(); this.drag.update(); },
    });
  }
}
```

- [ ] **Step 2: Fiar no main.ts**

```ts
import "./styles.css";
import { loadFontDB } from "./data";
import { Camera } from "./camera";

const world = document.getElementById("world")!;
const viewport = document.getElementById("viewport")!;

async function boot() {
  const db = await loadFontDB();
  const camera = new Camera(world, viewport);
  camera.onChange = () => {/* Task 7 liga o render aqui */};
  console.log(`twofonts: ${db.entries.length} famílias`);
}
boot();
```

- [ ] **Step 3: Adicionar pinch-zoom (touch)**

Ainda em `src/camera.ts`, dentro do `constructor` após o listener de `wheel`:

```ts
    viewport.addEventListener("touchstart", (ev) => this.pinchStart(ev), { passive: false });
    viewport.addEventListener("touchmove", (ev) => this.pinchMove(ev), { passive: false });
    viewport.addEventListener("touchend", () => { this.pinchDist = 0; });
```

E como membros da classe:

```ts
  private pinchDist = 0;

  private static distance(t: TouchList): number {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  private static center(t: TouchList): { x: number; y: number } {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
  }

  private pinchStart(ev: TouchEvent) {
    if (ev.touches.length === 2) this.pinchDist = Camera.distance(ev.touches);
  }

  private pinchMove(ev: TouchEvent) {
    if (ev.touches.length !== 2 || !this.pinchDist) return;
    ev.preventDefault();
    const dist = Camera.distance(ev.touches);
    const next = gsap.utils.clamp(this.minScale, this.maxScale,
      this.scale * (dist / this.pinchDist));
    const k = next / this.scale;
    const c = Camera.center(ev.touches);
    this.x = c.x - (c.x - this.x) * k;
    this.y = c.y - (c.y - this.y) * k;
    this.scale = next;
    this.pinchDist = dist;
    this.apply();
    this.drag.update();
  }
```

- [ ] **Step 4: Verificar no browser**

`npx vite` + preview: arrastar o mundo tem inércia ao soltar; wheel dá zoom ancorado no cursor; nada "pula" ao alternar drag↔zoom (se pular, conferir que `drag.update()` roda após cada mutação manual de x/y). GSAP usa transform matrix própria — nunca setar `style.transform` manualmente no `#world`. Testar pinch no device toolbar do DevTools (modo touch).

- [ ] **Step 5: Commit**

```bash
git add src/camera.ts src/main.ts && git commit -m "feat: câmera pan/zoom com inércia e flyTo"
```

---

### Task 7: Cards do mapa (pool, LOD, drift)

**Files:**
- Create: `src/map/cards.ts`
- Modify: `src/main.ts` (ligar render à câmera)

**Interfaces:**
- Consumes: `FontEntry` (T1), `WORLD`/`View`/`LOD`/`lodForScale`/`visibleEntries` (T4), `loadFont`/`failedFonts` (T5), `Camera` (T6)
- Produces: `class CardLayer { constructor(world: HTMLElement, entries: FontEntry[]); render(view: View): void; onPick: ((family: string) => void) | null; nodeFor(family: string): HTMLElement | undefined }`

Regra de pool: no máximo ~180 nós DOM vivos; nós saindo do viewport voltam ao pool e são reaproveitados. Drift some no LOD `dot` (custo desnecessário em milhares de pontos).

- [ ] **Step 1: Implementar src/map/cards.ts**

```ts
import gsap from "gsap";
import type { FontEntry } from "../types";
import { WORLD, lodForScale, visibleEntries, type LOD, type View } from "./lod";
import { failedFonts, loadFont } from "../fonts";

const SUBSET = "AaGgQqRe 0123456789";
const MAX_NODES = 180;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Live { el: HTMLElement; entry: FontEntry; lod: LOD | null; drift?: gsap.core.Tween }

export class CardLayer {
  onPick: ((family: string) => void) | null = null;
  private live = new Map<string, Live>();
  private pool: HTMLElement[] = [];

  constructor(private world: HTMLElement, private entries: FontEntry[]) {}

  nodeFor(family: string): HTMLElement | undefined {
    return this.live.get(family)?.el;
  }

  render(view: View): void {
    const lod = lodForScale(view.scale);
    const wanted = visibleEntries(
      this.entries.filter((e) => !failedFonts.has(e.family)), view,
    ).slice(0, MAX_NODES);
    const keep = new Set(wanted.map((e) => e.family));

    for (const [family, item] of this.live) {
      if (!keep.has(family)) { this.release(family, item); }
    }
    for (const entry of wanted) {
      const item = this.live.get(entry.family) ?? this.acquire(entry);
      if (item.lod !== lod) this.decorate(item, lod);
    }
  }

  private acquire(entry: FontEntry): Live {
    const el = this.pool.pop() ?? this.createNode();
    el.dataset.family = entry.family;
    // posição no mundo: o #world já carrega a escala, então usamos px de mundo
    gsap.set(el, { x: entry.x * WORLD, y: entry.y * WORLD, opacity: 0 });
    gsap.to(el, { opacity: 1, duration: 0.4, ease: "power2.out" });
    const item: Live = { el, entry, lod: null };
    if (!reduced) {
      // drift dessincronizado: cada card respira num ritmo próprio
      const seed = entry.x + entry.y;
      item.drift = gsap.to(el, {
        y: `+=${8 + seed * 6}`, duration: 5 + seed * 4,
        repeat: -1, yoyo: true, ease: "sine.inOut", delay: seed * 3,
      });
    }
    this.live.set(entry.family, item);
    return item;
  }

  private release(family: string, item: Live) {
    item.drift?.kill();
    gsap.killTweensOf(item.el);
    item.el.remove();
    item.el.className = "card";
    this.live.delete(family);
    if (this.pool.length < MAX_NODES) this.pool.push(item.el);
  }

  private createNode(): HTMLElement {
    const el = document.createElement("div");
    el.className = "card";
    el.addEventListener("click", () => {
      const fam = el.dataset.family;
      if (fam) this.onPick?.(fam);
    });
    return el;
  }

  private decorate(item: Live, lod: LOD) {
    const { el, entry } = item;
    item.lod = lod;
    el.className = `card card--${lod}`;
    if (!el.isConnected) this.world.appendChild(el);

    if (lod === "dot") { el.textContent = ""; return; }

    el.textContent = entry.family;
    el.style.fontFamily = "";
    loadFont(entry.family, 400, lod === "card" ? undefined : SUBSET).then((ok) => {
      if (!ok) { this.release(entry.family, item); return; }
      if (el.dataset.family !== entry.family) return; // nó já reciclado
      el.style.fontFamily = `"${entry.family}", serif`;
      gsap.fromTo(el, { opacity: 0.35 }, { opacity: 1, duration: 0.5, ease: "power2.out" });
    });

    if (lod === "card") {
      el.innerHTML = `<span class="card__name">${entry.family}</span>
        <span class="card__sample">Aa Gg Qq</span>
        <span class="card__meta">${entry.category}</span>`;
    }
  }
}
```

- [ ] **Step 2: Estilos dos cards (append em styles.css)**

```css
.card { position: absolute; top: 0; left: 0; will-change: transform; user-select: none;
  cursor: pointer; color: var(--ink); transition: color .2s ease; }
.card:hover { color: var(--accent); }
.card--dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.card--name { font-size: 22px; white-space: nowrap; }
.card--card { display: flex; flex-direction: column; gap: 6px; width: 260px; padding: 20px;
  background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(6px); }
.card__name { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
  font-family: system-ui, sans-serif; }
.card__sample { font-size: 40px; line-height: 1.1; }
.card__meta { font-size: 11px; color: var(--muted); font-family: system-ui, sans-serif; }
.card--active { color: var(--accent); }
```

- [ ] **Step 3: Ligar no main.ts**

```ts
const layer = new CardLayer(world, db.entries);
camera.onChange = () => layer.render(camera.view());
layer.render(camera.view());
addEventListener("resize", () => layer.render(camera.view()));
```

- [ ] **Step 4: Verificar no browser**

`npx vite`: zoom afastado mostra nuvem de pontos; zoom médio mostra nomes renderizados na própria fonte; zoom perto mostra cards. Panning por regiões distintas mostra agrupamento visual coerente (serifadas juntas, manuscritas juntas). Performance: DevTools → Performance, panning contínuo deve manter ~60fps; contagem de `.card` no DOM nunca passa de ~180 (`document.querySelectorAll('.card').length`).

- [ ] **Step 5: Commit**

```bash
git add src/map/cards.ts src/styles.css src/main.ts && git commit -m "feat: camada de cards com LOD, pool e drift"
```

---

### Task 8: Specimen, controles, arco e coreografia de geração

**Files:**
- Create: `src/ui/specimen.ts`, `src/ui/controls.ts`, `src/map/arc.ts`
- Modify: `src/main.ts` (orquestração completa), `src/styles.css`

**Interfaces:**
- Consumes: `PairState` (T1), `generatePair` (T2), `encodeState`/`decodeState`/`DEFAULT_STATE` (T3), `WORLD` (T4), `loadFont` (T5), `Camera` (T6), `CardLayer` (T7)
- Produces: `class Specimen { apply(state: PairState): Promise<void>; onTextEdit: ((text: string) => void) | null }`, `class Controls { bind(handlers): void; sync(state: PairState): void }`, `class Arc { show(from: FontEntry, to: FontEntry): void; hide(): void }`

- [ ] **Step 1: Implementar src/ui/specimen.ts**

```ts
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { loadFont } from "../fonts";
import type { PairState } from "../types";

gsap.registerPlugin(Flip);

export class Specimen {
  onTextEdit: ((text: string) => void) | null = null;
  private headline = document.getElementById("spec-headline")!;
  private body = document.getElementById("spec-body")!;

  constructor() {
    this.headline.addEventListener("input", () =>
      this.onTextEdit?.(this.headline.textContent ?? ""));
  }

  /** Troca as fontes do specimen com transição Flip; sem subset (texto é editável). */
  async apply(state: PairState): Promise<void> {
    const [okA, okB] = await Promise.all([
      loadFont(state.a, 700), loadFont(state.b, 400),
    ]);
    const flip = Flip.getState([this.headline, this.body]);
    if (okA) this.headline.style.fontFamily = `"${state.a}", serif`;
    if (okB) this.body.style.fontFamily = `"${state.b}", sans-serif`;
    Flip.from(flip, { duration: 0.7, ease: "power3.out", absolute: true });
    gsap.fromTo([this.headline, this.body],
      { opacity: 0.3, y: 8 },
      { opacity: 1, y: 0, duration: 0.6, stagger: 0.08, ease: "power2.out" });
  }
}
```

- [ ] **Step 2: Implementar src/ui/controls.ts**

```ts
import type { PairState } from "../types";

interface Handlers {
  onGenerate: () => void;
  onContrast: (value: number) => void;
  onToggleLock: (slot: "a" | "b") => void;
}

export class Controls {
  private generate = document.getElementById("generate") as HTMLButtonElement;
  private contrast = document.getElementById("contrast") as HTMLInputElement;
  private lockA = document.getElementById("lock-a") as HTMLButtonElement;
  private lockB = document.getElementById("lock-b") as HTMLButtonElement;

  bind(handlers: Handlers): void {
    this.generate.addEventListener("click", handlers.onGenerate);
    this.contrast.addEventListener("input", () =>
      handlers.onContrast(Number(this.contrast.value)));
    this.lockA.addEventListener("click", () => handlers.onToggleLock("a"));
    this.lockB.addEventListener("click", () => handlers.onToggleLock("b"));
    addEventListener("keydown", (ev) => {
      const editing = (ev.target as HTMLElement)?.isContentEditable;
      if (ev.code === "Space" && !editing) { ev.preventDefault(); handlers.onGenerate(); }
    });
  }

  sync(state: PairState): void {
    this.contrast.value = String(state.contrast);
    this.lockA.setAttribute("aria-pressed", String(state.lockA));
    this.lockB.setAttribute("aria-pressed", String(state.lockB));
    this.lockA.classList.toggle("is-locked", state.lockA);
    this.lockB.classList.toggle("is-locked", state.lockB);
  }
}
```

- [ ] **Step 3: Implementar src/map/arc.ts**

```ts
import gsap from "gsap";
import type { FontEntry } from "../types";
import { WORLD } from "./lod";

const NS = "http://www.w3.org/2000/svg";

export class Arc {
  private path = document.createElementNS(NS, "path");

  constructor(layer: SVGSVGElement) {
    this.path.setAttribute("fill", "none");
    this.path.setAttribute("stroke", "var(--accent)");
    this.path.setAttribute("stroke-width", "2");
    this.path.setAttribute("vector-effect", "non-scaling-stroke");
    this.path.style.opacity = "0";
    layer.appendChild(this.path);
  }

  show(from: FontEntry, to: FontEntry): void {
    const x1 = from.x * WORLD, y1 = from.y * WORLD;
    const x2 = to.x * WORLD, y2 = to.y * WORLD;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    // ponto de controle deslocado perpendicularmente: barriga proporcional à distância
    const cx = mx - dy * 0.18, cy = my + dx * 0.18;
    this.path.setAttribute("d", `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);

    const total = this.path.getTotalLength();
    gsap.fromTo(this.path,
      { strokeDasharray: total, strokeDashoffset: total, opacity: 1 },
      { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut" });
  }

  hide(): void {
    gsap.to(this.path, { opacity: 0, duration: 0.3 });
  }
}
```

- [ ] **Step 4: Orquestrar tudo em src/main.ts**

```ts
import "./styles.css";
import gsap from "gsap";
import { loadFontDB } from "./data";
import { Camera } from "./camera";
import { CardLayer } from "./map/cards";
import { Arc } from "./map/arc";
import { Specimen } from "./ui/specimen";
import { Controls } from "./ui/controls";
import { generatePair } from "./pairing";
import { DEFAULT_STATE, decodeState, encodeState } from "./url-state";
import { WORLD } from "./map/lod";
import type { PairState } from "./types";

const world = document.getElementById("world")!;
const viewport = document.getElementById("viewport")!;
const arcLayer = document.getElementById("arc-layer") as unknown as SVGSVGElement;

async function boot() {
  const db = await loadFontDB();
  let state: PairState = decodeState(location.search.slice(1));
  if (!db.byFamily.has(state.a) || !db.byFamily.has(state.b)) state = { ...DEFAULT_STATE };

  const camera = new Camera(world, viewport);
  const layer = new CardLayer(world, db.entries);
  const arc = new Arc(arcLayer);
  const specimen = new Specimen();
  const controls = new Controls();

  camera.onChange = () => layer.render(camera.view());
  addEventListener("resize", () => layer.render(camera.view()));

  const markActive = () => {
    document.querySelectorAll(".card--active")
      .forEach((el) => el.classList.remove("card--active"));
    layer.nodeFor(state.a)?.classList.add("card--active");
    layer.nodeFor(state.b)?.classList.add("card--active");
  };

  const commit = async (animateCamera: boolean) => {
    history.replaceState(null, "", `?${encodeState(state)}`);
    controls.sync(state);
    const A = db.byFamily.get(state.a)!, B = db.byFamily.get(state.b)!;
    if (animateCamera) {
      const cx = (A.x + B.x) / 2 * WORLD, cy = (A.y + B.y) / 2 * WORLD;
      const spread = Math.max(Math.hypot((A.x - B.x) * WORLD, (A.y - B.y) * WORLD), 400);
      const target = gsap.utils.clamp(0.5, 1.8, viewport.clientWidth / (spread * 1.8));
      camera.flyTo(cx, cy, target);
    }
    await specimen.apply(state);
    layer.render(camera.view());
    arc.show(A, B);
    markActive();
  };

  controls.bind({
    onGenerate: () => { state = { ...state, ...generatePair(db, state) }; commit(true); },
    onContrast: (contrast) => { state = { ...state, contrast }; },
    onToggleLock: (slot) => {
      state = slot === "a" ? { ...state, lockA: !state.lockA } : { ...state, lockB: !state.lockB };
      controls.sync(state);
    },
  });
  specimen.onTextEdit = (text) => {
    state = { ...state, text };
    history.replaceState(null, "", `?${encodeState(state)}`);
  };
  layer.onPick = (family) => {
    state = state.lockA ? { ...state, b: family } : { ...state, a: family };
    commit(false);
  };

  commit(true);
}
boot();
```

- [ ] **Step 5: Estilos do HUD (append em styles.css)**

```css
#specimen { max-width: 900px; text-align: center; }
#spec-headline { font-size: clamp(40px, 6vw, 84px); line-height: 1.05; outline: none; }
#spec-body { margin-top: 16px; font-size: 19px; line-height: 1.6; color: var(--muted); outline: none; }
#spec-headline:focus, #spec-body:focus { color: var(--ink); }
#controls { display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(10px);
  font-family: system-ui, sans-serif; }
#controls button { background: none; border: 1px solid var(--card-border); color: var(--muted);
  padding: 8px 14px; cursor: pointer; font-size: 12px; letter-spacing: .1em;
  text-transform: uppercase; transition: all .2s ease; }
#controls button:hover { color: var(--ink); border-color: var(--ink); }
#controls button.is-locked { color: var(--accent); border-color: var(--accent); }
#generate { background: var(--accent) !important; border-color: var(--accent) !important;
  color: #0d0d0f !important; }
#contrast { width: 180px; accent-color: var(--accent); }
```

- [ ] **Step 6: Verificar no browser**

Checklist manual: "gerar" (e barra de espaço) troca o par, câmera voa até enquadrar os dois, arco desenha, specimen faz Flip; travar A e gerar mantém a headline e troca só o corpo; slider muda o caráter dos resultados (0 = pares harmônicos, 1 = contrastantes); clicar num card do mapa seta o slot livre; recarregar a URL restaura o mesmo estado; editar o texto persiste no link.

- [ ] **Step 7: Commit**

```bash
git add src/ui src/map/arc.ts src/main.ts src/styles.css && git commit -m "feat: specimen, controles, arco e coreografia de geração"
```

---

### Task 9: Fundo shader + fallback

**Files:**
- Create: `src/background.ts`
- Modify: `src/main.ts` (inicializar fundo)

**Interfaces:**
- Consumes: nada
- Produces: `initBackground(canvas: HTMLCanvasElement): void` — inicia o shader; se WebGL não estiver disponível, aplica gradiente CSS e retorna sem erro. Respeita `prefers-reduced-motion` (renderiza um frame estático em vez de animar).

- [ ] **Step 1: Implementar src/background.ts**

```ts
const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `precision mediump float;
uniform vec2 u_res;
uniform float u_time;

// ruído de valor barato: suficiente para grain, sem custo de simplex
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float d = distance(uv, vec2(0.5, 0.55));
  vec3 base = mix(vec3(0.086, 0.086, 0.094), vec3(0.043, 0.043, 0.051), d * 1.6);
  // duas manchas quentes muito sutis, respirando fora de fase
  float glow = 0.05 * sin(u_time * 0.18) + 0.06;
  base += vec3(0.94, 0.33, 0.14) * glow * smoothstep(0.75, 0.0, distance(uv, vec2(0.28, 0.35)));
  base += vec3(0.20, 0.45, 0.40) * glow * smoothstep(0.80, 0.0, distance(uv, vec2(0.78, 0.70)));
  base += (hash(gl_FragCoord.xy) - 0.5) * 0.022; // grain
  gl_FragColor = vec4(base, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export function initBackground(canvas: HTMLCanvasElement): void {
  const gl = canvas.getContext("webgl", { antialias: false, depth: false });
  if (!gl) { canvas.style.background = "radial-gradient(circle at 30% 35%, #16110f, #0d0d0f 70%)"; return; }

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");

  const resize = () => {
    // dpr limitado a 1.5: o fundo é difuso, resolução alta não agrega e custa fill rate
    const dpr = Math.min(devicePixelRatio, 1.5);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  };
  resize();
  addEventListener("resize", resize);

  const draw = (t: number) => {
    gl.uniform1f(uTime, t / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { draw(0); return; }
  const loop = (t: number) => { draw(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
```

- [ ] **Step 2: Ligar no main.ts**

Adicionar no topo do `boot()`:

```ts
initBackground(document.getElementById("bg") as HTMLCanvasElement);
```

com `import { initBackground } from "./background";` junto aos demais imports.

- [ ] **Step 3: Verificar no browser**

O fundo deve ter profundidade sutil e movimento lento, nunca competindo com o texto. Testar fallback forçando `webgl` desabilitado (DevTools → Rendering → disable WebGL, ou renomear temporariamente o contexto para `"webgl-broken"`): a página continua utilizável com gradiente CSS.

- [ ] **Step 4: Commit**

```bash
git add src/background.ts src/main.ts && git commit -m "feat: fundo shader com fallback e reduced-motion"
```

---

### Task 10: Polimento, acessibilidade e build final

**Files:**
- Modify: `src/styles.css`, `index.html`, `src/map/cards.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: tudo das tasks anteriores
- Produces: nada novo (task de acabamento)

- [ ] **Step 1: Fonte da UI e meta tags**

Em `index.html`, dentro do `<head>`, adicionar antes do `</head>`:

```html
<meta name="description" content="Mapa navegável do espaço latente de 1.807 fontes do Google Fonts." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="preload" href="/fonts-map.json" as="fetch" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Em `styles.css`, trocar a família da UI:

```css
body { font-family: "IBM Plex Mono", ui-monospace, monospace; }
```

(e substituir as ocorrências de `font-family: system-ui, sans-serif` em `.card__name`, `.card__meta` e `#controls` por `font-family: inherit`)

- [ ] **Step 2: Bloco de reduced-motion no CSS**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Estado de carregamento**

Em `index.html`, adicionar dentro do `<body>` (antes do `#hud`):

```html
<div id="loading">carregando o mapa…</div>
```

```css
#loading { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center;
  background: var(--bg); color: var(--muted); font-size: 13px; letter-spacing: .12em;
  text-transform: uppercase; transition: opacity .6s ease; }
#loading.is-done { opacity: 0; pointer-events: none; }
```

No final de `boot()` em `main.ts`, após o `commit(true)`:

```ts
document.getElementById("loading")!.classList.add("is-done");
```

- [ ] **Step 4: Acessibilidade dos cards**

Em `src/map/cards.ts`, dentro de `createNode()`, antes do `addEventListener`:

```ts
el.setAttribute("role", "button");
el.setAttribute("tabindex", "0");
el.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    const fam = el.dataset.family;
    if (fam) this.onPick?.(fam);
  }
});
```

E em `decorate()`, ao definir o conteúdo, manter o nome acessível: `el.setAttribute("aria-label", entry.family)`.

- [ ] **Step 5: README.md**

Escrever `README.md` na raiz com este conteúdo (os blocos de comando abaixo aparecem indentados aqui só para não aninhar fences neste plano — no README use cercas ```bash normais):

```markdown
# twofonts

Releitura experimental do [fontjoy](https://fontjoy.com): um mapa navegável do espaço
latente de 1.807 fontes do Google Fonts.

## Rodar

    npm install
    npm run dev

## Regenerar o dataset

O `public/fonts-map.json` é gerado pelo pipeline em `pipeline/` (Python + GPU):

    python -m venv .venv && .venv/Scripts/pip install -r pipeline/requirements.txt
    cd pipeline
    python fetch_catalog.py && python render_glyphs.py
    python extract_features.py && python build_map.py

Catálogo do Google Fonts → grade de glifos 224×224 → DINOv2 → PCA 200d → UMAP 2D.
Nunca misturar vetores de extractors diferentes: a atualização é sempre uma regeneração completa.

## Créditos

Método de embeddings e métrica de pairing derivados de [Jack000/fontjoy](https://github.com/Jack000/fontjoy) (MIT).
```

- [ ] **Step 6: Congelar as dependências Python**

```bash
.venv/Scripts/pip freeze > pipeline/requirements.txt
```

- [ ] **Step 7: Rodar a suíte completa e o build**

Run: `npx vitest run` — Expected: todos os testes passam (data, pairing, url-state, lod, fonts).
Run: `npx vite build` — Expected: build sem erros; conferir que `dist/` contém `fonts-map.json`.

- [ ] **Step 8: Verificação final no browser**

Rodar `npx vite preview` e percorrer o fluxo inteiro: carregamento → mapa → zoom nos três níveis → gerar várias vezes → travar cada slot → mexer no contraste → clicar em cards → editar texto → copiar a URL e abrir em aba nova (estado idêntico). Conferir o console: zero erros.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: polimento estético, acessibilidade e README"
```

---

## Notas de execução

**Ordem:** as tasks são sequenciais — cada uma depende das anteriores. Tasks 1–5 são lógica pura e testável (a maior parte do valor de teste está aí); 6–10 são visuais e verificadas no browser.

**Onde a estética se decide:** Tasks 7 (cards/LOD), 8 (coreografia) e 9 (fundo). Se algo parecer "genérico" ao final, é nesses três que se itera — o resto é infraestrutura.

**Armadilhas conhecidas:**
- Nunca setar `style.transform` no `#world` manualmente — GSAP gerencia a matrix; use sempre `gsap.set`/tween e chame `drag.update()` depois de mutações programáticas.
- O pool de cards recicla nós: sempre conferir `el.dataset.family` dentro de callbacks assíncronos antes de aplicar resultado (o nó pode já ter sido reaproveitado por outra fonte).
- `document.fonts.check()` retorna `false` para fontes ainda não usadas em nenhum nó — por isso o `loadFont` faz `document.fonts.load()` antes de checar.
