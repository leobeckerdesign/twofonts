import type { CardSpec } from "./spec";

/**
 * Ordem dos cards no campo, por contraste tonal.
 *
 * Regra do Leo: nunca dois brancos juntos, nunca dois pretos juntos.
 *
 * Alternar claro/escuro de forma estrita NÃO resolve, e é bom saber por quê: o
 * baralho tem 9 escuros contra 6 claros, e alternância perfeita exigiria que
 * os dois lados diferissem no máximo em 1. Sobram 3 escuros sem par.
 *
 * A saída está no enunciado: a regra fala dos CHAPADOS. Card escuro com foto
 * por baixo não é preto chapado, e o cinza não é branco. Então as classes que
 * importam são três — branco, preto e neutro — e o neutro separa qualquer par.
 *
 * O algoritmo tem dois passos:
 *   1. Espinha alternando branco e preto, que é onde mora o contraste.
 *   2. Os neutros entram PRIMEIRO nos choques que a espinha não conseguiu
 *      evitar, e só depois se espalham pelo resto.
 */

/** Tom aparente do FUNDO do card. 0 é preto chapado, 1 é branco chapado. */
export function toneOf(card: CardSpec): number {
  // Só caixa fora do fluxo cobre o card inteiro. Banda (o `nome`) é um trecho:
  // o fundo continua sendo a cor do card.
  const backdrop = card.blocks.some(
    (b) =>
      (b.type === "image" || b.type === "video" || b.type === "shader") &&
      b.flow === "absolute",
  );

  if (card.kind === "accent") return 0.55;
  if (card.kind === "paper") return backdrop ? 0.82 : 1;
  return backdrop ? 0.18 : 0;
}

type Klass = "branco" | "preto" | "neutro";

/** Só o extremo chapado tem classe; o resto é neutro e pode encostar em tudo. */
function klass(card: CardSpec): Klass {
  const tone = toneOf(card);
  if (tone === 1) return "branco";
  if (tone === 0) return "preto";
  return "neutro";
}

/** O que a regra proíbe: dois brancos chapados, ou dois pretos chapados. */
export function clashes(a: CardSpec, b: CardSpec): boolean {
  const side = klass(a);
  return side !== "neutro" && side === klass(b);
}

/**
 * Distribui `small` pela corrente de `big` sem empilhar dois no mesmo encaixe.
 *
 * A corrente de `big` tem `big.length + 1` encaixes: antes do primeiro, entre
 * cada par, e depois do último. Dois cards no MESMO encaixe se encostariam, que
 * é o mesmo defeito visto do outro lado — daí um por encaixe. Os vãos internos
 * vêm primeiro, porque só eles desfazem um encontro do balde maior.
 */
function interleave(big: CardSpec[], small: CardSpec[]): CardSpec[] {
  if (small.length === 0) return [...big];
  if (big.length === 0) return [...small];

  const slots: CardSpec[][] = Array.from({ length: big.length + 1 }, () => []);
  const inner = big.length - 1;
  const take = Math.min(small.length, inner);

  for (let k = 0; k < take; k++) {
    // Passo de `inner / take` ≥ 1, então os encaixes saem sempre distintos.
    slots[1 + Math.floor((k * inner) / take)].push(small[k]);
  }

  let rest = take;
  if (rest < small.length) slots[0].push(small[rest++]);
  if (rest < small.length) slots[big.length].push(small[rest++]);
  for (let k = rest; k < small.length; k++) slots[k % slots.length].push(small[k]);

  return flatten(slots, big);
}

function flatten(slots: CardSpec[][], chain: CardSpec[]): CardSpec[] {
  const out: CardSpec[] = [];
  for (let i = 0; i <= chain.length; i++) {
    out.push(...slots[i]);
    if (i < chain.length) out.push(chain[i]);
  }
  return out;
}

/**
 * Gasta os neutros nos choques da espinha, e só então espalha o que sobrou.
 *
 * A ordem importa: espalhar antes gastaria um neutro num vão que já estava bom
 * e deixaria um choque de pé.
 */
function relieve(spine: CardSpec[], neutral: CardSpec[]): CardSpec[] {
  if (neutral.length === 0) return spine;

  const pool = [...neutral];
  const slots: CardSpec[][] = Array.from({ length: spine.length + 1 }, () => []);

  for (let i = 1; i < spine.length && pool.length > 0; i++) {
    if (!clashes(spine[i - 1], spine[i])) continue;
    // Entre dois brancos entra o neutro mais escuro, e vice-versa: separar já
    // resolve a regra, mas separar com contraste é o ponto do campo.
    const target = klass(spine[i]) === "branco" ? 0 : 1;
    let best = 0;
    for (let j = 1; j < pool.length; j++) {
      if (Math.abs(toneOf(pool[j]) - target) < Math.abs(toneOf(pool[best]) - target)) best = j;
    }
    slots[i].push(pool.splice(best, 1)[0]);
  }

  // O resto vai para encaixes ainda vazios, espalhado: amontoar no fim deixaria
  // uma corrida de neutros no rabo do campo.
  const free: number[] = [];
  for (let i = 0; i <= spine.length; i++) if (slots[i].length === 0) free.push(i);

  const take = Math.min(pool.length, free.length);
  for (let k = 0; k < take; k++) slots[free[Math.floor((k * free.length) / take)]].push(pool[k]);
  // Neutro com neutro é permitido, então a sobra pode empilhar sem violar nada.
  for (let k = take; k < pool.length; k++) slots[k % slots.length].push(pool[k]);

  return flatten(slots, spine);
}

/**
 * Fecha a volta.
 *
 * O campo é um LAÇO (`gsap.utils.wrap` em field.ts): o último card encosta no
 * primeiro. Então a regra não vale para uma fila, vale para um ciclo, e a
 * costura precisa ser tratada como qualquer outro vizinho.
 *
 * Rotacionar não resolve — num ciclo o conjunto de vizinhanças é o mesmo em
 * qualquer rotação. O que resolve é MUDAR o conjunto: tirar um card do meio e
 * levá-lo para o fim, desde que ele sirva de costura e o buraco que ele deixa
 * não crie um choque novo.
 */
function closeLoop(seq: CardSpec[]): CardSpec[] {
  if (seq.length < 3) return seq;
  if (!clashes(seq[seq.length - 1], seq[0])) return seq;

  const last = seq.length - 1;
  for (let j = 1; j < last; j++) {
    const moved = seq[j];
    // Ele vira o novo fim: precisa servir contra o começo e contra o antigo fim.
    if (clashes(moved, seq[0]) || clashes(seq[last], moved)) continue;
    // E o buraco que ele deixa não pode encostar dois iguais.
    if (clashes(seq[j - 1], seq[j + 1])) continue;
    return [...seq.slice(0, j), ...seq.slice(j + 1), moved];
  }
  return seq;
}

/**
 * Intercala o baralho para maximizar contraste entre vizinhos.
 *
 * Devolve SEMPRE os mesmos cards, na mesma quantidade: é permutação, não
 * filtro. Determinística, porque o campo repinta a cada par e a ordem não pode
 * dançar embaixo do usuário.
 */
export function sequence(cards: CardSpec[]): CardSpec[] {
  if (cards.length < 3) return [...cards];

  const branco = cards.filter((c) => klass(c) === "branco");
  const preto = cards.filter((c) => klass(c) === "preto");
  const neutro = cards.filter((c) => klass(c) === "neutro");

  const [big, small] = branco.length >= preto.length ? [branco, preto] : [preto, branco];
  return closeLoop(relieve(interleave(big, small), neutro));
}
