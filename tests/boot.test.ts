import { afterEach, describe, expect, it, vi } from "vitest";
import { BootController, BootError, type BootSnapshot } from "../src/boot";

afterEach(() => {
  vi.useRealTimers();
});

describe("BootController", () => {
  it("combina fases ponderadas em progresso global", async () => {
    const snapshots: BootSnapshot[] = [];
    const boot = new BootController([
      {
        id: "catalog",
        message: "Lendo catálogo",
        weight: 1,
        run: ({ report }) => report(0.5),
      },
      {
        id: "fonts",
        message: "Preparando tipografias",
        weight: 3,
        run: ({ report }) => report(0.5, "Aquecendo fontes"),
      },
    ]);
    boot.subscribe((snapshot) => snapshots.push(snapshot));

    await boot.start();

    expect(snapshots.some((snapshot) => snapshot.progress === 0.125)).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.progress === 0.25)).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.progress === 0.625)).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.message === "Aquecendo fontes")).toBe(true);
    expect(boot.getSnapshot()).toMatchObject({
      status: "complete",
      progress: 1,
      message: "Pronto",
      phaseId: null,
    });
  });

  it("mantém o progresso monotônico e clampa reports inválidos", async () => {
    const progress: number[] = [];
    const boot = new BootController([{
      id: "map",
      message: "Montando mapa",
      weight: 1,
      run: ({ report }) => {
        report(0.8);
        report(0.2);
        report(Number.NaN);
        report(2);
      },
    }]);
    boot.subscribe((snapshot) => progress.push(snapshot.progress));

    await boot.start();

    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
    expect(progress).toContain(0.8);
    expect(progress.at(-1)).toBe(1);
  });

  it("rejeita, marca falha e aborta a fase quando ocorre timeout", async () => {
    vi.useFakeTimers();
    let phaseSignal: AbortSignal | undefined;
    const boot = new BootController([{
      id: "assets",
      message: "Carregando recursos",
      weight: 1,
      timeoutMs: 50,
      run: ({ signal }) => {
        phaseSignal = signal;
        return new Promise(() => undefined);
      },
    }]);

    const result = boot.start();
    const rejection = expect(result).rejects.toMatchObject({
      name: "BootError",
      code: "PHASE_TIMEOUT",
      phaseId: "assets",
    });
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(phaseSignal?.aborted).toBe(true);
    expect(boot.getSnapshot()).toMatchObject({ status: "failed", phaseId: "assets" });
  });

  it("preserva a causa quando uma fase falha", async () => {
    const cause = new Error("network offline");
    const boot = new BootController([{
      id: "data",
      message: "Baixando dados",
      weight: 1,
      run: () => { throw cause; },
    }]);

    await expect(boot.start()).rejects.toSatisfy((error: unknown) => {
      return error instanceof BootError
        && error.code === "PHASE_FAILED"
        && error.cause === cause;
    });
    expect(boot.getSnapshot().error?.cause).toBe(cause);
  });

  it("respeita o tempo visual mínimo sem repetir a execução", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const run = vi.fn();
    const boot = new BootController([{
      id: "ready",
      message: "Finalizando",
      weight: 1,
      run,
    }], { minimumVisibleMs: 300 });

    const first = boot.start();
    const second = boot.start();
    await vi.advanceTimersByTimeAsync(299);
    expect(boot.getSnapshot().status).toBe("running");

    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toMatchObject({ status: "complete" });
    await expect(second).resolves.toMatchObject({ status: "complete" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falha cedo para configurações ambíguas", () => {
    expect(() => new BootController([])).toThrow("at least one phase");
    expect(() => new BootController([
      { id: "same", message: "Um", weight: 1, run: () => undefined },
      { id: "same", message: "Dois", weight: 1, run: () => undefined },
    ])).toThrow("duplicate");
    expect(() => new BootController([
      { id: "bad", message: "Peso", weight: 0, run: () => undefined },
    ])).toThrow("positive");
  });
});
