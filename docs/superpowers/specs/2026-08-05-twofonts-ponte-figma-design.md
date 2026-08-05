# Ponte twofonts ↔ Figma

**Data:** 2026-08-05
**Estado:** proposto, aguardando revisão do Leo

## Objetivo

Levar os 18 cards do palco para um arquivo Figma editável, deixar o Leo redesenhar
e criar cards novos lá, e trazer o resultado de volta para o código sem que cada
rodada custe uma reescrita manual.

Requisito novo, trazido pelo Leo nesta conversa: os cards vão ganhar **imagem,
vídeo e shaders generativos**, gerados de forma escalar a partir de parâmetros.

## Princípio

**O Figma é dono da caixa. O código é dono do conteúdo.**

Composição (onde o bloco senta, que tamanho tem, que proporção, se sangra, o que
sobrepõe) volta perfeito, porque é geometria. Comportamento (qual par tipográfico
está ativo, que pixels o shader gera, como randomiza por card) mora no código, e
no Figma aparece congelado ou como preenchimento neutro, só para a composição ser
julgável.

Isso estende ao meio o que já estava combinado para a tipografia: o Figma congela
um par por card, serve para composição, não para o comportamento dinâmico.

## Arquitetura

### O que muda

`src/layouts.ts` deixa de ter 18 funções que cospem HTML na mão e passa a ter um
**renderizador** que lê `src/layouts.json`.

### O que não muda

`src/field.ts`, `src/styles.css`, `src/roles.ts`, `src/pairs.ts`, `src/fonts.ts`,
`src/ui/*`. O campo continua chamando `s.layout.html(context)` e recebendo a mesma
string. O CSS não ganha nem perde uma regra. O refactor é contido em um arquivo.

### Arquivos novos

| Arquivo | Papel |
|---|---|
| `src/layouts.json` | O spec dos cards. Fonte de verdade da composição. |
| `src/layouts.ts` | Renderizador (substitui as 18 funções). |
| `tools/figma-push.js` | Código da Plugin API que escreve os frames no Figma. |
| `tools/figma-pull.mjs` | Lê o dump do Figma, escreve `layouts.json`, emite relatório. |
| `tools/layouts-parity.mjs` | Prova que o renderizador produz o HTML antigo. |

## A gramática

### Tipos de bloco

Derivados dos 18 cards que já existem, nada inventado.

**Folhas de texto:** `label` (o `.tag`), `title` (`.t`), `body` (`.p`),
`eyebrow`, `button` (`.btn`), `stamp`.

**Divisor:** `rule`.

**Texto com modificador de layout:** `columns` (corpo em duas colunas, o `.cols`).

**Contêineres:** `rows` (lista de par esquerda/direita, usado por `numerais` e
`indice`), `meta` (legenda pequena mais valor, usado por `ficha`), `split` (duas
colunas de blocos, usado por `comparativo`), `stack` (pilha apertada de títulos,
o `.wf`, usado por `escala`).

**Caixas:** `image`, `video`, `shader`.

### Atributos

Cada bloco de texto carrega:

- `text`: literal ou com tokens (abaixo)
- `scale`: multiplicador sobre a base do card para o papel do bloco, padrão 1
- `mt` e `mb`: sobrescrita das margens superior e inferior em px
- `caps`, `tracking`, `opacity`, `num`: derivados do nó do Figma, nunca do nome

`mt` e `mb` vêm de `paddingTop` e `paddingBottom` do frame do bloco, lidos direto,
sem inferência. Só são gravados quando **divergem** do que o CSS já dá para aquele
tipo de bloco (14px acima de `.p`, 12px entre `.t` irmãos, 4px dentro de `stack`,
15px acima e abaixo de `rule`, 14px abaixo de `label`, 0 para `eyebrow`). Assim o
spec fica enxuto e o CSS continua sendo o padrão, com o Figma sobrescrevendo só
onde o Leo mexeu de propósito.

Caixas carregam `family` (id da família de shader), `ratio` ou `h`, e `bleed`.

O card carrega `id`, `kind` (`paper` | `ink` | `accent`), `w`, e `blocks[]`.

### Tokens

Parte do texto dos cards é dinâmica. Ela vira token:

| Token | Resolve para |
|---|---|
| `{{titleFont}}` | nome da família no papel de título |
| `{{bodyFont}}` | nome da família no papel de corpo |
| `{{contrast}}` | contraste do corte, em porcento |
| `{{sizeTitle}}` / `{{sizeBody}}` | corpo em px, arredondado |
| `{{fox}}` | o pangrama |
| `{{para}}` / `{{para:N}}` | o parágrafo, inteiro ou truncado em N com reticências |

No Figma a camada mostra o **valor resolvido** (para você julgar a composição) e o
**nome da camada carrega o token**. Regra de precedência na volta: se a camada tem
token no nome, o token vence e o texto visível é ignorado. Se não tem, o texto
visível é literal e volta como está.

## Contrato de nomes no Figma

Frame do card: `card/{id}`, por exemplo `card/capa`.

`kind` e `w` **não vão no nome**, são lidos do próprio frame (preenchimento e
largura). Assim, recolorir ou redimensionar um card no Figma simplesmente funciona,
sem nada para manter em sincronia.

Camada de bloco: o nome é o **tipo**, mais o token opcional.

```
title
title · {{titleFont}}
body · {{para:108}}
label
rule
shader/flow
image.bleed
```

Tudo que é visual (caixa alta, entreletra, opacidade, tamanho, posição, proporção)
é lido das propriedades do nó, não do nome. Você deixa um texto em caixa alta no
Figma e isso volta como `caps: true`. Essa é a razão de o nome ser curto: ele diz
só o que a geometria não consegue dizer.

Camada com nome fora da gramática não é descartada. Ela entra no relatório de
importação como pendência, para eu decidir o que fazer.

## O arquivo Figma

**Uma página, 18 frames** em grade, largura de projeto real (330 a 500 px), sem
escala. Padding 30 topo, 32 laterais, 26 base, como no CSS. Preenchimentos
`paper #E9E5DD`, `ink #131310` (texto paper), `accent #F05524` (texto `#14120F`).
Sombra `0 26px 64px rgba(0,0,0,.36)`.

### Par congelado

**Barlow + Bitter**, corte 5 de 10, contraste `0.556`, papéis `bold` / `regular`,
razão de medida `2.5786`.

Escolhido porque: Sans mais Serif deixa óbvio quem é quem; as duas têm light,
regular e bold de verdade, então nenhum peso é aproximado; as duas seguram texto
corrido, então a alternância de papéis por índice funciona nos 18 cards; e o corte
5 é representativo, não extremo.

A alternância de papéis por índice do card é preservada no Figma, exatamente como
`assignRoles` faz. Card par: Barlow no título. Card ímpar: Bitter no título.

### Medidas

```
fsBody  = 15 × bodyScale
fsTitle = fsBody × 2.5786 × titleScale × 2.2
```

com `BASE_BODY = 15` e `TITLE_BASE = 2.2`, ambos de `field.ts`.

O Figma recebe o **tamanho declarado**, não o tamanho pós-`fitText`. `fitText` é
guarda de execução contra estouro de largura; a intenção que o Leo edita é a
declarada.

### Posicionamento

**Auto-layout do card até a folha.** O card precisa refluir: com centenas de
famílias, a mesma string no mesmo corpo tem largura diferente em cada fonte, o
número de linhas muda e a altura do card muda junto. Posição absoluta faria um
título longo passar por cima do bloco de baixo, e o Leo estaria desenhando contra
uma composição que o navegador nunca vai produzir.

Auto-layout também é melhor **na volta**. Sem ele, a importação teria que inferir
espaçamento subtraindo bounding boxes, e a caixa de um nó de texto no Figma inclui
o leading da entrelinha, então o espaço medido nunca bate com a margem do CSS. Com
auto-layout eu leio `paddingTop` como número, sem inferência.

Os espaçamentos do CSS não são uniformes (0, 4, 6, 8, 9, 12, 14, 15 e 22 px) e o
auto-layout do Figma só tem um `itemSpacing` por contêiner. A saída é estrutural:

**Cada bloco é um frame nomeado.** Auto-layout vertical, `layoutSizingHorizontal`
preenchendo, `layoutSizingVertical` abraçando, sem preenchimento de cor, e o
espaçamento dele mora no próprio `paddingTop` e `paddingBottom`. O card tem
`itemSpacing: 0` e não impõe espaçamento nenhum.

Cada bloco carrega **as duas** margens dele, não só a de cima, porque `.card` é
`display: flex` e em contêiner flex as margens **não colapsam**. Um `rule` com
`margin: 15px 0` seguido de um `.p` com `margin-top: 14px` produz 29px de espaço
no navegador, e o Figma tem que produzir os mesmos 29.

```
card/capa            frame, auto-layout vertical, itemSpacing 0
├── label            paddingBottom 14,                paddingX 32
├── title                                             paddingX 32
├── rule             paddingTop 15, paddingBottom 15, paddingX 32
├── body             paddingTop 14,                   paddingX 32
└── body             paddingTop 22,                   paddingX 32
```

Espaços resultantes: 14 entre rótulo e título, 15 entre título e filete, 29 entre
filete e corpo, 22 entre os dois corpos. Igual ao navegador.

Editar assim é melhor que editar texto solto: o painel de camadas mostra a lista de
blocos nomeados, cada um um objeto que se arrasta, reordena e respaça pela própria
UI do Figma.

### Margem lateral e sangramento

A margem lateral **sai do card e vai para os blocos**: card com padding 30 topo,
0 laterais, 26 base; bloco comum com 32 nas laterais; bloco `bleed` com 0.

Sangrar até a borda vira um número no bloco, não uma exceção no contrato, e volta
lido direto de `paddingLeft`.

### Contêineres

`rows`, `meta`, `split` e `stack` seguem a mesma forma, com `itemSpacing` real,
porque ali o espaçamento **é** uniforme.

Os filhos de contêiner também têm nome no contrato:

| Contêiner | Filho | Conteúdo do filho |
|---|---|---|
| `rows` | `row` | duas camadas, `left` e `right` |
| `meta` | `meta-item` | duas camadas, `caption` e `value` |
| `split` | `split-col` | blocos de folha comuns (`title`, `body`, ...) |
| `stack` | (nenhum) | blocos `title` diretos |

Adicionar um `row` a mais dentro de `rows` funciona e volta como linha nova.

## A volta

1. Eu leio os frames pela Plugin API e produzo um dump JSON.
2. `tools/figma-pull.mjs` normaliza o dump para o spec e escreve `src/layouts.json`.
3. O script emite um **relatório**: cards novos, cards removidos, camadas com nome
   fora da gramática, preenchimentos que não batem com nenhum `kind` conhecido,
   blocos sem token que antes tinham.

### Derivação de `bodyScale` e `titleScale`

A base do card é o **primeiro** bloco `title` e o **primeiro** bloco de papel corpo.
Os outros blocos têm `scale` igual ao próprio tamanho dividido pela base.

```
bodyScale  = fsBodyBase / 15
titleScale = fsTitleBase / (fsBodyBase × 2.5786 × 2.2)
```

Card sem nenhum bloco de corpo (o `poster` é assim) recebe `bodyScale = 1` e
concentra tudo em `titleScale`. É equivalente, porque só o produto importa quando
não há texto corrido.

## Mídia

Decisão do Leo: **placeholder gerado**. Nada de asset externo, o payload não cresce
e o card nunca depende de arquivo.

Consequência que simplifica o desenho: `image` e `video` são casos degenerados do
shader. Imagem é o shader congelado num frame. Vídeo é o shader animado com outra
família. Três nomes na gramática, para o Figma ler natural e para asset real caber
depois sem mudar o contrato, e **um motor só** embaixo.

### Família de shader

Um fragment shader com uniforms nomeados e faixas declaradas:

```ts
{ id: "flow", uniforms: { speed: [.1, .6], warp: [0, 1.4], grain: [0, .05] }, palette: "card" }
```

Por card, uma **semente determinística** derivada do id do card mais o par ativo
resolve os valores dentro das faixas. Determinístico por dois motivos: navegar para
trás não embaralha tudo de novo, e o placeholder do Figma corresponde ao que vai
aparecer.

`palette: "card"` amarra o shader ao `kind` do card, então shader em card `accent`
sai na paleta laranja sem ninguém especificar.

### Banda ou fundo

Uma caixa pode entrar de duas formas, e o auto-layout suporta as duas nativamente:

- **Banda:** filho normal da pilha, ocupa uma faixa do card entre outros blocos.
- **Fundo ou sobreposição:** filho com `layoutPositioning: "ABSOLUTE"`, que o
  auto-layout tira do fluxo. Serve para shader atrás do texto, cobrindo o card
  inteiro, ou para uma sobreposição por cima.

As duas voltam sem ambiguidade, porque o Figma diz qual é qual. O spec grava
`flow: "stack" | "absolute"` mais as âncoras de posição no caso absoluto.

### O limite de WebGL

**18 contextos WebGL não é viável.** O Chrome descarta o contexto mais antigo por
volta de 16, e 18 canvas animados brigariam pelo orçamento de frame que o GSAP já
usa no campo.

O caminho é **um contexto compartilhado**: uma GL offscreen renderiza o shader de
cada card num buffer pequeno e copia para o canvas 2D do card, em rodízio com taxa
limitada. Um contexto, um programa por família, N blits. É o que `background.ts` já
faz bem (30fps travado, DPR limitado a 1.15, pausa quando a aba some, fallback CSS
em toda falha), multiplexado.

Vira `src/media/shaders.ts`, fora do renderizador.

### O contrato reservado agora

O Leo confirmou que a camada WebGL é estrutural, não decorativa: o sistema final
depende dela. Então o bloco de caixa já nasce carregando **tudo** que o motor vai
precisar, mesmo antes de o motor existir. A fase 2 implementa, não renegocia.

| Campo | Para quê |
|---|---|
| `kind` | `image`, `video` ou `shader` |
| `family` | id da família de shader |
| `flow` | `stack` ou `absolute` |
| `ratio` / `h` | proporção ou altura fixa, na banda |
| `inset` | âncoras topo/direita/base/esquerda, no absoluto |
| `bleed` | ignora a margem lateral do card |
| `motion` | `still` (imagem), `loop` (vídeo e shader) |
| `blend` | modo de composição contra o card, lido do `blendMode` do nó |
| `z` | ordem contra os blocos de texto, lida da ordem no Figma |
| `params` | sobrescritas nomeadas das faixas da família, opcional |
| `seed` | `auto` (derivado de card mais par) ou valor fixo |

`params` e `seed` fixo existem para o dia em que um card específico precisar de um
resultado exato em vez do sorteio. Não são usados nesta rodada, mas o campo estar
reservado evita migrar o `layouts.json` depois.

## Escopo

### Nesta rodada

1. `src/layouts.json` extraído dos 18 cards atuais.
2. `src/layouts.ts` vira renderizador.
3. Prova de paridade: o renderizador produz o **mesmo HTML** que as 18 funções, para
   os 18 cards, no mesmo contexto. Falhou a paridade, não seguimos.
4. `tools/figma-push.js` e o arquivo Figma com os 18 frames.
5. `tools/figma-pull.mjs` e o relatório.
6. Caixas `image` / `video` / `shader` existem na gramática e renderizam como
   preenchimento chapado.

### Fora desta rodada

O motor de shader, que é a fase 2. A ponte não depende dele existir: as caixas já
viajam desde o primeiro dia com o contrato completo, e o motor chega depois sem
encostar no renderizador nem no contrato de nomes.

Isso não o torna secundário. Ele é estrutural no sistema final, e é justamente por
isso que o contrato dele está fechado agora: a fase 2 escreve GL, não renegocia
formato.

## Verificação

O portão é a **paridade byte a byte**. `tools/layouts-parity.mjs` roda as 18 funções
antigas e o renderizador novo sobre o mesmo `LayoutContext` e compara as strings.
Diferente é falha, não é "quase".

Depois disso, validação visual no navegador, que só o Leo consegue julgar: o painel
de browser do Claude mantém a aba oculta e congela `requestAnimationFrame`, então
fluidez e ritmo não são verificáveis por aqui.

## Riscos e divergências conhecidas

- **`fitText` diverge.** No navegador, texto que estoura a largura encolhe. No Figma,
  texto de largura fixa quebra linha. Um título longo pode parecer diferente nos dois.
  Aceito: o Figma mostra a intenção, o navegador mostra a guarda.
- **`column-count: 2` não tem equivalente no Figma.** No arquivo vira duas caixas de
  texto lado a lado, agrupadas e nomeadas `columns`, e volta como um bloco só.
- **Recolorir para um valor fora dos três `kind`** não tem para onde ir. Vira
  pendência no relatório, não erro silencioso.
- **Reordenar blocos** funciona, e com auto-layout é arrastar na lista de camadas.
  **Aninhar um bloco dentro de outro** que não seja contêiner conhecido não
  funciona, e vira pendência.
- **Bloco de texto tirado do fluxo** (`layoutPositioning: "ABSOLUTE"`) não tem
  semântica definida: absoluto só significa fundo ou sobreposição para caixas.
  Texto absoluto vira pendência no relatório, não palpite.
- **Quebrar o auto-layout do card** faz a importação cair para leitura de posição,
  que é imprecisa por causa do leading. O relatório avisa quando isso acontece,
  para o card ser reconstruído em vez de importado torto.

## Pendências abertas

Nenhuma. As duas decisões que dependiam do Leo (contrato da volta e origem dos
assets) foram tomadas nesta conversa.
