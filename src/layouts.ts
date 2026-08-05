import spec from "./layouts.json";
import { renderBlocks, type RenderContext } from "./render";
import type { CardKind, CardSpec, LayoutsFile } from "./spec";

/**
 * Os cards do palco, montados a partir de `layouts.json`.
 *
 * Antes eram 18 funções que escreviam HTML na mão. Viraram dado para poderem ir
 * ao Figma como frames nomeados, voltar editados, e virar HTML de novo sem
 * ninguém reescrever código. A interface que o campo consome não mudou: ele
 * continua chamando `layout.html(context)` e recebendo a mesma string.
 */

export type { CardKind };
export type LayoutContext = RenderContext;

export interface Layout {
  id: string;
  kind: CardKind;
  /** largura de projeto; o campo escala isso conforme o viewport */
  w: number;
  /** multiplicador do corpo de texto deste layout */
  bodyScale: number;
  /** multiplicador do título, aplicado sobre a razão de contraste */
  titleScale: number;
  html: (c: LayoutContext) => string;
}

const file = spec as LayoutsFile;

/** Par e contraste que o arquivo do Figma congela. A importação usa para inverter tamanhos. */
export const FROZEN = file.frozen;

/** Os cards ainda como dado, para quem precisa da estrutura e não do HTML. */
export const CARDS: CardSpec[] = file.cards;

export const LAYOUTS: Layout[] = file.cards.map((card) => ({
  id: card.id,
  kind: card.kind,
  w: card.w,
  bodyScale: card.bodyScale,
  titleScale: card.titleScale,
  html: (c: LayoutContext) => renderBlocks(card.blocks, c),
}));

export { esc } from "./render";
