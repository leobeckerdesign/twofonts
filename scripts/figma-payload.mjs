/**
 * Resolve os cards para o Figma.
 *
 * O Figma congela UM par, então tudo que no app é dinâmico (qual fonte assume
 * qual papel, que corpo cada bloco recebe, quanto vale cada margem) precisa
 * virar número aqui. O que sai é o payload que o construtor escreve como frames.
 *
 * As margens seguem o CSS de styles.css, e cada bloco carrega AS DUAS, porque
 * `.card` é flex e em flex margem não colapsa.
 */
import { readFileSync, writeFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(new URL("../src/layouts.json", import.meta.url), "utf8"));

const BASE_BODY = 15;
const TITLE_BASE = 2.2;
const { a, b, ratio } = spec.frozen;
const CONTRAST_PCT = Math.round(spec.frozen.contrast * 100);

const FOX = "The quick brown fox who jumped over a lazy dog.";
const PARA =
  "Uma tem a voz, a outra tem o argumento. O pareamento funciona quando as duas compartilham esqueleto e discordam no gesto — proporção parecida, temperamento oposto.";

/** Margens que o CSS já dá. Só entram no Figma como padding do bloco. */
const CSS_MARGIN = {
  label: { mt: 0, mb: 14 },
  title: { mt: 0, mb: 0 },
  body: { mt: 14, mb: 0 },
  columns: { mt: 14, mb: 0 },
  eyebrow: { mt: 0, mb: 0 },
  button: { mt: 15, mb: 0 },
  stamp: { mt: 14, mb: 0 },
  rule: { mt: 15, mb: 15 },
  rows: { mt: 0, mb: 0 },
  meta: { mt: 0, mb: 0 },
  split: { mt: 0, mb: 0 },
  stack: { mt: 0, mb: 0 },
  group: { mt: 15, mb: 0 },
  image: { mt: 14, mb: 0 },
  video: { mt: 14, mb: 0 },
  shader: { mt: 14, mb: 0 },
};

function expand(text, ctx) {
  return String(text).replace(/\{\{(\w+)(?::(\d+))?\}\}/g, (whole, key, n) => {
    switch (key) {
      case "titleFont": return ctx.title;
      case "bodyFont": return ctx.body;
      case "contrast": return String(CONTRAST_PCT);
      case "sizeTitle": return ctx.fsTitle.toFixed(0);
      case "sizeBody": return ctx.fsBody.toFixed(0);
      case "fox": return FOX;
      case "para": return n === undefined ? PARA : `${PARA.slice(0, Number(n))}…`;
      default: return whole;
    }
  }).replace(/<br\s*\/?>/g, "\n");
}

/** Divide num limite de palavra perto da metade, para as duas colunas. */
function halves(text) {
  const at = text.indexOf(" ", Math.floor(text.length / 2));
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + 1)];
}

const leaf = (block, ctx, role, prev, inStack) => {
  const base = CSS_MARGIN[block.type] ?? { mt: 0, mb: 0 };
  // `.t + .t` vale 12, e 4 dentro de `stack`.
  const sibling = block.type === "title" && prev === "title" ? (inStack ? 4 : 12) : base.mt;
  return {
    size: (role === "title" ? ctx.fsTitle : ctx.fsBody) * (block.scale ?? 1),
    family: role === "title" ? ctx.title : ctx.body,
    style: role === "title" ? "Bold" : "Regular",
    lh: block.lh ?? (role === "title" ? 1.02 : 1.55),
    tracking: block.tracking ?? (role === "title" ? -0.02 : 0),
    caps: block.caps === true,
    opacity: block.opacity ?? (role === "title" ? 1 : 0.84),
    mt: block.mt ?? sibling,
    mb: block.mb ?? base.mb,
  };
};

function convert(block, ctx, prev, inStack) {
  const t = block.type;
  const base = CSS_MARGIN[t] ?? { mt: 0, mb: 0 };
  const mt = block.mt ?? base.mt;
  const mb = block.mb ?? base.mb;

  if (t === "label") {
    return { kind: "text", name: "label", text: expand(block.text, ctx), mono: true,
      size: 9, tracking: 0.18, caps: true, opacity: 0.5, lh: 1.4, mt, mb };
  }
  if (t === "rule") return { kind: "rule", name: "rule", mt, mb };

  if (t === "image" || t === "video" || t === "shader") {
    return { kind: "box", name: `media/${t}`, media: t,
      ratio: block.ratio ?? null, h: block.h ?? null,
      bleed: block.bleed === true, absolute: block.flow === "absolute",
      inset: block.inset ?? null, mt, mb };
  }

  if (t === "title" || t === "body" || t === "eyebrow" || t === "button" || t === "stamp") {
    const role = t === "title" ? "title" : "body";
    const s = leaf(block, ctx, role, prev, inStack);
    return { kind: "text", name: t, text: expand(block.text, ctx), ...s,
      boxed: t === "button" || t === "stamp",
      pad: t === "button" ? [10, 20] : t === "stamp" ? [5, 10] : null,
      tracking: t === "stamp" ? 0.18 : t === "eyebrow" ? 0.22 : s.tracking,
      caps: t === "stamp" || t === "eyebrow" ? true : s.caps,
      opacity: t === "eyebrow" ? 0.55 : t === "button" ? 1 : s.opacity };
  }

  if (t === "columns") {
    const s = leaf(block, ctx, "body", prev, inStack);
    const [l, r] = halves(expand(block.text, ctx));
    return { kind: "columns", name: "columns", left: l, right: r, ...s };
  }

  if (t === "stack") {
    let last = null;
    const children = (block.children ?? []).map((c) => {
      const out = convert(c, ctx, last, true);
      last = c.type;
      return out;
    });
    return { kind: "stack", name: "stack", children, mt, mb };
  }

  if (t === "group") {
    let last = null;
    const children = (block.children ?? []).map((c) => {
      const out = convert(c, ctx, last, false);
      last = c.type;
      return out;
    });
    // No grupo horizontal os filhos não repetem a margem de cima.
    for (const c of children) c.mt = 0;
    return { kind: "group", name: "group", gap: block.gap ?? 10, children, mt, mb };
  }

  if (t === "split") {
    const cols = (block.cols ?? []).map((col) => {
      let last = null;
      return col.map((c) => {
        const out = convert(c, ctx, last, false);
        last = c.type;
        return out;
      });
    });
    return { kind: "split", name: "split", gap: 20, cols, mt, mb };
  }

  if (t === "rows") {
    const size = block.role === undefined ? null : ctx.fsBody * (block.scale ?? 1);
    const cell = (c) => ({
      text: expand(c.text, ctx),
      size: c.role === undefined ? (size ?? ctx.fsBody) : (c.role === "title" ? ctx.fsTitle : ctx.fsBody) * (c.scale ?? 1),
      family: c.role === "title" ? ctx.title : ctx.body,
      style: c.role === "title" ? "Bold" : "Regular",
    });
    return { kind: "rows", name: "rows",
      items: (block.items ?? []).map((r) => ({ left: cell(r.left), right: cell(r.right) })),
      opacity: 0.84, mt, mb };
  }

  if (t === "meta") {
    return { kind: "meta", name: "meta",
      entries: (block.entries ?? []).map((e) => ({
        caption: expand(e.caption, ctx),
        text: expand(e.value.text, ctx),
        size: (e.value.role === "title" ? ctx.fsTitle : ctx.fsBody) * (e.value.scale ?? 1),
        family: e.value.role === "title" ? ctx.title : ctx.body,
        style: e.value.role === "title" ? "Bold" : "Regular",
      })), mt, mb };
  }

  return { kind: "unknown", name: t, mt, mb };
}

const cards = spec.cards.map((card, index) => {
  // Par simétrico: os papéis alternam por índice, exatamente como no campo.
  const swapped = index % 2 === 1;
  const fsBody = BASE_BODY * card.bodyScale;
  const ctx = {
    title: swapped ? b : a,
    body: swapped ? a : b,
    fsBody,
    fsTitle: fsBody * ratio * card.titleScale * TITLE_BASE,
  };

  let last = null;
  const blocks = card.blocks.map((blk) => {
    const out = convert(blk, ctx, last, false);
    last = blk.type;
    return out;
  });

  return { id: card.id, kind: card.kind, w: card.w, index,
    title: ctx.title, body: ctx.body,
    fsBody: +ctx.fsBody.toFixed(2), fsTitle: +ctx.fsTitle.toFixed(2), blocks };
});

const out = { frozen: spec.frozen, contrastPct: CONTRAST_PCT, cards };
const path = new URL("../../figma-payload.json", import.meta.url);
writeFileSync(process.argv[2] ?? path, JSON.stringify(out));
console.log(`${cards.length} cards, ${JSON.stringify(out).length} bytes`);
console.log(cards.map((c) => `  ${c.id.padEnd(12)} ${c.kind.padEnd(7)} ${String(c.w).padEnd(4)} ${c.title} / ${c.body}`).join("\n"));
