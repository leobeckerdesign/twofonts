import { describe, expect, it, vi } from "vitest";
import { indexFonts } from "../src/data";
import { failedFonts, loadFont } from "../src/fonts";
import { PairBuffer } from "../src/pair-buffer";
import type { FontEntry, PairState } from "../src/types";

function font(family: string, v: number[]): FontEntry {
  return { family, v, x: 0.5, y: 0.5, category: "Serif", weights: [400, 700] };
}

const state: PairState = {
  a: "A",
  b: "B",
  lockA: false,
  lockB: false,
  contrast: 0.5,
  text: "Teste",
};

describe("PairBuffer", () => {
  it("prepara as duas faces antes de entregar o par", async () => {
    const load = vi.fn(async () => true);
    const db = indexFonts([
      font("A", [1, 0]),
      font("B", [0.9, 0.1]),
      font("C", [-1, 0]),
    ]);
    const buffer = new PairBuffer(db, {
      target: 1,
      load,
      ready: () => true,
      rng: () => 0.9,
    });

    await buffer.prime(state);
    const pair = buffer.take(state);

    expect(pair).not.toBeNull();
    expect(pair?.a).not.toBe(pair?.b);
    expect(load).toHaveBeenCalledTimes(2);
    expect(buffer.size).toBe(0);
  });

  it("descarta a fila quando locks ou contraste mudam", async () => {
    const db = indexFonts([
      font("A", [1, 0]),
      font("B", [0, 1]),
      font("C", [-1, 0]),
    ]);
    const buffer = new PairBuffer(db, {
      target: 1,
      load: async () => true,
      ready: () => true,
      rng: () => 0.2,
    });

    await buffer.prime(state);
    expect(buffer.size).toBe(1);
    expect(buffer.take({ ...state, lockA: true })).toBeNull();
  });

  it("não publica pares cujas fontes falharam", async () => {
    const db = indexFonts([font("A", [1]), font("B", [-1])]);
    const buffer = new PairBuffer(db, {
      target: 1,
      load: async () => false,
      rng: () => 0,
    });

    await buffer.prime(state);
    expect(buffer.size).toBe(0);
  });

  it("não publica um par concluído depois do cancelamento", async () => {
    const controller = new AbortController();
    const db = indexFonts([font("A", [1]), font("B", [-1])]);
    const buffer = new PairBuffer(db, {
      target: 1,
      load: async () => {
        controller.abort();
        return true;
      },
      rng: () => 0,
    });

    await buffer.prime(state, undefined, controller.signal);
    expect(buffer.size).toBe(0);
  });

  it("interrompe imediatamente o warmup obsoleto", async () => {
    const signals: AbortSignal[] = [];
    const releases: Array<(loaded: boolean) => void> = [];
    const deferredLoad: typeof loadFont = (_family, _weight, _text, options = {}) => {
      if (options.signal) signals.push(options.signal);
      return new Promise<boolean>((resolve) => releases.push(resolve));
    };
    const db = indexFonts([font("A", [1]), font("B", [-1])]);
    const buffer = new PairBuffer(db, {
      target: 1,
      load: vi.fn(deferredLoad),
      ready: () => true,
      rng: () => 0,
    });

    const oldFill = buffer.prime(state);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    buffer.interrupt({ ...state, a: "B", b: "A" });

    expect(buffer.isLoading).toBe(false);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    for (const release of releases) release(true);
    await expect(oldFill).resolves.toBe(0);
    expect(buffer.size).toBe(0);
  });

  it("descarta um par preparado se uma das faces saiu do cache", async () => {
    let ready = true;
    const db = indexFonts([font("A", [1]), font("B", [-1])]);
    const buffer = new PairBuffer(db, {
      target: 1,
      load: async () => true,
      ready: () => ready,
      rng: () => 0,
    });

    await buffer.prime(state);
    ready = false;

    expect(buffer.take(state)).toBeNull();
    expect(buffer.size).toBe(0);
  });

  it("não viola um lock cuja família falhou", async () => {
    const load = vi.fn(async () => true);
    const db = indexFonts([font("A", [1]), font("B", [0]), font("C", [-1])]);
    const buffer = new PairBuffer(db, {
      target: 1,
      load,
      ready: () => true,
      rng: () => 0,
    });
    failedFonts.add("A");

    try {
      await buffer.prime({ ...state, lockA: true });
      expect(buffer.size).toBe(0);
      expect(load).not.toHaveBeenCalled();
    } finally {
      failedFonts.delete("A");
    }
  });
});
