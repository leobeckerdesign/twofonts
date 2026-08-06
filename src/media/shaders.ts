import type { CardKind } from "../spec";
import { familyById, type Family } from "./families";
import { luminanceBand, PALETTES, type CardPalette } from "./legibility";

/**
 * Motor de mídia dos cards.
 *
 * UM contexto WebGL para todas as caixas, nunca um por card. O navegador
 * descarta o contexto mais antigo por volta de 16, e 18 canvas animados
 * brigariam pelo orçamento de frame que o GSAP já usa no campo. Então uma GL
 * fora da tela desenha cada caixa num canto do próprio buffer e copia o
 * resultado para o canvas 2D da caixa.
 *
 * Mesma postura do background.ts: taxa travada, DPR limitado, pausa com a aba
 * escondida, e qualquer falha cai para o fundo do CSS em vez de sumir.
 */

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

/**
 * Teto do buffer compartilhado. O custo por frame é a área da viewport, não a
 * do buffer, então folga aqui é barata: 1024² em RGBA são 4 MB de VRAM alocados
 * uma vez. Com 480 o card mais largo já era reamostrado para cima.
 */
const MAX = 1024;
const FPS = 30;
/** Caixas redesenhadas por tick. Segura o custo quando muitas estão visíveis. */
const BUDGET = 6;

interface Slot {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  family: Family;
  still: boolean;
  seed: [number, number, number];
  params: number[];
  palette: CardPalette;
  /** faixa de luminância permitida, vinda do contraste exigido com o texto */
  band: [number, number];
  /** quanto o campo pode se afastar do fundo, de 0 a 1 */
  amount: number;
  w: number;
  h: number;
  drawn: boolean;
}

interface Program {
  program: WebGLProgram;
  res: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  seed: WebGLUniformLocation | null;
  bg: WebGLUniformLocation | null;
  near: WebGLUniformLocation | null;
  accent: WebGLUniformLocation | null;
  band: WebGLUniformLocation | null;
  amount: WebGLUniformLocation | null;
  p: WebGLUniformLocation | null;
}

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Gerador barato e estável: a mesma semente devolve sempre a mesma sequência. */
function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGLRenderingContext, frag: string): Program | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  return {
    program,
    res: gl.getUniformLocation(program, "u_res"),
    time: gl.getUniformLocation(program, "u_time"),
    seed: gl.getUniformLocation(program, "u_seed"),
    bg: gl.getUniformLocation(program, "u_bg"),
    near: gl.getUniformLocation(program, "u_near"),
    accent: gl.getUniformLocation(program, "u_accent"),
    band: gl.getUniformLocation(program, "u_band"),
    amount: gl.getUniformLocation(program, "u_amount"),
    p: gl.getUniformLocation(program, "u_p"),
  };
}

export interface MediaEngine {
  /** Relê as caixas do campo. Chamar depois de cada repintura. */
  scan: (root: HTMLElement, salt: string) => void;
  /** Reavalia tamanhos sem mexer nas sementes. */
  measure: () => void;
  destroy: () => void;
}

export function initMedia(): MediaEngine | null {
  const off = document.createElement("canvas");
  off.width = MAX;
  off.height = MAX;

  let gl: WebGLRenderingContext | null = null;
  try {
    gl = off.getContext("webgl", { antialias: false, depth: false, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  if (!gl) return null;

  const programs = new Map<string, Program | null>();
  let slots: Slot[] = [];
  let stopped = false;
  let frame: number | null = null;
  let last = Number.NEGATIVE_INFINITY;
  let cursor = 0;

  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const programFor = (family: Family): Program | null => {
    if (!programs.has(family.id)) programs.set(family.id, link(gl, family.frag));
    return programs.get(family.id) ?? null;
  };

  /** O tamanho vem do layout, não do rect: o card vive dentro de um `scale`. */
  const sizeOf = (el: HTMLElement): [number, number] => {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
    const w = Math.max(1, Math.min(MAX, Math.round(el.clientWidth * dpr)));
    const h = Math.max(1, Math.min(MAX, Math.round(el.clientHeight * dpr)));
    return [w, h];
  };

  const draw = (slot: Slot, timestamp: number): void => {
    const prog = programFor(slot.family);
    if (!prog || !gl) return;

    gl.useProgram(prog.program);
    const position = gl.getAttribLocation(prog.program, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    gl.viewport(0, 0, slot.w, slot.h);
    gl.uniform2f(prog.res, slot.w, slot.h);
    gl.uniform1f(prog.time, slot.still ? 0 : timestamp / 1000);
    gl.uniform3f(prog.seed, slot.seed[0], slot.seed[1], slot.seed[2]);
    gl.uniform3fv(prog.bg, slot.palette.bg as unknown as number[]);
    gl.uniform3fv(prog.near, slot.palette.near as unknown as number[]);
    gl.uniform3fv(prog.accent, slot.palette.accent as unknown as number[]);
    gl.uniform2f(prog.band, slot.band[0], slot.band[1]);
    gl.uniform1f(prog.amount, slot.amount);
    gl.uniform4f(
      prog.p,
      slot.params[0] ?? 0,
      slot.params[1] ?? 0,
      slot.params[2] ?? 0,
      slot.params[3] ?? 0,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // A viewport ocupa o canto inferior esquerdo do buffer, que em coordenada
    // de canvas fica embaixo. Daí o recorte começar em `MAX - h`.
    slot.ctx.clearRect(0, 0, slot.w, slot.h);
    slot.ctx.drawImage(off, 0, MAX - slot.h, slot.w, slot.h, 0, 0, slot.w, slot.h);
    slot.drawn = true;
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    document.removeEventListener("visibilitychange", onVisibility);
    for (const slot of slots) slot.el.classList.add("box--fallback");
    slots = [];
  };

  function loop(timestamp: number): void {
    frame = null;
    if (stopped || document.hidden) return;

    if (timestamp - last >= 1000 / FPS) {
      last = timestamp;
      try {
        let done = 0;
        for (let i = 0; i < slots.length && done < BUDGET; i++) {
          const slot = slots[(cursor + i) % slots.length];
          if (slot.still && slot.drawn) continue;
          draw(slot, timestamp);
          done++;
        }
        cursor = slots.length === 0 ? 0 : (cursor + done) % slots.length;
      } catch {
        stop();
        return;
      }
    }
    request();
  }

  function request(): void {
    if (frame !== null || stopped || document.hidden || slots.length === 0) return;
    frame = requestAnimationFrame(loop);
  }

  function onVisibility(): void {
    if (document.hidden) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      return;
    }
    last = Number.NEGATIVE_INFINITY;
    request();
  }

  document.addEventListener("visibilitychange", onVisibility);
  off.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    stop();
  });

  const scan = (root: HTMLElement, salt: string): void => {
    if (stopped) return;
    const next: Slot[] = [];

    for (const el of root.querySelectorAll<HTMLElement>(".box")) {
      const canvas = el.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const family = familyById(el.dataset.family ?? "flow");
      const card = el.closest<HTMLElement>(".card");
      const kind = (card?.dataset.kind ?? "paper") as CardKind;
      const id = card?.dataset.card ?? "?";

      // A semente amarra card, família e par. Trocar de par redesenha tudo;
      // voltar para o par anterior devolve exatamente o mesmo desenho.
      const fixed = el.dataset.seed !== undefined && el.dataset.seed !== "auto";
      const rand = mulberry32(
        fixed ? Number(el.dataset.seed) >>> 0 : hash32(`${id}:${family.id}:${salt}`),
      );

      let override: Record<string, number> = {};
      if (el.dataset.params !== undefined && el.dataset.params !== "") {
        try {
          override = JSON.parse(el.dataset.params) as Record<string, number>;
        } catch {
          // Parâmetro escrito errado no spec não pode derrubar o card inteiro.
        }
      }

      const params = family.params.map(([name, min, max]) => override[name] ?? min + rand() * (max - min));
      const seed: [number, number, number] = [rand(), rand(), rand()];
      const [w, h] = sizeOf(el);
      canvas.width = w;
      canvas.height = h;

      next.push({
        el, canvas, ctx, family, seed, params,
        still: (el.dataset.motion ?? "loop") === "still" || reduced,
        palette: PALETTES[kind] ?? PALETTES.paper,
        // A trava de legibilidade. Vem do contraste exigido contra a cor do
        // texto do card, não de um valor escolhido a olho.
        band: luminanceBand(kind),
        amount: override.amount ?? 1,
        w, h, drawn: false,
      });
    }

    slots = next;
    cursor = 0;
    last = Number.NEGATIVE_INFINITY;
    request();
  };

  const measure = (): void => {
    if (stopped) return;
    for (const slot of slots) {
      const [w, h] = sizeOf(slot.el);
      if (w === slot.w && h === slot.h) continue;
      slot.canvas.width = w;
      slot.canvas.height = h;
      slot.w = w;
      slot.h = h;
      slot.drawn = false;
    }
    request();
  };

  return { scan, measure, destroy: stop };
}
