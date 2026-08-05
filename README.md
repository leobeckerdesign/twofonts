# twofonts

Releitura experimental do [fontjoy](https://fontjoy.com): um mapa navegável do espaço
latente de 1.807 fontes do Google Fonts.

## Rodar

```bash
npm install
npm run dev
```

## Testar e gerar o build

```bash
npm run check
```

## Arquitetura de performance

O custo pesado é pago antes da entrada no mapa:

- `BootController` coordena catálogo, decode do atlas, cena, par inicial e warmup;
- Canvas 2D desenha as 1.807 posições e até 96 previews raster;
- o DOM fica limitado a 24 labels ou 16 cards interativos;
- pan e zoom não carregam webfonts;
- somente o par atual e dois pares preparados usam fontes reais, com LRU de
  6 famílias / 8 faces e no máximo 2 downloads concorrentes;
- o shader roda a 30 fps, com resolução limitada, e pausa em aba oculta.

Os previews reais vêm de `public/font-atlas.webp`. Em telas pequenas o app usa
`public/font-atlas-compact.webp`, que reduz a memória decodificada de cerca de
38 MiB para 16 MiB. A decisão completa está em
[`docs/performance-architecture.md`](docs/performance-architecture.md).

## Regenerar o dataset

O `public/fonts-map.json` é gerado pelo pipeline em `pipeline/` (Python + GPU):

```bash
python -m venv .venv
.venv/Scripts/pip install -r pipeline/requirements.txt
cd pipeline
python fetch_catalog.py
python render_glyphs.py
python extract_features.py
python build_map.py
cd ..
.venv/Scripts/python pipeline/build_preview_atlas.py
.venv/Scripts/python pipeline/build_ui_font.py
```

Catálogo do Google Fonts → grade de glifos 224×224 → DINOv2 → PCA 200d → UMAP 2D.
Nunca misture vetores de extractors diferentes: a atualização exige uma regeneração completa.

## Créditos

Método de embeddings e métrica de pairing derivados de
[Jack000/fontjoy](https://github.com/Jack000/fontjoy) (MIT).
