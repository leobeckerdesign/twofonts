import type { Assignment } from "./roles";

export type CardKind = "paper" | "ink" | "accent";

export interface LayoutContext extends Assignment {
  /** corpo base do texto, em px — o título deriva daqui pela razão de contraste */
  body: Assignment["body"];
  fsBody: number;
  fsTitle: number;
  contrastPct: number;
}

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

const FOX = "The quick brown fox who jumped over a lazy dog.";
const PARA =
  "Uma tem a voz, a outra tem o argumento. O pareamento funciona quando as duas compartilham esqueleto e discordam no gesto — proporção parecida, temperamento oposto.";

/** px do título e do corpo, já com a razão de contraste aplicada. */
const t = (c: LayoutContext, mult = 1) => `font-size:${(c.fsTitle * mult).toFixed(1)}px`;
const p = (c: LayoutContext, mult = 1) => `font-size:${(c.fsBody * mult).toFixed(1)}px`;

/** Nomes de família vêm do catálogo do Google e acabam em innerHTML. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 18 composições do MESMO par. `.t` recebe a fonte de título, `.p` a de corpo —
 * quem é quem muda a cada card, então as duas famílias circulam pelos dois papéis.
 */
export const LAYOUTS: Layout[] = [
  { id: "nome", kind: "paper", w: 500, bodyScale: 1, titleScale: 1,
    html: (c) => `<div class="tag">${esc(c.title.f)} + ${esc(c.body.f)}</div>
      <div class="t" style="${t(c)}">${esc(c.title.f)}</div>
      <div class="t" style="${t(c, 0.42)}">${FOX}</div>
      <div class="p" style="${p(c)}">${PARA}</div>` },

  { id: "poster", kind: "ink", w: 390, bodyScale: 0.95, titleScale: 1.45,
    html: (c) => `<div class="tag">pôster</div>
      <div class="t" style="${t(c)}">Aa</div>
      <div class="t" style="${t(c, 0.26)}">${FOX}</div>` },

  { id: "editorial", kind: "paper", w: 460, bodyScale: 0.9, titleScale: 0.78,
    html: (c) => `<div class="tag">editorial</div>
      <div class="t" style="${t(c)}">Beleza é função</div><div class="rule"></div>
      <div class="p cols" style="${p(c)}">${PARA} ${PARA}</div>` },

  { id: "interface", kind: "paper", w: 380, bodyScale: 0.95, titleScale: 0.62,
    html: (c) => `<div class="p eyebrow" style="${p(c, 0.72)}">Interface</div>
      <div class="t" style="${t(c)};margin-top:9px">Assinatura visual</div>
      <div class="p" style="${p(c)}">${PARA.slice(0, 108)}…</div>
      <div class="p btn" style="${p(c, 0.95)}">continuar</div>` },

  { id: "escala", kind: "accent", w: 470, bodyScale: 0.86, titleScale: 0.8,
    html: (c) => `<div class="tag">escala</div><div class="wf">
      <div class="t" style="${t(c)}">Beleza é função</div>
      <div class="t" style="${t(c, 0.66)}">Beleza é função</div>
      <div class="t" style="${t(c, 0.44)}">Beleza é função</div></div>
      <div class="p" style="${p(c)};margin-top:12px">${PARA.slice(0, 88)}…</div>` },

  { id: "ficha", kind: "ink", w: 330, bodyScale: 0.9, titleScale: 0.4,
    html: (c) => `<div class="tag">ficha</div><div class="meta">
      <div><small>título</small><b class="t" style="${t(c)}">${esc(c.title.f)}</b></div>
      <div><small>corpo</small><b class="p" style="${p(c, 1.1)}">${esc(c.body.f)}</b></div>
      <div><small>contraste</small><b class="p" style="${p(c, 1.1)}">${c.contrastPct}%</b></div>
      </div>` },

  { id: "citacao", kind: "paper", w: 430, bodyScale: 0.95, titleScale: 0.7,
    html: (c) => `<div class="tag">citação</div>
      <div class="t" style="${t(c)}">“Forma que<br/>conversa.”</div>
      <div class="p" style="${p(c)}">${PARA.slice(0, 124)}…</div>` },

  { id: "alfabeto", kind: "paper", w: 490, bodyScale: 0.92, titleScale: 0.5,
    html: (c) => `<div class="tag">alfabeto</div>
      <div class="t" style="${t(c)}">ABCDEFGHIJKLM<br/>NOPQRSTUVWXYZ</div>
      <div class="p" style="${p(c)};margin-top:12px">abcdefghijklmnopqrstuvwxyz 0123456789</div>` },

  { id: "numerais", kind: "ink", w: 410, bodyScale: 0.88, titleScale: 0.92,
    html: (c) => `<div class="tag">numerais</div>
      <div class="t num" style="${t(c)}">0123456789</div>
      <div class="rows p" style="${p(c)};margin-top:14px">
        <div class="row"><span>Corpo do texto</span><span class="num">${c.fsBody.toFixed(0)} px</span></div>
        <div class="row"><span>Título</span><span class="num">${c.fsTitle.toFixed(0)} px</span></div>
        <div class="row"><span>Contraste</span><span class="num">${c.contrastPct}%</span></div>
      </div>` },

  { id: "convite", kind: "accent", w: 360, bodyScale: 0.9, titleScale: 0.68,
    html: (c) => `<div class="tag">convite</div>
      <div class="t" style="${t(c)}">Noite de<br/>Tipografia</div>
      <div class="p" style="${p(c)};margin-top:12px">Quinta, 20h · Rua da Consolação, 1200</div>
      <div class="p stamp" style="${p(c, 0.72)}">entrada franca</div>` },

  { id: "indice", kind: "paper", w: 440, bodyScale: 0.95, titleScale: 0.44,
    html: (c) => `<div class="tag">índice</div>
      <div class="rows">
        ${["Anatomia:012", "Contraste:034", "Ritmo:058", "Hierarquia:081"].map((r) => {
          const [name, n] = r.split(":");
          return `<div class="row"><span class="t" style="${t(c)}">${name}</span>
            <span class="p num" style="${p(c)}">${n}</span></div>`;
        }).join("")}
      </div>` },

  { id: "capa", kind: "ink", w: 340, bodyScale: 0.88, titleScale: 0.7,
    html: (c) => `<div class="tag">capa</div>
      <div class="t" style="${t(c)}">O peso<br/>da forma</div>
      <div class="rule"></div>
      <div class="p" style="${p(c)}">Ensaios sobre tipografia aplicada</div>
      <div class="p" style="${p(c, 0.78)};margin-top:22px;letter-spacing:.16em;text-transform:uppercase">Edições Palco</div>` },

  { id: "manchete", kind: "paper", w: 480, bodyScale: 0.85, titleScale: 0.6,
    html: (c) => `<div class="tag">manchete</div>
      <div class="p eyebrow" style="${p(c, 0.8)}">Caderno de Design</div>
      <div class="t" style="${t(c)};margin-top:8px">A fonte certa não se nota</div>
      <div class="p cols" style="${p(c)}">${PARA}</div>` },

  { id: "verbete", kind: "paper", w: 390, bodyScale: 0.92, titleScale: 0.6,
    html: (c) => `<div class="tag">verbete</div>
      <div class="t" style="${t(c)}">pareamento</div>
      <div class="p" style="${p(c, 0.86)};margin-top:6px;opacity:.6">pa·re·a·men·to · substantivo</div>
      <div class="p" style="${p(c)}">Ato de combinar duas formas que se sustentam sem disputar a mesma atenção.</div>` },

  { id: "comparativo", kind: "accent", w: 450, bodyScale: 0.85, titleScale: 0.46,
    html: (c) => `<div class="tag">comparativo</div>
      <div class="split">
        <div><div class="p" style="${p(c, 0.68)};margin:0 0 8px;letter-spacing:.18em;text-transform:uppercase">${esc(c.title.f)}</div>
          <div class="t" style="${t(c)}">Hamburgefonstiv</div></div>
        <div><div class="p" style="${p(c, 0.68)};margin:0 0 8px;letter-spacing:.18em;text-transform:uppercase">${esc(c.body.f)}</div>
          <div class="p" style="${p(c, 1.5)};line-height:1.1;opacity:1">Hamburgefonstiv</div></div>
      </div>
      <div class="p" style="${p(c)};margin-top:14px">${PARA.slice(0, 84)}…</div>` },

  { id: "etiqueta", kind: "paper", w: 350, bodyScale: 0.85, titleScale: 0.6,
    html: (c) => `<div class="tag">etiqueta</div>
      <div class="t" style="${t(c)}">Café<br/>Torrado</div>
      <div class="rule"></div>
      <div class="p" style="${p(c)}">Origem única · Torra média · Moagem fina</div>
      <div class="p num" style="${p(c)};margin-top:6px">250 g ℮</div>` },

  { id: "hero", kind: "ink", w: 500, bodyScale: 0.95, titleScale: 0.82,
    html: (c) => `<div class="tag">hero</div>
      <div class="t" style="${t(c)}">Componha<br/>com intenção</div>
      <div class="p" style="${p(c)}">${PARA.slice(0, 96)}…</div>
      <div style="display:flex;gap:10px">
        <div class="p btn" style="${p(c, 0.95)}">começar</div>
        <div class="p btn" style="${p(c, 0.95)};opacity:.55">ver exemplos</div>
      </div>` },

  { id: "legenda", kind: "paper", w: 330, bodyScale: 0.8, titleScale: 0.42,
    html: (c) => `<div class="tag">legenda</div>
      <div class="t" style="${t(c)}">Detalhe da haste</div>
      <div class="p" style="${p(c)}">${PARA.slice(0, 150)}…</div>
      <div class="p" style="${p(c, 0.76)};margin-top:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.55">fig. ${"04"} — ${esc(c.title.f)} / ${esc(c.body.f)}</div>` },
];
