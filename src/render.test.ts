import { describe, expect, it } from "vitest";
import baseline from "./layouts.baseline.json";
import { LEGACY_LAYOUTS } from "./layouts.legacy";
import { renderBlocks, type RenderContext } from "./render";
import type { LayoutsFile } from "./spec";
import type { FontMeta } from "./types";

/**
 * Portão da troca das 18 funções por dado.
 *
 * O portão NÃO é igualdade byte a byte, e isso é de propósito: os templates
 * antigos carregam quebra de linha e indentação do código-fonte entre as divs,
 * e escrevem `margin:0 0 8px` onde a gramática escreve as margens por nome. São
 * a mesma coisa depois de renderizadas.
 *
 * O portão é equivalência estrutural: mesmos elementos, mesmas classes, mesmo
 * texto, e mesmas propriedades CSS efetivas. O `style` é comparado como mapa de
 * propriedades, nunca como string, então ordem e abreviação não contam.
 *
 * Compara contra `layouts.baseline.json`, que é a tradução congelada dos 18
 * cards originais, e não contra o `layouts.json` vivo. A prova é da TRADUÇÃO:
 * uma vez feita, o spec pode ganhar mídia e mudar de composição sem que isso
 * apague a evidência de que a troca por dado não alterou nada.
 */

/** `.16em` e `0.16em` são o mesmo valor; `0px` e `0` também. */
function value(raw: string): string {
  const v = raw.trim().replace(/(^|[^\d.])\.(\d)/g, "$10.$2");
  return /^0(px|em|%)?$/.test(v) ? "0" : v;
}

function expandBox(parts: string[]): [string, string, string, string] {
  const [a, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}

/** Vira mapa ordenado, com a abreviada `margin` expandida nos quatro lados. */
function normalizeStyle(style: string): string {
  const decls = new Map<string, string>();

  for (const part of style.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const prop = part.slice(0, at).trim();
    const raw = part.slice(at + 1);

    if (prop === "margin") {
      const [top, right, bottom, left] = expandBox(raw.trim().split(/\s+/));
      decls.set("margin-top", value(top));
      decls.set("margin-right", value(right));
      decls.set("margin-bottom", value(bottom));
      decls.set("margin-left", value(left));
      continue;
    }
    decls.set(prop, value(raw));
  }

  return [...decls.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/** Espaço entre tags é formatação de código-fonte, não conteúdo. */
function normalize(html: string): string {
  return html
    .replace(/>\s+</g, "><")
    .replace(/style="([^"]*)"/g, (_, s: string) => `style="${normalizeStyle(s)}"`)
    .trim();
}

const font = (f: string, c: string): FontMeta => ({ f, c, w: { light: 300, regular: 400, bold: 700 } });

/**
 * Dois contextos: um comum e um adversarial. O segundo carrega caractere que
 * precisa de escape no nome da família, número quebrado e contraste no extremo,
 * porque é onde a tradução erraria calada.
 */
const CONTEXTS: { name: string; c: RenderContext }[] = [
  {
    name: "comum",
    c: {
      title: font("Barlow", "Sans Serif"),
      body: font("Bitter", "Serif"),
      titleWeight: 700,
      bodyWeight: 400,
      swapped: false,
      fsBody: 13.5,
      fsTitle: 76.6,
      contrastPct: 56,
    },
  },
  {
    name: "adversarial",
    c: {
      title: font('A & B <script> "x"', "Display"),
      body: font("Fonte & Cia", "Serif"),
      titleWeight: 300,
      bodyWeight: 700,
      swapped: true,
      fsBody: 11.37,
      fsTitle: 199.999,
      contrastPct: 100,
    },
  },
];

const BASE = (baseline as LayoutsFile).cards;
const render = (i: number, c: RenderContext): string => renderBlocks(BASE[i].blocks, c);

describe("gramática dos cards", () => {
  it("cobre os mesmos 18 cards, na mesma ordem", () => {
    expect(BASE.map((card) => card.id)).toEqual(LEGACY_LAYOUTS.map((l) => l.id));
  });

  it("preserva kind, largura e as escalas de cada card", () => {
    for (const [i, legacy] of LEGACY_LAYOUTS.entries()) {
      const { id, kind, w, bodyScale, titleScale } = BASE[i];
      expect({ id, kind, w, bodyScale, titleScale }).toEqual({
        id: legacy.id,
        kind: legacy.kind,
        w: legacy.w,
        bodyScale: legacy.bodyScale,
        titleScale: legacy.titleScale,
      });
    }
  });

  for (const { name, c } of CONTEXTS) {
    describe(`contexto ${name}`, () => {
      for (const [i, legacy] of LEGACY_LAYOUTS.entries()) {
        it(`card ${legacy.id} sai equivalente`, () => {
          expect(normalize(render(i, c))).toBe(normalize(legacy.html(c)));
        });
      }
    });
  }

  it("escapa nome de família e deixa markup literal passar", () => {
    const nome = render(0, CONTEXTS[1].c);
    expect(nome).toContain("A &amp; B &lt;script&gt; &quot;x&quot;");
    expect(nome).not.toContain("<script>");

    const citacao = BASE.findIndex((card) => card.id === "citacao");
    expect(render(citacao, CONTEXTS[0].c)).toContain("<br/>");
  });

  it("deixa token desconhecido visível em vez de sumir com ele", () => {
    const out = renderBlocks([{ type: "body", text: "x {{naoExiste}} y" }], CONTEXTS[0].c);
    expect(out).toContain("{{naoExiste}}");
  });
});
