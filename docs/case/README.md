# Página do case

Post explicando como o algoritmo pareia tipografias por peso visual. Feita para
ser gravada em vídeo: tudo em um arquivo só, sem rede, sem servidor.

`public/espaco-tipografico.html` é o build. Abre com duplo clique e funciona
offline, porque as quatro faces do Geist e as 24 grades de glifos vão embutidas
como data URI.

Ele sai em `public/` porque a página não é só um arquivo solto: o site a serve
num modal — o botão `?` no canto inferior esquerdo —, e só o que está em
`public/` chega ao `dist/`. O `npm run build` roda este build antes do da
aplicação, então a página que vai ao ar nunca fica atrás do `page.html`.

## Editar

O fonte é `page.html`, o template com o HTML, o CSS e o JS. Os dados entram por
placeholders (`__DATA__` e os quatro `/*__GEIST_*__*/`). Depois de mexer:

```bash
node docs/case/build.mjs
```

Roda de qualquer diretório: os caminhos saem do próprio arquivo, não do cwd.

## Regenerar os dados

Só é necessário quando o catálogo ou o `pairs.json` mudarem. Os dois scripts
dependem de `pipeline/data/`, que o git ignora, então as saídas ficam
versionadas em `data/` de propósito: sem elas, reconstruir a página exigiria
refazer o pipeline inteiro na GPU.

```bash
.venv/Scripts/python docs/case/espaco.py    # -> data/space.json   (UMAP, ~1 min)
.venv/Scripts/python docs/case/assets.py    # -> data/assets.json  (glifos + fontes)
node docs/case/build.mjs
```

`espaco.py` usa `random_state=42` e é reprodutível byte a byte: rodar de novo
sobre os mesmos vetores devolve o mesmo arquivo.

## Arquivos

| arquivo | papel |
|---|---|
| `page.html` | template, o que você edita |
| `build.mjs` | injeta dados e fontes, emite o HTML final |
| `espaco.py` | projeta os vetores de 200 dims em 2D com UMAP |
| `assets.py` | recorta os PNGs de glifo e faz o subset woff2 do Geist |
| `data/space.json` | 1.221 posições do mapa (gerado, versionado) |
| `data/assets.json` | glifos e fontes em data URI (gerado, versionado) |
| `../../public/espaco-tipografico.html` | o build, servido pelo site |

## Decisões

**A página é acromática.** A única cor está no mapa da Fig. 2, onde codifica a
categoria e portanto é dado. Os tokens de cinza têm R=G=B exato.

**O mapa é honesto.** As 1.221 posições saem dos mesmos vetores de 200 dimensões
que alimentam o pareamento, projetados com UMAP. As cores de categoria entram
depois, só para conferência: o modelo nunca soube a que categoria cada fonte
pertence, e a legenda diz isso.

**As 1.221 plotadas contra as 1.223 elegíveis.** As duas famílias de diferença
não têm peso regular no catálogo, e a identidade da família no mapa é o regular.
