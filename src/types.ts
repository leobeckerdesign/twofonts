export interface FontEntry {
  family: string;
  category: string;
  weights: number[];
  v: number[];
  x: number;
  y: number;
}

export interface PairState {
  a: string;
  b: string;
  lockA: boolean;
  lockB: boolean;
  contrast: number; // 0..1
  text: string;     // headline do specimen
}
