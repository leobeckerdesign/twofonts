export type BootStatus = "idle" | "running" | "complete" | "failed";

export type BootErrorCode = "PHASE_TIMEOUT" | "PHASE_FAILED";

export class BootError extends Error {
  readonly code: BootErrorCode;
  readonly phaseId: string;

  constructor(code: BootErrorCode, phaseId: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BootError";
    this.code = code;
    this.phaseId = phaseId;
  }
}

export interface BootPhaseContext {
  /** Signal is aborted when this phase fails or reaches its timeout. */
  readonly signal: AbortSignal;
  /** Reports progress inside this phase, from 0 to 1. Values are clamped. */
  report(progress: number, message?: string): void;
}

export interface BootPhase {
  readonly id: string;
  readonly message: string;
  readonly weight: number;
  readonly timeoutMs?: number;
  run(context: BootPhaseContext): void | Promise<void>;
}

export interface BootSnapshot {
  readonly status: BootStatus;
  readonly progress: number;
  readonly message: string;
  readonly phaseId: string | null;
  readonly error: BootError | null;
}

export interface BootControllerOptions {
  /** Default timeout used by phases that do not declare their own timeout. */
  readonly defaultTimeoutMs?: number;
  /** Keeps the boot experience visible for at least this duration. */
  readonly minimumVisibleMs?: number;
  readonly idleMessage?: string;
  readonly completionMessage?: string;
  /** Injectable clock used to keep timing deterministic in tests. */
  readonly now?: () => number;
}

export type BootListener = (snapshot: BootSnapshot) => void;

const DEFAULT_TIMEOUT_MS = 20_000;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function validateDuration(value: number, name: string, allowZero: boolean): void {
  const lowerBound = allowZero ? 0 : Number.EPSILON;
  if (!Number.isFinite(value) || value < lowerBound) {
    throw new TypeError(`${name} must be ${allowZero ? "non-negative" : "positive"}`);
  }
}

function delay(durationMs: number): Promise<void> {
  if (durationMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Coordinates the loading pipeline and exposes a single observable snapshot.
 * A controller is intentionally single-use so phases cannot be started twice.
 */
export class BootController {
  private readonly phases: readonly BootPhase[];
  private readonly totalWeight: number;
  private readonly defaultTimeoutMs: number;
  private readonly minimumVisibleMs: number;
  private readonly completionMessage: string;
  private readonly now: () => number;
  private readonly listeners = new Set<BootListener>();
  private state: BootSnapshot;
  private runPromise: Promise<BootSnapshot> | null = null;

  constructor(phases: readonly BootPhase[], options: BootControllerOptions = {}) {
    if (phases.length === 0) throw new TypeError("boot requires at least one phase");

    const ids = new Set<string>();
    for (const phase of phases) {
      if (phase.id.trim().length === 0) throw new TypeError("phase id cannot be empty");
      if (ids.has(phase.id)) throw new TypeError(`duplicate boot phase id: ${phase.id}`);
      ids.add(phase.id);
      if (phase.message.trim().length === 0) {
        throw new TypeError(`boot phase ${phase.id} requires a message`);
      }
      validateDuration(phase.weight, `weight for phase ${phase.id}`, false);
      if (phase.timeoutMs !== undefined) {
        validateDuration(phase.timeoutMs, `timeout for phase ${phase.id}`, false);
      }
    }

    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.minimumVisibleMs = options.minimumVisibleMs ?? 0;
    validateDuration(this.defaultTimeoutMs, "defaultTimeoutMs", false);
    validateDuration(this.minimumVisibleMs, "minimumVisibleMs", true);

    this.phases = [...phases];
    this.totalWeight = phases.reduce((total, phase) => total + phase.weight, 0);
    this.completionMessage = options.completionMessage?.trim() || "Pronto";
    this.now = options.now ?? Date.now;
    this.state = Object.freeze({
      status: "idle",
      progress: 0,
      message: options.idleMessage?.trim() || "Preparando experiência",
      phaseId: null,
      error: null,
    });
  }

  getSnapshot(): BootSnapshot {
    return this.state;
  }

  subscribe(listener: BootListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<BootSnapshot> {
    if (!this.runPromise) this.runPromise = this.run();
    return this.runPromise;
  }

  private async run(): Promise<BootSnapshot> {
    const startedAt = this.now();
    let completedWeight = 0;

    try {
      for (const phase of this.phases) {
        this.publish({
          status: "running",
          progress: completedWeight / this.totalWeight,
          message: phase.message,
          phaseId: phase.id,
          error: null,
        });

        await this.runPhase(phase, completedWeight);
        completedWeight += phase.weight;
        this.publish({
          status: "running",
          progress: completedWeight / this.totalWeight,
          message: phase.message,
          phaseId: phase.id,
          error: null,
        });
      }

      await delay(this.minimumVisibleMs - (this.now() - startedAt));
      this.publish({
        status: "complete",
        progress: 1,
        message: this.completionMessage,
        phaseId: null,
        error: null,
      });
      return this.state;
    } catch (error) {
      const bootError = error instanceof BootError
        ? error
        : new BootError("PHASE_FAILED", this.state.phaseId ?? "unknown", "Boot failed", error);
      this.publish({
        status: "failed",
        progress: this.state.progress,
        message: bootError.message,
        phaseId: bootError.phaseId,
        error: bootError,
      });
      throw bootError;
    }
  }

  private async runPhase(phase: BootPhase, completedWeight: number): Promise<void> {
    const controller = new AbortController();
    const timeoutMs = phase.timeoutMs ?? this.defaultTimeoutMs;
    let acceptingReports = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const context: BootPhaseContext = Object.freeze({
      signal: controller.signal,
      report: (localProgress: number, message?: string) => {
        if (!acceptingReports) return;
        const globalProgress = (completedWeight + clampProgress(localProgress) * phase.weight)
          / this.totalWeight;
        this.publish({
          status: "running",
          progress: globalProgress,
          message: message?.trim() || this.state.message,
          phaseId: phase.id,
          error: null,
        });
      },
    });

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        acceptingReports = false;
        controller.abort();
        reject(new BootError(
          "PHASE_TIMEOUT",
          phase.id,
          `A etapa “${phase.message}” excedeu ${timeoutMs} ms`,
        ));
      }, timeoutMs);
    });

    try {
      await Promise.race([
        Promise.resolve().then(() => phase.run(context)),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof BootError) throw error;
      controller.abort(error);
      throw new BootError(
        "PHASE_FAILED",
        phase.id,
        `Não foi possível concluir “${phase.message}”`,
        error,
      );
    } finally {
      acceptingReports = false;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private publish(next: BootSnapshot): void {
    this.state = Object.freeze({
      ...next,
      progress: Math.max(this.state.progress, clampProgress(next.progress)),
    });
    for (const listener of this.listeners) listener(this.state);
  }
}
