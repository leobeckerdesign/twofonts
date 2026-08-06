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

/** Proporção do quadro, para o campo não esticar em caixa larga. */
vec2 aspect(vec2 uv) { return (uv - 0.5) * vec2(u_res.x / max(u_res.y, 1.0), 1.0); }

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
  // A rampa é medida em torno do centro e reescalada para cobrir a faixa
  // inteira. Somando escala à posição, ela ficava comprimida perto de 0.5 e o
  // campo saía quase chapado.
  vec2 p = uv - 0.5;
  p += u_p.z * 0.4 * vec2(snoise(uv * u_p.y + tt * 0.5 + u_seed.x * 8.0),
                          snoise(uv.yx * u_p.y - tt * 0.4 + u_seed.y * 5.0));
  float g = dot(normalize(vec2(0.72, 0.69)), p) * 1.45 + 0.5;
  return smoothstep(0.04, 0.96, g);
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
  {
    // Dois focos respirando fora de fase. Radial puro, sem estrutura interna.
    id: "bloom",
    label: "florada",
    params: [["speed", 0.05, 0.35], ["scale", 0.8, 2.2], ["falloff", 0.6, 2.0], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  vec2 a = aspect(uv) - vec2(-0.14 + 0.12 * sin(tt * 0.7 + u_seed.x * 6.28),
                             -0.06 + 0.10 * cos(tt * 0.5 + u_seed.y * 6.28));
  vec2 b = aspect(uv) - vec2(0.22 - 0.09 * cos(tt * 0.6 + u_seed.y * 4.1),
                             0.18 + 0.08 * sin(tt * 0.43 + u_seed.z * 5.2));
  float g = exp(-dot(a, a) * u_p.y * u_p.z * 2.6);
  g += 0.6 * exp(-dot(b, b) * u_p.y * u_p.z * 4.4);
  return clamp(g, 0.0, 1.0);
}`),
  },
  {
    // Camadas sedimentares. Os patamares são largos de propósito: com
    // frequência alta isto vira listra fina, que é o caso reprovado.
    id: "strata",
    label: "estratos",
    params: [["speed", 0.02, 0.12], ["bands", 0.9, 2.6], ["tilt", 0.15, 0.7], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  float y = uv.y * u_p.y
          + snoise(vec2(uv.x * 1.3, tt * 0.4 + u_seed.x * 5.0)) * u_p.z
          + uv.x * u_p.z * 0.4;
  return smoothstep(0.12, 0.88, sin(y * 6.2831) * 0.5 + 0.5);
}`),
  },
  {
    // Luz de água. O 1 - abs(n) cria cristas, e o quadrado afina só as cristas.
    id: "caustics",
    label: "cáustica",
    params: [["speed", 0.05, 0.3], ["scale", 1.0, 2.6], ["warp", 0.3, 1.1], ["grain", 0.0, 0.025]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  vec2 p = uv * u_p.y + u_seed.xy * 6.0;
  float a = snoise(p + vec2(tt, 0.0));
  float b = snoise(p.yx * 1.24 - vec2(0.0, tt * 0.8));
  float c = snoise(p + vec2(a, b) * u_p.z);
  float k = 1.0 - abs(c);
  return smoothstep(0.4, 1.0, k * k);
}`),
  },
  {
    // Malha de gradiente: quatro bolhas macias que se cruzam e se somam.
    id: "mesh",
    label: "malha",
    params: [["speed", 0.04, 0.26], ["spread", 1.2, 4.0], ["gain", 0.5, 1.2], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  float g = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(0.40 * sin(tt * (0.4 + fi * 0.13) + u_seed.x * 6.28 + fi * 2.1),
                  0.40 * cos(tt * (0.33 + fi * 0.17) + u_seed.y * 6.28 + fi * 1.7));
    vec2 d = aspect(uv) - c;
    g += exp(-dot(d, d) * u_p.y * 2.2) * (0.55 + 0.45 * sin(fi * 2.0 + u_seed.z * 6.28));
  }
  return clamp(g * u_p.z, 0.0, 1.0);
}`),
  },
  {
    // Marulho: três senoides longas cruzando. Interferência de baixa frequência.
    id: "swell",
    label: "marulho",
    params: [["speed", 0.05, 0.28], ["length", 0.7, 2.0], ["angle", 0.0, 3.14], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  vec2 p = rot(uv - 0.5, u_p.z) + 0.5;
  float w1 = sin((p.x * u_p.y + tt) * 3.1416);
  float w2 = sin((p.y * u_p.y * 0.72 - tt * 0.8) * 3.1416 + u_seed.x * 6.28);
  float w3 = sin(((p.x + p.y) * u_p.y * 0.5 + tt * 0.6) * 3.1416 + u_seed.y * 6.28);
  return clamp((w1 + w2 + w3) / 6.0 + 0.5, 0.0, 1.0);
}`),
  },
  {
    // Rampa quase lisa. Aqui o interesse é a granulação, não a forma, então
    // esta é a única família com faixa de grão larga.
    id: "grain",
    label: "grão",
    params: [["drift", 0.01, 0.08], ["scale", 0.5, 1.6], ["angle", 0.0, 3.14], ["grain", 0.02, 0.09]],
    frag: build(`float field(vec2 uv, float t) {
  vec2 p = rot(uv - 0.5, u_p.z);
  float ramp = smoothstep(-0.62, 0.62, p.x + p.y * 0.45 + t * u_p.x * 0.2);
  return clamp(ramp + snoise(uv * u_p.y + u_seed.xy * 4.0) * 0.16, 0.0, 1.0);
}`),
  },
  {
    // Redemoinho lento. A queda radial mata a frequência alta do centro.
    id: "vortex",
    label: "vórtice",
    params: [["speed", 0.04, 0.24], ["twist", 0.6, 2.2], ["arms", 2.0, 5.0], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  float tt = t * u_p.x;
  vec2 d = aspect(uv);
  float r = length(d);
  float a = atan(d.y, d.x);
  float spiral = sin(a * u_p.z + r * u_p.y * 5.0 - tt * 2.0 + u_seed.x * 6.28);
  return clamp(0.5 + 0.5 * spiral * smoothstep(0.95, 0.05, r), 0.0, 1.0);
}`),
  },
  {
    // Cristas de duna: ruído dobrado em 1 - abs, somado em três oitavas.
    id: "dunes",
    label: "dunas",
    params: [["speed", 0.02, 0.12], ["scale", 0.7, 2.0], ["gain", 0.7, 1.3], ["grain", 0.0, 0.03]],
    frag: build(`float field(vec2 uv, float t) {
  vec2 p = uv * u_p.y + vec2(t * u_p.x * 0.5, u_seed.x * 7.0);
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * (1.0 - abs(snoise(p)));
    p = p * 2.07 + vec2(1.3, -0.7);
    a *= 0.5;
  }
  return smoothstep(0.42, 1.0, v * u_p.z);
}`),
  },
];

export const familyById = (id: string): Family =>
  FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];
