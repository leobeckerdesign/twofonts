import { describe, expect, it } from "vitest";
import { CARDS, FROZEN } from "./layouts";
import { FAMILIES } from "./media/families";
import { renderBlocks, type RenderContext } from "./render";
import type { Block, BlockType, CardKind } from "./spec";
import type { FontMeta } from "./types";

/**
 * Guarda do spec VIVO, o que `layouts.json` tem agora.
 *
 * O portão de paridade em render.test.ts prova a tradução das 18 funções
 * originais e compara contra o baseline congelado — de propósito, para a prova
 * não se apagar quando o spec mudar. Só que é justamente por isso que ele não
 * olha para o arquivo que o Figma reescreve a cada rodada.
 *
 * Este arquivo olha. Ele não julga composição, que é do Leo; ele checa o que a
 * importação consegue errar calada: id repetido depois de duplicar um frame,
 * token que não existe mais, e sobretudo família de shader com nome torto, que
 * `familyById` engole devolvendo a primeira da lista em vez de reclamar.
 */

const font = (f: string, c: string): FontMeta => ({ f, c, w: { light: 300, regular: 400, bold: 700 } });

/** O par congelado no Figma, para o spec ser lido no contexto em que foi desenhado. */
const CONTEXT: RenderContext = {
  title: font(FROZEN.a, "Sans Serif"),
  body: font(FROZEN.b, "Serif"),
  titleWeight: 700,
  bodyWeight: 400,
  swapped: false,
  fsBody: 15,
  fsTitle: 15 * FROZEN.ratio * 2.2,
  contrastPct: Math.round(FROZEN.contrast * 100),
};

const BLOCK_TYPES = new Set<BlockType>([
  "label", "title", "body", "eyebrow", "button", "stamp",
  "rule", "columns",
  "rows", "meta", "split", "stack", "group",
  "image", "video", "shader",
]);

const KINDS = new Set<CardKind>(["paper", "ink", "accent"]);
const BOXES = new Set<BlockType>(["image", "video", "shader"]);
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));

/** Blocos aninhados contam: contêiner errado esconde o filho errado. */
function everyBlock(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [
    b,
    ...everyBlock(b.children ?? []),
    ...(b.cols ?? []).flat(),
  ]);
}

describe("spec vivo dos cards", () => {
  it("tem pelo menos um card e nenhum id repetido", () => {
    expect(CARDS.length).toBeGreaterThan(0);
    const ids = CARDS.map((c) => c.id);
    expect(new Set(ids).size, `ids repetidos em ${ids.join(", ")}`).toBe(ids.length);
  });

  it("usa só kind, tipo de bloco e largura que o sistema conhece", () => {
    for (const card of CARDS) {
      expect(KINDS.has(card.kind), `${card.id}: kind "${card.kind}"`).toBe(true);
      expect(card.w, `${card.id}: largura`).toBeGreaterThan(0);
      expect(card.bodyScale, `${card.id}: bodyScale`).toBeGreaterThan(0);
      expect(card.titleScale, `${card.id}: titleScale`).toBeGreaterThan(0);

      for (const b of everyBlock(card.blocks)) {
        expect(BLOCK_TYPES.has(b.type), `${card.id}: tipo de bloco "${b.type}"`).toBe(true);
      }
    }
  });

  /**
   * O motivo de este teste existir: `familyById` devolve FAMILIES[0] para id
   * desconhecido. Um nome torto vindo do Figma renderizaria "aurora" em todo
   * lugar sem um erro sequer. Caixa com `src` não passa por aqui: ela é imagem,
   * sai sem canvas, e o motor de shader nem a enxerga.
   */
  it("aponta cada caixa sem asset para uma família de shader que existe", () => {
    for (const card of CARDS) {
      for (const b of everyBlock(card.blocks)) {
        if (!BOXES.has(b.type) || b.src !== undefined) continue;
        expect(
          FAMILY_IDS.has(b.family ?? "flow"),
          `${card.id}: família "${b.family}" não está em ${[...FAMILY_IDS].join(", ")}`,
        ).toBe(true);
      }
    }
  });

  /**
   * Caminho torto de asset falha CALADO: o card renderiza sem fundo nenhum e
   * nada no console reclama. Por isso o arquivo é conferido de verdade.
   *
   * O glob do Vite dá a lista sem carregar byte nenhum (sem `eager`, o valor é
   * uma função que ninguém chama) e sem custar um `@types/node` ao projeto.
   */
  it("aponta cada asset para um arquivo que existe em public/", () => {
    const onDisk = new Set(
      Object.keys(import.meta.glob("../public/**/*.{jpg,jpeg,png,webp,avif,svg}")).map((p) =>
        p.replace("../public", ""),
      ),
    );
    expect(onDisk.size, "nenhum asset encontrado em public/ — o glob mudou de forma?").toBeGreaterThan(0);

    for (const card of CARDS) {
      for (const b of everyBlock(card.blocks)) {
        if (b.src === undefined) continue;
        expect(
          onDisk.has(b.src),
          `${card.id}: asset ausente em public${b.src} — há ${[...onDisk].join(", ")}`,
        ).toBe(true);
      }
    }
  });

  it("dá altura, proporção ou âncoras para cada caixa, senão ela sai com zero pixel", () => {
    for (const card of CARDS) {
      for (const b of everyBlock(card.blocks)) {
        if (!BOXES.has(b.type)) continue;
        const measured = b.flow === "absolute" ? b.inset !== undefined : b.h !== undefined || b.ratio !== undefined;
        expect(measured, `${card.id}: caixa ${b.type} sem altura, proporção ou inset`).toBe(true);
      }
    }
  });

  /**
   * O asset existir no disco não bastava: a primeira versão escrevia
   * `url("…")` com aspas DUPLAS dentro de um `style` que já é delimitado por
   * aspas duplas, então o atributo terminava em `url(` e o fundo sumia — com o
   * arquivo lá, servido em 200, e todo teste verde.
   *
   * `[^"]*` é o ponto do teste: ele para na primeira aspa dupla, exatamente
   * como o parser do navegador. Se o atributo quebrar, o src não aparece.
   */
  it("entrega o asset dentro de um style que o navegador consegue ler inteiro", () => {
    for (const card of CARDS) {
      const srcs = everyBlock(card.blocks)
        .map((b) => b.src)
        .filter((s): s is string => s !== undefined);
      if (srcs.length === 0) continue;

      const html = renderBlocks(card.blocks, CONTEXT);
      const styles = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);

      for (const src of srcs) {
        expect(
          styles.some((s) => s.includes(src)),
          `${card.id}: "${src}" não sobreviveu inteiro dentro de um style — atributo quebrado?`,
        ).toBe(true);
      }
    }
  });

  it("renderiza todo card sem deixar token por resolver", () => {
    for (const card of CARDS) {
      const html = renderBlocks(card.blocks, CONTEXT);
      expect(html.length, `${card.id}: HTML vazio`).toBeGreaterThan(0);
      // `expand` deixa token desconhecido visível de propósito; aqui isso é falha.
      expect(html, `${card.id}: token não resolvido`).not.toMatch(/\{\{[^}]*\}\}/);
    }
  });
});
