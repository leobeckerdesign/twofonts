// Injeta dados e fontes no template e emite a pagina final, num arquivo so.
//
//     node docs/case/build.mjs
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const readHere = (...p) => readFileSync(join(HERE, ...p), "utf8");

const space = JSON.parse(readHere("data", "space.json"));
const assets = JSON.parse(readHere("data", "assets.json"));

const pairsPath = join(ROOT, "public", "pairs.json");
const pairs = JSON.parse(readFileSync(pairsPath, "utf8"));

// Pares reais por faixa, so os nomes: e o que o demonstrador da metrica lista.
const buckets = pairs.buckets.map((b) => ({
  c: b.c,
  roles: b.roles,
  n: b.pairs.length,
  sample: b.pairs.slice(0, 40).map(([i, j]) => [pairs.fonts[i].f, pairs.fonts[j].f]),
}));

const data = {
  space,
  buckets,
  glyphs: assets.glyphs,
  anchors: assets.anchors,
  showcase: assets.showcase,
  stats: {
    // total de familias que fetch_catalog.py baixou do Google Fonts
    catalog: 1817,
    eligible: pairs.fonts.length,
    plotted: space.length,
    bands: pairs.buckets.length,
    perBand: pairs.buckets[0].pairs.length,
    payloadKb: Math.round(statSync(pairsPath).size / 1024),
  },
};

// Sai em `public/` porque a página não é só um arquivo para abrir com duplo
// clique: o site a serve dentro de um modal, e só o que está em `public/` chega
// ao `dist/`. Continua funcionando offline — ela é autocontida.
const out = join(ROOT, "public", "espaco-tipografico.html");

writeFileSync(
  out,
  readHere("page.html")
    .replace("/*__GEIST_300__*/", assets.fonts["Geist-300"])
    .replace("/*__GEIST_400__*/", assets.fonts["Geist-400"])
    .replace("/*__GEIST_500__*/", assets.fonts["Geist-500"])
    .replace("/*__GEIST_700__*/", assets.fonts["Geist-700"])
    .replace("__DATA__", JSON.stringify(data)),
);

console.log(`-> public/espaco-tipografico.html (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`${space.length} pontos, ${Object.keys(assets.glyphs).length} glifos, ${buckets.length} faixas`);
