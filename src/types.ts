/** Papéis de peso que sobreviveram ao corte do pipeline. */
export type WeightRole = "light" | "regular" | "bold";

/** Uma família do catálogo curado, com os pesos que ela realmente tem. */
export interface FontMeta {
  /** family */
  f: string;
  /** category */
  c: string;
  /** peso por papel; papel ausente = a família não tem peso naquela faixa */
  w: Partial<Record<WeightRole, number>>;
}

export interface PairBucket {
  /** posição no slider: 0 = harmonia, 1 = contraste */
  c: number;
  /** papel de peso de cada lado do par nesta faixa */
  roles: [WeightRole, WeightRole];
  /** índices em `fonts` */
  pairs: [number, number][];
}

export interface PairsData {
  version: number;
  fonts: FontMeta[];
  buckets: PairBucket[];
}

/**
 * O par é simétrico: nenhuma das duas é "a fonte do título". Cada card decide
 * quem assume qual papel, então o estado guarda só as duas famílias.
 */
export interface AppState {
  a: string;
  b: string;
  /** 0..1 — governa escolha do par, contraste de peso e de medida */
  contrast: number;
}
