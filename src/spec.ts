/**
 * Gramática dos cards.
 *
 * O card deixou de ser uma função que escreve HTML e virou dado: uma lista de
 * blocos tipados. Isso existe para o card poder ir ao Figma como frames
 * nomeados, voltar editado, e virar HTML de novo sem ninguém reescrever código.
 *
 * Regra que governa o desenho: o Figma é dono da caixa, o código é dono do
 * conteúdo. Tudo aqui que é geometria ou estilo tem equivalente direto numa
 * propriedade de nó do Figma. O que não tem (qual par está ativo, que pixels o
 * shader gera) não mora aqui.
 */

export type Role = "title" | "body";

export type BlockType =
  // folhas de texto
  | "label" | "title" | "body" | "eyebrow" | "button" | "stamp"
  // divisor e modificador de layout
  | "rule" | "columns"
  // contêineres
  | "rows" | "meta" | "split" | "stack" | "group"
  // caixas de mídia
  | "image" | "video" | "shader";

/**
 * Estilo que sobrevive à ida e à volta do Figma. Cada campo tem um par exato
 * do outro lado: `mt`/`mb` são paddings do frame do bloco, `tracking` é
 * letterSpacing, `caps` é textCase, `opacity` é a opacidade do preenchimento.
 */
export interface TextStyle {
  /** multiplicador sobre o corpo base do papel do bloco */
  scale?: number;
  /** margens em px; só gravadas quando divergem do que o CSS já dá */
  mt?: number;
  mb?: number;
  /** entreletra em em */
  tracking?: number;
  caps?: boolean;
  opacity?: number;
  /** entrelinha, quando difere da regra do CSS */
  lh?: number;
  /** algarismos tabulares */
  num?: boolean;
}

/** Um lado de uma linha de `rows`. Sem `role`, sai como span pelado. */
export interface Cell extends TextStyle {
  text: string;
  role?: Role;
}

export interface RowItem {
  left: Cell;
  right: Cell;
}

export interface MetaEntry {
  caption: string;
  value: Cell;
}

/** Como a caixa entra no card: na pilha, ou fora do fluxo como fundo. */
export type BoxFlow = "stack" | "absolute";

export type BoxMotion = "still" | "loop";

export interface Block extends TextStyle {
  type: BlockType;
  /** literal ou com tokens; ver `TOKENS` em render.ts */
  text?: string;
  /** papel tipográfico, quando o tipo do bloco não o determina sozinho */
  role?: Role;

  // contêineres
  /** espaço entre filhos de `group`, em px */
  gap?: number;
  items?: RowItem[];
  entries?: MetaEntry[];
  cols?: Block[][];
  children?: Block[];

  // caixas de mídia
  /**
   * Asset real, exportado do Figma. Quando existe, ele MANDA: a caixa sai como
   * imagem e o motor de shader nem a enxerga, porque só registra caixa que tem
   * `<canvas>` dentro. `family` continua valendo para caixa sem `src`.
   *
   * Isso inverte a decisão original de "placeholder gerado, nada de asset". O
   * Leo pediu os cards exatamente como estão no Figma, e no Figma há foto.
   */
  src?: string;
  /** `background-position`, para reproduzir o recorte que o Figma guarda em matriz */
  pos?: string;
  /**
   * Contrato completo desde já, mesmo com o motor de shader chegando depois.
   * O objetivo é a fase do motor escrever GL sem renegociar formato de dado.
   */
  family?: string;
  flow?: BoxFlow;
  /** proporção largura/altura da banda */
  ratio?: number;
  /** altura fixa em px, alternativa a `ratio` */
  h?: number;
  /** ignora a margem lateral do card e sangra até a borda */
  bleed?: boolean;
  motion?: BoxMotion;
  /** modo de composição contra o card */
  blend?: string;
  /** âncoras topo, direita, base, esquerda, quando `flow` é absoluto */
  inset?: [number, number, number, number];
  /** sobrescritas nomeadas das faixas da família */
  params?: Record<string, number>;
  /** `auto` deriva de card mais par; número fixa o resultado */
  seed?: number | "auto";
}

export type CardKind = "paper" | "ink" | "accent";

export interface CardSpec {
  id: string;
  kind: CardKind;
  /** largura de projeto em px; o campo escala isso conforme o viewport */
  w: number;
  /** multiplicador do corpo de texto deste card */
  bodyScale: number;
  /** multiplicador do título, aplicado sobre a razão de contraste */
  titleScale: number;
  blocks: Block[];
}

export interface LayoutsFile {
  version: number;
  /**
   * Par e contraste congelados no arquivo do Figma. A importação precisa deles
   * para inverter os tamanhos medidos de volta em `bodyScale` e `titleScale`.
   */
  frozen: {
    a: string;
    b: string;
    contrast: number;
    ratio: number;
  };
  cards: CardSpec[];
}
