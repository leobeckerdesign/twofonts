import type { FontDB } from "./data";
import { failedFonts, isFontReady, loadFont } from "./fonts";
import { generatePair } from "./pairing";
import type { FontEntry, PairState } from "./types";

export interface PreparedPair {
  a: string;
  b: string;
}

export interface PairBufferOptions {
  target?: number;
  load?: typeof loadFont;
  ready?: (family: string) => boolean;
  rng?: () => number;
}

export interface PairBufferProgress {
  ready: number;
  target: number;
  progress: number;
}

function nearestWeight(entry: FontEntry, preferred: number): number {
  return entry.weights.reduce((nearest, weight) => {
    return Math.abs(weight - preferred) < Math.abs(nearest - preferred) ? weight : nearest;
  }, entry.weights[0] ?? preferred);
}

function bufferSignature(state: PairState): string {
  const a = state.lockA ? state.a : "*";
  const b = state.lockB ? state.b : "*";
  return `${a}|${b}|${state.lockA ? 1 : 0}|${state.lockB ? 1 : 0}|${state.contrast.toFixed(2)}`;
}

/**
 * Keeps a few fully loaded pairings ahead of the user. Generation remains
 * immediate while refill work happens after the interaction.
 */
export class PairBuffer {
  private readonly target: number;
  private readonly load: typeof loadFont;
  private readonly readyCheck: (family: string) => boolean;
  private readonly rng: () => number;
  private signature = "";
  private revision = 0;
  private cursor: PairState | null = null;
  private ready: PreparedPair[] = [];
  private filling: Promise<number> | null = null;
  private fillController: AbortController | null = null;

  constructor(
    private readonly db: FontDB,
    options: PairBufferOptions = {},
  ) {
    this.target = Math.max(1, Math.min(6, Math.round(options.target ?? 3)));
    this.load = options.load ?? loadFont;
    this.readyCheck = options.ready ?? isFontReady;
    this.rng = options.rng ?? Math.random;
  }

  get size(): number {
    return this.ready.length;
  }

  get isLoading(): boolean {
    return this.filling !== null;
  }

  /** Stops obsolete network work while preserving pairs valid for the same constraints. */
  interrupt(state: PairState): void {
    const signature = bufferSignature(state);
    if (signature !== this.signature) {
      this.ensureState(state);
      return;
    }

    this.fillController?.abort();
    this.fillController = null;
    this.revision += 1;
    this.cursor = { ...state };
    this.filling = null;
  }

  take(state: PairState): PreparedPair | null {
    this.ensureState(state);
    while (this.ready.length > 0) {
      const pair = this.ready.shift();
      if (pair && this.readyCheck(pair.a) && this.readyCheck(pair.b)) return pair;
    }
    return null;
  }

  prime(
    state: PairState,
    onProgress?: (progress: PairBufferProgress) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    this.ensureState(state);
    if (this.filling) return this.filling;

    const revision = this.revision;
    const signature = this.signature;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    this.fillController = controller;
    const run = this.fill(revision, signature, onProgress, controller.signal);
    this.filling = run;
    const clear = (): void => {
      signal?.removeEventListener("abort", abort);
      if (this.filling === run) this.filling = null;
      if (this.fillController === controller) this.fillController = null;
    };
    void run.then(clear, clear);
    return run;
  }

  private ensureState(state: PairState): void {
    const signature = bufferSignature(state);
    if (signature === this.signature) return;
    this.fillController?.abort();
    this.fillController = null;
    this.signature = signature;
    this.revision += 1;
    this.ready = [];
    this.cursor = { ...state };
    this.filling = null;
  }

  private async fill(
    revision: number,
    signature: string,
    onProgress?: (progress: PairBufferProgress) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    let attempts = 0;
    const maxAttempts = this.target * 2;
    const seen = new Set(this.ready.map((pair) => `${pair.a}|${pair.b}`));

    while (
      this.ready.length < this.target &&
      attempts < maxAttempts &&
      !signal?.aborted &&
      revision === this.revision &&
      signature === this.signature
    ) {
      attempts += 1;
      const entries = this.db.entries.filter((entry) => !failedFonts.has(entry.family));
      if (entries.length < 2) break;
      const available: FontDB = {
        entries,
        byFamily: new Map(entries.map((entry) => [entry.family, entry])),
      };

      const cursor = this.cursor;
      if (!cursor) break;
      if (
        (cursor.lockA && failedFonts.has(cursor.a)) ||
        (cursor.lockB && failedFonts.has(cursor.b))
      ) break;
      const pair = generatePair(available, cursor, this.rng);
      const key = `${pair.a}|${pair.b}`;
      this.cursor = { ...cursor, ...pair };
      if (seen.has(key)) continue;
      seen.add(key);

      const a = available.byFamily.get(pair.a);
      const b = available.byFamily.get(pair.b);
      if (!a || !b) continue;
      const [aLoaded, bLoaded] = await Promise.all([
        this.load(a.family, nearestWeight(a, 700), undefined, { signal }),
        this.load(b.family, nearestWeight(b, 400), undefined, { signal }),
      ]);

      // Two simultaneous failures strongly indicate an offline or blocked
      // provider. Stop warming and release the app instead of cascading
      // through a long sequence of timeouts.
      if (!aLoaded && !bLoaded) break;

      if (
        aLoaded &&
        bLoaded &&
        !signal?.aborted &&
        revision === this.revision &&
        signature === this.signature
      ) {
        this.ready.push(pair);
      }

      onProgress?.({
        ready: this.ready.length,
        target: this.target,
        progress: this.ready.length / this.target,
      });
    }

    return this.ready.length;
  }
}
