# Arquitetura de performance

## Contexto

A primeira versão virtualizava até 180 elementos DOM e carregava a webfont de
cada item visível. Durante pan e zoom isso criava requisições de CSS/WOFF,
recalculo de estilos, até 180 tweens infinitos e filtros em elementos móveis.
O mapa também cortava o catálogo pela ordem alfabética, deixando a distribuição
visual pouco representativa.

## Decisão

O runtime usa uma composição híbrida:

1. `FontField` desenha todos os pontos em Canvas 2D e revela glyph previews
   depois de 110 ms sem movimento.
2. Os 1.807 PNGs já gerados pelo pipeline são consolidados em atlas WebP. O
   índice do tile é o mesmo índice de `fonts-map.json`, sem manifest adicional.
3. `CardLayer` mantém apenas a camada acessível e interativa em DOM, com seleção
   por proximidade e colisão geométrica em coordenadas de tela.
4. `PairBuffer` tenta preparar dois pares completos durante o boot e repõe a
   fila em background. O warmup tem limite próprio e nunca impede a entrada se
   o provedor externo estiver lento.
5. `fonts.ts` fixa as duas famílias ativas e aplica LRU com teto de 6 famílias e
   8 faces, além de limitar globalmente o download a duas requisições. O mapa
   raster nunca chama o Google Fonts.

## Loading

As fases ponderadas são:

- 22% catálogo e validação;
- 38% download/decode do atlas;
- 14% construção da cena;
- 15% par inicial;
- 8% warmup de pares;
- 3% primeiro frame e shader.

O loader permanece visível por no mínimo 1,6 s, mostra progresso monotônico e
expõe falhas por fase. A interface subjacente fica inerte até o primeiro frame,
e uma falha fatal oferece nova tentativa. Se o provedor de fontes estiver
indisponível, o app continua navegável com os previews locais.

## Budgets do runtime

| Recurso | Desktop | Mobile |
| --- | ---: | ---: |
| Labels DOM | 24 | 20 |
| Cards DOM | 16 | 12 |
| Previews Canvas detalhados | 96 | 96 |
| Webfont families | 6 | 6 |
| Webfont faces | 8 | 8 |
| Shader | 30 fps, DPR 1,15 | 30 fps, DPR 1,15 |
| Atlas decodificado | ~38 MiB | ~16 MiB |

O culling do DOM ocorre somente após o gesto estabilizar. Durante o movimento,
o browser transforma o mundo e redesenha apenas o Canvas em um frame coalescido.

## Regeneração

Depois de reconstruir `fonts-map.json` e os PNGs em `pipeline/data/renders`:

```bash
.venv/Scripts/python pipeline/build_preview_atlas.py
.venv/Scripts/python pipeline/build_ui_font.py
```

Os scripts geram os dois atlases responsivos e a fonte local da interface.
