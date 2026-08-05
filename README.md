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
npm test
npm run build
```

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
```

Catálogo do Google Fonts → grade de glifos 224×224 → DINOv2 → PCA 200d → UMAP 2D.
Nunca misture vetores de extractors diferentes: a atualização exige uma regeneração completa.

## Créditos

Método de embeddings e métrica de pairing derivados de
[Jack000/fontjoy](https://github.com/Jack000/fontjoy) (MIT).
