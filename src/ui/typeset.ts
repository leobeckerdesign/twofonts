import { weightFor } from "../pairs";
import { PARA } from "../render";
import type { FontMeta, WeightRole } from "../types";

/**
 * O estado do editor lateral, sem uma linha de DOM.
 *
 * Mora separado do painel pelo mesmo motivo que `roles.ts` mora separado do
 * campo: aqui está a única parte que dá para provar em teste — os limites de
 * cada controle, a queda de peso quando a família nova não tem a faixa
 * escolhida, e a tradução de tudo isso em declarações CSS. O `editor.ts` cuida
 * de pixels e eventos, e não decide nada.
 */

export type SlotName = "title" | "body";

/** Nenhuma, versalete cheio, minúscula. Os três botões `Aa AA aa` do desenho. */
export type CaseMode = "none" | "upper" | "lower";

/**
 * Ordem tipográfica dos papéis, do mais leve ao mais pesado.
 *
 * A queda anda por esta lista quando a família não tem a faixa pedida, então a
 * ordem importa: `bold` numa família sem negrito cai em `regular`, nunca em
 * `light`. `weightFor` faz a mesma queda em número; aqui é em PAPEL, porque é o
 * papel que o botão do painel mostra — sem isto, o botão diria "Bold" enquanto
 * a tela mostra 400, e a amostra estaria mentindo.
 */
export const WEIGHT_ROLES: readonly WeightRole[] = ["light", "regular", "bold"];

export const CASE_MODES: readonly CaseMode[] = ["none", "upper", "lower"];

export interface SlotState {
  text: string;
  weight: WeightRole;
  /** corpo em px */
  size: number;
  /** entrelinha como multiplicador do corpo */
  leading: number;
  caps: CaseMode;
}

export interface TypesetState {
  title: SlotState;
  body: SlotState;
}

export interface Limit {
  min: number;
  max: number;
  step: number;
}

/**
 * Os limites de cada controle, por papel.
 *
 * São faixas diferentes de propósito: título e parágrafo não competem pela
 * mesma régua. As entrelinhas de partida (1.02 e 1.55) são exatamente as que
 * `.t` e `.p` usam no palco, para o painel abrir no mesmo ajuste que os cards.
 */
export const LIMITS: Record<SlotName, { size: Limit; leading: Limit }> = {
  title: {
    size: { min: 24, max: 120, step: 1 },
    leading: { min: 0.85, max: 1.6, step: 0.01 },
  },
  body: {
    size: { min: 12, max: 28, step: 1 },
    leading: { min: 1.2, max: 2, step: 0.01 },
  },
};

export const DEFAULT_TEXT: Record<SlotName, string> = {
  title: "Componha com intenção",
  // Começa pelo MESMO parágrafo dos cards — uma voz só —, e segue com uma
  // segunda parte que só existe aqui. O painel precisa do dobro de texto: com
  // quatro linhas dava para ver o desenho da letra, não o comportamento dela em
  // massa, que é onde o parágrafo se decide.
  body: `${PARA} É por isso que o teste não é olhar uma fonte de cada vez: `
    + "o que se julga é a conversa entre as duas, no corpo em que ela acontece.",
};

/** 48 e não 56: o cartão tem a altura entre o topo e a barra, e o título é o
 *  que mais come dessa conta. Quem quiser 56 arrasta a régua. */
const DEFAULT_SIZE: Record<SlotName, number> = { title: 48, body: 17 };
const DEFAULT_LEADING: Record<SlotName, number> = { title: 1.02, body: 1.55 };

/** Arredonda ao passo e prende na faixa. Entrada de usuário nunca passa crua. */
export function clampTo(value: number, limit: Limit): number {
  // Só o NaN precisa de saída própria: ele atravessa qualquer comparação sem
  // ser pego. Infinito o `min`/`max` resolve sozinho, e para a ponta CERTA.
  if (Number.isNaN(value)) return limit.min;
  const stepped = Math.round(value / limit.step) * limit.step;
  const bounded = Math.min(limit.max, Math.max(limit.min, stepped));
  // O passo fracionário da entrelinha acumula erro binário (1.5500000000000002);
  // duas casas bastam para toda faixa declarada aqui.
  return Math.round(bounded * 100) / 100;
}

/**
 * O papel disponível mais próximo do pedido.
 *
 * Uma família sem `bold` não pode mostrar negrito: o navegador falsificaria o
 * traço engordando o contorno, e a amostra deixaria de ser a fonte. Então o
 * estado cede — e o painel move a seleção à vista, em vez de manter aceso um
 * botão que não corresponde ao que está na tela.
 */
export function nearestRole(font: FontMeta | undefined, role: WeightRole): WeightRole {
  if (!font) return role;
  if (font.w[role] !== undefined) return role;

  const wanted = WEIGHT_ROLES.indexOf(role);
  let best: WeightRole | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of WEIGHT_ROLES) {
    if (font.w[candidate] === undefined) continue;
    const distance = Math.abs(WEIGHT_ROLES.indexOf(candidate) - wanted);
    // `<=` e não `<`: a lista anda do leve ao pesado, então o empate fica com o
    // último visitado — entre light e bold para um regular ausente, o texto
    // sobrevive melhor com mais peso do que com menos.
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ?? role;
}

/** Os papéis que a família realmente tem, na ordem tipográfica. */
export const rolesOf = (font: FontMeta | undefined): WeightRole[] =>
  WEIGHT_ROLES.filter((role) => font?.w[role] !== undefined);

/**
 * O estado de abertura. Os pesos vêm do corte ativo — o painel nasce no mesmo
 * ajuste do campo — e a partir daí são do usuário: mexer no slider de contraste
 * troca as fontes, nunca a escolha de quem está editando.
 */
export function defaultState(roles: [WeightRole, WeightRole]): TypesetState {
  const slot = (name: SlotName, weight: WeightRole): SlotState => ({
    text: DEFAULT_TEXT[name],
    weight,
    size: DEFAULT_SIZE[name],
    leading: DEFAULT_LEADING[name],
    caps: "none",
  });
  return { title: slot("title", roles[0]), body: slot("body", roles[1]) };
}

export interface SlotCss {
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
  lineHeight: string;
  textTransform: string;
}

const TRANSFORM: Record<CaseMode, string> = {
  none: "none",
  upper: "uppercase",
  lower: "lowercase",
};

/**
 * O estado virando CSS. A família sai com a MESMA pilha de reserva do campo
 * (`serif` no título, `sans-serif` no corpo), senão o painel mostraria uma
 * fonte de espera diferente da dos cards enquanto a de verdade não chega.
 */
export function slotCss(name: SlotName, slot: SlotState, font: FontMeta | undefined): SlotCss {
  const family = font?.f ?? "";
  const fallback = name === "title" ? "serif" : "sans-serif";
  return {
    fontFamily: family === "" ? fallback : `"${family}", ${fallback}`,
    fontWeight: String(weightFor(font, slot.weight)),
    fontSize: `${slot.size}px`,
    lineHeight: String(slot.leading),
    textTransform: TRANSFORM[slot.caps],
  };
}
