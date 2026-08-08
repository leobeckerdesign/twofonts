import type { Assignment } from "./roles";
import type { Block, Cell, Role, TextStyle } from "./spec";

/**
 * Transforma um card da gramática em HTML.
 *
 * Substitui as 18 funções escritas à mão que existiam em layouts.ts. O CSS não
 * mudou: cada bloco sai com as mesmas classes que as regras de styles.css já
 * esperavam, e o teste de paridade em render.test.ts prova elemento por
 * elemento que a troca não mexeu em nada.
 */

export interface RenderContext extends Assignment {
  fsBody: number;
  fsTitle: number;
  contrastPct: number;
}

const FOX = "The quick brown fox who jumped over a lazy dog.";
/** Exportado porque o editor lateral abre com o MESMO parágrafo dos cards. */
export const PARA =
  "Uma tem a voz, a outra tem o argumento. O pareamento funciona quando as duas compartilham esqueleto e discordam no gesto — proporção parecida, temperamento oposto.";

/** Nomes de família vêm do catálogo do Google e acabam em innerHTML. */
export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Só o que vem de token é escapado. Texto literal do card é confiável e passa
 * cru, senão um `<br/>` viraria texto visível.
 */
function expand(text: string, c: RenderContext): string {
  return text.replace(/\{\{(\w+)(?::(\d+))?\}\}/g, (whole, key: string, n?: string) => {
    switch (key) {
      case "titleFont": return esc(c.title.f);
      case "bodyFont": return esc(c.body.f);
      case "contrast": return String(c.contrastPct);
      case "sizeTitle": return c.fsTitle.toFixed(0);
      case "sizeBody": return c.fsBody.toFixed(0);
      case "fox": return FOX;
      case "para": return n === undefined ? PARA : `${PARA.slice(0, Number(n))}…`;
      // Token desconhecido fica visível de propósito: sumir calado esconde o erro.
      default: return whole;
    }
  });
}

const sizeOf = (c: RenderContext, role: Role, scale = 1): number =>
  (role === "title" ? c.fsTitle : c.fsBody) * scale;

/**
 * Ordem canônica das declarações. Ela não afeta o resultado renderizado, mas
 * mantém o HTML estável entre importações, o que deixa o diff legível.
 */
function inline(s: TextStyle, size: number | null): string {
  const out: string[] = [];
  if (size !== null) out.push(`font-size:${size.toFixed(1)}px`);
  // Com as duas margens, a abreviada zera as laterais junto, que é o que o
  // reset do CSS já faz. Separadas, não zeraria, e o efeito seria outro.
  if (s.mt !== undefined && s.mb !== undefined) out.push(`margin:${s.mt}px 0 ${s.mb}px`);
  else if (s.mt !== undefined) out.push(`margin-top:${s.mt}px`);
  else if (s.mb !== undefined) out.push(`margin-bottom:${s.mb}px`);
  if (s.lh !== undefined) out.push(`line-height:${s.lh}`);
  if (s.tracking !== undefined) out.push(`letter-spacing:${s.tracking}em`);
  if (s.caps) out.push("text-transform:uppercase");
  if (s.opacity !== undefined) out.push(`opacity:${s.opacity}`);
  return out.join(";");
}

const attr = (name: string, value: string): string => (value === "" ? "" : ` ${name}="${value}"`);

/**
 * URL para dentro de `url('…')` num atributo `style`.
 *
 * O atributo já é delimitado por aspas DUPLAS, então aspas duplas aqui fechariam
 * o `style` no meio do caminho e o resto do valor viraria atributo solto — o
 * fundo some sem um erro sequer. Daí aspas simples no CSS, e as três coisas que
 * ainda poderiam escapar da função (aspa simples e os parênteses do `url`) vão
 * percent-encodadas. `esc` cuida do que é HTML.
 */
const cssUrl = (src: string): string =>
  esc(src).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");

const classOf = (base: string, mod: string | null, num?: boolean): string =>
  `${base}${mod === null ? "" : ` ${mod}`}${num === true ? " num" : ""}`;

function leaf(b: Block, c: RenderContext, base: string, mod: string | null, role: Role): string {
  const style = inline(b, sizeOf(c, role, b.scale));
  return `<div class="${classOf(base, mod, b.num)}"${attr("style", style)}>${expand(b.text ?? "", c)}</div>`;
}

/** Sem `role`, o lado da linha sai como span pelado, sem classe nem corpo. */
function cell(x: Cell, c: RenderContext): string {
  const text = expand(x.text, c);
  if (x.role === undefined) {
    return `<span${attr("class", x.num === true ? "num" : "")}>${text}</span>`;
  }
  const cls = classOf(x.role === "title" ? "t" : "p", null, x.num);
  return `<span class="${cls}"${attr("style", inline(x, sizeOf(c, x.role, x.scale)))}>${text}</span>`;
}

/** A caixa reserva o espaço e declara o que o motor de mídia deve desenhar. */
function box(b: Block, c: RenderContext): string {
  const style: string[] = [];
  const cls = ["box", `box--${b.type}`];

  if (b.flow === "absolute") {
    cls.push("box--abs");
    const [top, right, bottom, left] = b.inset ?? [0, 0, 0, 0];
    style.push(`top:${top}px`, `right:${right}px`, `bottom:${bottom}px`, `left:${left}px`);
  } else if (b.h !== undefined) {
    style.push(`height:${b.h}px`);
  } else if (b.ratio !== undefined) {
    style.push(`aspect-ratio:${b.ratio}`);
  }

  if (b.bleed === true) cls.push("box--bleed");
  if (b.mt !== undefined) style.push(`margin-top:${b.mt}px`);
  if (b.mb !== undefined) style.push(`margin-bottom:${b.mb}px`);
  if (b.blend !== undefined) style.push(`mix-blend-mode:${b.blend}`);
  if (b.opacity !== undefined) style.push(`opacity:${b.opacity}`);

  // Asset real: a caixa vira imagem e sai SEM canvas, que é exatamente como o
  // motor de shader sabe que não é com ele — `scan` pula toda `.box` sem canvas.
  if (b.src !== undefined) {
    cls.push("box--asset");
    style.push(`background-image:url('${cssUrl(b.src)}')`);
    if (b.pos !== undefined) style.push(`background-position:${esc(b.pos)}`);
    return `<div class="${cls.join(" ")}"${attr("style", style.join(";"))}></div>`;
  }

  const data = [
    attr("data-family", b.family ?? "flow"),
    attr("data-motion", b.motion ?? (b.type === "image" ? "still" : "loop")),
    attr("data-seed", b.seed === undefined || b.seed === "auto" ? "auto" : String(b.seed)),
    attr("data-params", b.params === undefined ? "" : JSON.stringify(b.params)),
  ].join("");

  // O canvas fica vazio até o motor registrar a caixa; o fundo do CSS segura a
  // composição enquanto isso, e continua segurando se o WebGL falhar.
  return `<div class="${cls.join(" ")}"${attr("style", style.join(";"))}${data}><canvas></canvas></div>`;
}

export function renderBlock(b: Block, c: RenderContext): string {
  switch (b.type) {
    case "label":
      return `<div class="tag">${expand(b.text ?? "", c)}</div>`;
    case "rule":
      return `<div class="rule"></div>`;
    case "title":
      return leaf(b, c, "t", null, "title");
    case "body":
      return leaf(b, c, "p", null, "body");
    case "eyebrow":
      return leaf(b, c, "p", "eyebrow", "body");
    case "button":
      return leaf(b, c, "p", "btn", "body");
    case "stamp":
      return leaf(b, c, "p", "stamp", "body");
    case "columns":
      return leaf(b, c, "p", "cols", "body");

    case "stack":
      return `<div class="wf">${renderBlocks(b.children ?? [], c)}</div>`;

    case "group":
      return `<div style="display:flex;gap:${b.gap ?? 10}px">${renderBlocks(b.children ?? [], c)}</div>`;

    case "split":
      return `<div class="split">${(b.cols ?? [])
        .map((col) => `<div>${renderBlocks(col, c)}</div>`)
        .join("")}</div>`;

    case "meta":
      return `<div class="meta">${(b.entries ?? [])
        .map((e) => {
          const role = e.value.role ?? "body";
          const cls = classOf(role === "title" ? "t" : "p", null, e.value.num);
          const style = inline(e.value, sizeOf(c, role, e.value.scale));
          return `<div><small>${expand(e.caption, c)}</small><b class="${cls}"${attr("style", style)}>${expand(e.value.text, c)}</b></div>`;
        })
        .join("")}</div>`;

    case "rows": {
      const cls = classOf("rows", b.role === "body" ? "p" : null);
      const size = b.role === undefined ? null : sizeOf(c, b.role, b.scale);
      const rows = (b.items ?? [])
        .map((r) => `<div class="row">${cell(r.left, c)}${cell(r.right, c)}</div>`)
        .join("");
      return `<div class="${cls}"${attr("style", inline(b, size))}>${rows}</div>`;
    }

    case "image":
    case "video":
    case "shader":
      return box(b, c);
  }
}

export const renderBlocks = (blocks: Block[], c: RenderContext): string =>
  blocks.map((b) => renderBlock(b, c)).join("");
