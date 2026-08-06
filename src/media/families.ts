/**
 * Famílias de shader.
 *
 * REGRA QUE GOVERNA TODAS: elas existem para ficar ATRÁS de texto. Uma família
 * não devolve cor, devolve um CAMPO ESCALAR de 0 a 1. Quem vira cor é o rabo
 * comum lá embaixo, que mapeia o campo dentro do envelope de luminância vindo
 * de legibility.ts e trava ali. O shader fica proibido de caminhar na direção
 * da cor do texto, então a legibilidade não depende da família ter bom gosto.
 *
 * Consequências práticas do desenho:
 * - Nada de ponto, grade, filete ou linha de varredura. Detalhe de alta
 *   frequência e alta amplitude compete com a letra na mesma escala e destrói a
 *   leitura, que foi exatamente o problema das três primeiras famílias.
 * - Feições grandes e lentas. O campo varia ao longo do card, não dentro de uma
 *   palavra.
 *
 * O padrão moiré da família `silk` é adaptado do componente Silk do react-bits
 * (github.com/DavidHDev/react-bits), MIT com Commons Clause: usar dentro de uma
 * aplicação é permitido, revender os componentes não. O ruído simplex é a
 * implementação clássica de Ashima Arts.
 */

/** Nome, mínimo e máximo. A ordem é o empacotamento em `u_p`, então no máximo 4. */
export type ParamRange = readonly [string, number, number];

export interface Family {
  id: string;
  /** rótulo curto para a bancada */
  label: string;
  params: readonly ParamRange[];
  frag: string;
}

const PRELUDE = `precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_seed;
uniform vec3 u_bg;
uniform vec3 u_near;
uniform vec3 u_accent;
uniform vec2 u_band;
uniform float u_amount;
uniform vec4 u_p;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * snoise(p); p *= 2.03; a *= 0.5; }
  return v * 0.5 + 0.5;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

// Cada família implementa esta. Devolve 0 a 1.
float field(vec2 uv, float t);

// ---- rabo comum: campo vira cor DENTRO do envelope ----
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
float lum(vec3 lin) { return dot(lin, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float v = clamp(field(uv, u_time), 0.0, 1.0);

  vec3 col = mix(u_bg, u_near, smoothstep(0.0, 1.0, v) * u_amount);
  col = mix(col, u_accent, smoothstep(0.62, 1.0, v) * u_amount * 0.55);
  col += (hash(gl_FragCoord.xy + u_seed.z) - 0.5) * u_p.w;

  // A trava. Reescala a luminância para dentro da faixa preservando a cor.
  vec3 lin = toLin(clamp(col, 0.0, 1.0));
  float l = lum(lin);
  float target = clamp(l, u_band.x, u_band.y);
  lin *= (l > 0.0005) ? (target / l) : 1.0;
  gl_FragColor = vec4(toSrgb(clamp(lin, 0.0, 1.0)), 1.0);
}
`;

/** O corpo da família entra ANTES do main, então `field` precisa vir junto. */
const build = (body: string): string =>
  PRELUDE.replace("float field(vec2 uv, float t);", body);

export const FAMILIES: Family[] = [
  {
    id: "aurora",
    label: "aurora",
    params: [["speed", 0.04, 0.22], ["scale", 0.8, 2.4], ["spread", 0.4, 1.1], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  float h = uv.y * 2.0 - 1.0;
  float n1 = snoise(vec2(uv.x * u_p.y + tt * 0.5, tt * 0.3 + u_seed.x * 11.0));
  float n2 = snoise(vec2(uv.x * u_p.y * 0.7 - tt * 0.4, tt * 0.22 + u_seed.y * 7.0));
  float a = smoothstep(1.0, 0.0, abs(h - 0.25 - n1 * u_p.z * 0.7));
  float b = smoothstep(0.9, 0.0, abs(h + 0.4 - n2 * u_p.z * 0.6));
  return clamp(a * 0.75 + b * 0.55, 0.0, 1.0);
}`),
  },
  {
    id: "silk",
    label: "seda",
    params: [["speed", 0.05, 0.3], ["scale", 0.9, 2.2], ["rotation", 0.0, 3.14], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  vec2 tex = rot(uv * u_p.y, u_p.z);
  float tt = t * u_p.x;
  tex.y += 0.05 * sin(4.0 * tex.x - tt);
  // Frequências mantidas baixas: o Silk original usa 20.0 no termo final, que
  // na escala de um card vira listra fina em cima da letra.
  float pattern = 0.5 + 0.5 * sin(
    3.2 * (tex.x + tex.y + cos(2.0 * tex.x + 3.0 * tex.y) + 0.03 * tt)
    + sin(6.0 * (tex.x + tex.y - 0.1 * tt))
  );
  return pattern;
}`),
  },
  {
    id: "veil",
    label: "véu",
    params: [["speed", 0.03, 0.16], ["scale", 0.7, 1.9], ["warp", 0.2, 0.9], ["grain", 0.0, 0.035]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  vec2 p = uv * u_p.y + u_seed.xy * 8.0;
  p += u_p.z * vec2(snoise(p + tt * 0.5), snoise(p.yx - tt * 0.4));
  float g = dot(normalize(vec2(0.72, 0.69)), p) * 0.32 + 0.5;
  return clamp(g, 0.0, 1.0);
}`),
  },
  {
    id: "drift",
    label: "deriva",
    params: [["speed", 0.02, 0.14], ["scale", 0.6, 1.8], ["warp", 0.3, 1.2], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  vec2 p = uv * u_p.y + u_seed.xy * 9.0;
  vec2 q = vec2(fbm(p + tt * 0.4), fbm(p + vec2(3.1, 7.7) - tt * 0.3));
  float f = fbm(p + u_p.z * q);
  return smoothstep(0.28, 0.86, f);
}`),
  },
];

export const familyById = (id: string): Family =>
  FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];
