# twofonts — Design Spec

**Data:** 2026-08-05
**Status:** Aprovado por Leo (conceito: mapa latente navegável; escopo: experimento puro)
**Referência:** releitura estética/funcional do [fontjoy.com](https://fontjoy.com) ([Jack000/fontjoy](https://github.com/Jack000/fontjoy), MIT)

## Conceito

Experimento visual interativo de pareamento de fontes. Em vez do layout utilitário do fontjoy, a interface é um **mapa navegável do espaço latente das fontes**: cada família do Google Fonts é um card flutuante posicionado pela projeção 2D do seu embedding neural de 200 dimensões. Serifadas se agrupam, geométricas formam outra região, display extravagantes ficam na periferia. Gerar um pairing é uma coreografia de câmera entre dois pontos do mapa.

Desktop-first, apelo estético máximo, fluidez como requisito de primeira classe.

## Arquitetura

Site 100% estático. **Vite + TypeScript vanilla + GSAP** (Draggable, InertiaPlugin, Flip, quickTo — plugins premium gratuitos desde a aquisição pela Webflow). Sem framework de UI, sem backend.

Três camadas visuais:

| Camada | Conteúdo | Tech |
|---|---|---|
| 0 — Fundo | Shader sutil (gradiente animado + grain) | WebGL; fallback gradiente CSS |
| 1 — Mapa | Mundo pan/zoom com cards de fontes | DOM + GSAP transforms |
| 2 — UI fixa | Specimen ativo, slider de contraste, locks, gerar | DOM |

Texto sempre em DOM (nunca WebGL) — tipografia crisp, real e selecionável é o ponto do site.

## Pipeline de dados (build time)

**Implementado e executado em 2026-08-05** (`pipeline/`). Em vez de vendorizar o dataset de 2017 do fontjoy, regeneramos os embeddings do zero sobre o catálogo atual, replicando a metodologia original com encoder moderno:

1. `fetch_catalog.py` — catálogo completo via `fonts.google.com/metadata/fonts` (sem API key); só famílias com subset latin → **1.817 famílias**
2. `render_glyphs.py` — baixa o TTF regular de cada família e renderiza grade de glifos distintivos (`aeg` / `nRQ`) em 224×224, preto sobre branco (downloads paralelos, cache incremental) → **1.807 renderizadas** (10 sem glifos latinos, excluídas — fail closed)
3. `extract_features.py` — DINOv2 ViT-S/14 como extractor fixo, GPU (RTX 5090) → 384 dims/família
4. `build_map.py` — StandardScaler + PCA 200d + UMAP 2D normalizado → `public/fonts-map.json` (2,8 MB bruto; ~900 KB com gzip do servidor — otimização de quantização fica para depois se necessário)

Validação: vizinhos por cosseno fazem sentido tipográfico (Inter→Figtree/Google Sans; Bebas Neue→Staatliches; Caveat→Kalam); pureza de categoria @5 = 75%.

Runtime carrega esse único JSON; todo o resto é matemática local.

## O mapa (camada 1)

- ~800–1.000 famílias como entidades no mundo
- **LOD por zoom:** longe = ponto/nome minúsculo · médio = nome renderizado na própria fonte · perto = card specimen completo
- **Virtualização:** só o viewport vira DOM (requisito para 60fps)
- Drift orgânico por card (senoides dessincronizadas no GSAP ticker)
- Webfonts on-demand ao entrar no viewport, com subset via `text=` da Google Fonts API e fade-in coreografado (o carregamento é parte da estética)

## Mecânica de pairing

- Estado: fonte A (headline) + fonte B (body), lock independente por slot
- **Gerar:** reimplementação da métrica do fontjoy — distância de cosseno decomposta em componentes positivos e negativos (premia semelhança + contraste simultâneos), com peso de legibilidade para o slot body — modulada pelo slider de contraste. <5ms para 1.000 fontes, sem worker
- **Coreografia:** câmera anima até enquadrar os dois pontos; arco conecta os cards; specimen da camada 2 faz Flip para as novas fontes
- Clicar num card do mapa → seta a fonte no slot ativo (respeitando locks)
- Specimen editável inline
- Estado completo na URL (`?a=Lora&b=Inter&c=0.6&t=...`) — compartilhar = copiar link

## Interações GSAP

- Pan: Draggable + InertiaPlugin no mundo; zoom: wheel/pinch com quickTo, focal no cursor
- Flip nas transições do specimen; timeline de geração como momento hero
- `prefers-reduced-motion`: drift e coreografias desligam, cortes secos

## Erros e degradação

- Fonte que falha ao carregar → card indisponível + excluída do gerador (fail closed)
- Sem WebGL → gradiente CSS
- Mobile: pan/pinch funcional, mas v1 é desktop-first

## Testes

- **Vitest:** métrica de pairing (casos de referência vs comportamento do fontjoy), serialização de URL, lógica LOD/virtualização
- Script de build testado com fixture reduzida
- Validação visual manual no browser antes de cada entrega

## Fora de escopo (v1)

Contas, salvar coleções, exportar CSS, regeneração de embeddings, mobile-first.

## Atualização de catálogo (já implementada — contexto histórico)

A metodologia original do Jack000, que replicamos acima com DINOv2 no lugar da CNN VGG-era:

1. **Renderização:** cada fonte (cada variante/peso tratado como fonte separada, para o peso entrar no vetor) renderizada como imagem 224×224 com uma grade de letras tipograficamente distintivas (e, a, n…)
2. **Extração:** imagem passa por CNN pré-treinada (Keras, extractor fixo — sem treino custom) → vetor de features
3. **Redução:** PCA → 200 dimensões
4. **Métrica de pairing:** aplicada sobre esses vetores em runtime (já reimplementada neste projeto)

Para atualizar com o catálogo atual (~1.800+ famílias):

1. Baixar catálogo via Google Fonts Developer API ou repo `google/fonts`
2. Renderizar a mesma grade de glifos por variante (PIL/Pillow + fonttools)
3. Extrair features com um extractor fixo — ou o mesmo VGG-era CNN (fidelidade ao original), ou um encoder moderno (CLIP/DINOv2, embeddings melhores)
4. PCA → 200d, regenerar UMAP, reemitir `fonts-map.json`

**Restrição importante:** não dá para misturar vetores antigos com novos — extractors diferentes produzem espaços incompatíveis. A atualização é sempre uma regeneração completa do dataset (o que é tranquilo: ~2 mil fontes processam em minutos em CPU). O pipeline de build já é desenhado para reprocessar tudo de uma vez.
