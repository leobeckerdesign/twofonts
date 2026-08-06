import type { CardKind } from "../spec";

/**
 * Famílias de shader.
 *
 * Uma família é um fragment shader mais as FAIXAS dos parâmetros dele. O valor
 * concreto de cada parâmetro não está aqui: ele é sorteado por card, a partir de
 * uma semente determinística (id do card mais o par ativo). Assim o mesmo card
 * com o mesmo par sempre volta igual, e trocar de par redesenha tudo.
 *
 * Imagem e vídeo não são tipos separados de motor. Imagem é shader parado num
 * frame, vídeo é shader animado. O que muda é a família e o `motion`.
 */

/** Nome, mínimo e máximo. A ordem é o empacotamento em `u_p`, então no máximo 4. */
export type ParamRange = readonly [string, number, number];

export interface Family {
  id: string;
  params: readonly ParamRange[];
  frag: string;
}

/** Ruído de valor e fbm: barato o bastante para N caixas a 30fps. */
const PRELUDE = `precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_seed;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec4 u_p;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}
`;

export const FAMILIES: Family[] = [
  {
    // Deformação de domínio: fbm alimentando fbm. Faixas orgânicas em movimento.
    id: "flow",
    params: [["speed", 0.05, 0.32], ["scale", 1.6, 4.2], ["warp", 0.5, 1.9], ["grain", 0.0, 0.05]],
    frag: `${PRELUDE}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * u_p.y + u_seed.xy * 12.0;
  float t = u_time * u_p.x;

  vec2 q = vec2(fbm(p + t * 0.10), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + u_p.z * q + vec2(1.7, 9.2) + 0.15 * t),
                fbm(p + u_p.z * q + vec2(8.3, 2.8) + 0.12 * t));
  float f = fbm(p + r);

  vec3 col = mix(u_c0, u_c1, clamp(f * 1.7, 0.0, 1.0));
  col = mix(col, u_c2, clamp(length(r) * 0.75, 0.0, 1.0) * 0.6);
  col += (hash(gl_FragCoord.xy + u_seed.z) - 0.5) * u_p.w;
  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    // Grade de pontos com densidade sorteada. Parado: é o lugar da imagem.
    id: "grid",
    params: [["density", 5.0, 15.0], ["spread", 0.05, 0.30], ["tilt", 0.4, 1.6], ["grain", 0.0, 0.03]],
    frag: `${PRELUDE}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 g = uv * vec2(u_p.x * u_res.x / max(u_res.y, 1.0), u_p.x);
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;

  float n = hash(id + u_seed.xy * 41.0);
  float rad = 0.12 + n * u_p.y;
  float pip = smoothstep(rad, rad - 0.07, length(f));
  float band = smoothstep(0.0, 1.0, (uv.y * 0.7 + uv.x * 0.3) * u_p.z);

  vec3 col = mix(u_c0, u_c1, band * 0.55);
  col = mix(col, u_c2, pip * (0.30 + 0.70 * step(0.74, n)));
  col += (hash(gl_FragCoord.xy) - 0.5) * u_p.w;
  gl_FragColor = vec4(col, 1.0);
}`,
  },
  {
    // Varredura com deriva horizontal e linha de quadro. É o lugar do vídeo.
    id: "scan",
    params: [["speed", 0.15, 0.5], ["warp", 1.0, 4.0], ["shift", 0.3, 1.2], ["grain", 0.0, 0.06]],
    frag: `${PRELUDE}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time * u_p.x;

  float drift = fbm(vec2(uv.y * u_p.y, t * 0.6 + u_seed.x * 9.0));
  vec2 su = uv;
  su.x += (drift - 0.5) * u_p.z * 0.14;

  float v = fbm(su * 3.2 + vec2(t * 0.3, u_seed.y * 7.0));
  float bands = sin(su.y * u_res.y * 0.55 + t * 4.0) * 0.5 + 0.5;

  vec3 col = mix(u_c0, u_c1, v);
  col = mix(col, u_c2, smoothstep(0.56, 0.95, v) * 0.8);
  col *= 0.87 + 0.13 * bands;
  col += (hash(gl_FragCoord.xy + t) - 0.5) * u_p.w;
  gl_FragColor = vec4(col, 1.0);
}`,
  },
];

export const familyById = (id: string): Family =>
  FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];

const rgb = (hex: number): [number, number, number] => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

/**
 * Paleta por tipo de card, e não por família.
 *
 * `u_c0` é o fundo, `u_c1` um tom vizinho e `u_c2` o destaque. São vizinhos de
 * propósito: misturar papel com tinta direto dava um contraste que brigava com
 * o texto por cima, em vez de sustentar.
 */
export const PALETTE: Record<CardKind, [number[], number[], number[]]> = {
  paper: [rgb(0xe9e5dd), rgb(0xc9c2b4), rgb(0xf05524)],
  ink: [rgb(0x131310), rgb(0x2a2a24), rgb(0xf05524)],
  accent: [rgb(0xf05524), rgb(0xc33d14), rgb(0x14120f)],
};
