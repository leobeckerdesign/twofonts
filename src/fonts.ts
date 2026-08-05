export const failedFonts = new Set<string>();

const readyFamilies = new Set<string>();
const readyFaces = new Map<string, string>();
const failedFaces = new Map<string, { family: string; retryAt: number }>();
const RETRY_AFTER_MS = 30_000;
const LOAD_TIMEOUT_MS = 8_000;
export const MAX_CACHED_FONT_FAMILIES = 6;
export const MAX_CACHED_FONT_FACES = 8;
export const MAX_CONCURRENT_FONT_REQUESTS = 2;

export interface FontLoadOptions {
  signal?: AbortSignal;
}

interface FontRequest {
  family: string;
  promise: Promise<boolean>;
}

const requested = new Map<string, FontRequest>();
const familyChains = new Map<string, Promise<void>>();
const readyLinks = new Map<string, Set<HTMLLinkElement>>();
const lastUsed = new Map<string, number>();
let usageClock = 0;
let pinnedFamilies = new Set<string>();
let activeFontRequests = 0;
let signalScopeClock = 0;
const signalScopes = new WeakMap<AbortSignal, number>();

interface ScheduledFontRequest {
  signal?: AbortSignal;
  run: () => Promise<boolean>;
  resolve: (result: boolean) => void;
  started: boolean;
  cancelled: boolean;
  cleanup: () => void;
}

const fontRequestQueue: ScheduledFontRequest[] = [];

function pumpFontRequests(): void {
  while (activeFontRequests < MAX_CONCURRENT_FONT_REQUESTS) {
    const job = fontRequestQueue.shift();
    if (!job) return;
    if (job.cancelled || job.signal?.aborted) {
      job.cleanup();
      job.resolve(false);
      continue;
    }

    job.started = true;
    job.cleanup();
    activeFontRequests += 1;
    void job.run().then(job.resolve, () => job.resolve(false)).finally(() => {
      activeFontRequests -= 1;
      pumpFontRequests();
    });
  }
}

function scheduleFontRequest(
  run: () => Promise<boolean>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const job: ScheduledFontRequest = {
      run,
      signal,
      resolve: finish,
      started: false,
      cancelled: false,
      cleanup: () => undefined,
    };
    const cancel = (): void => {
      // Once started, performFontLoad owns the signal and removes the active
      // stylesheet immediately. This handler only removes queued work.
      if (job.started || job.cancelled) return;
      job.cancelled = true;
      const index = fontRequestQueue.indexOf(job);
      if (index >= 0) fontRequestQueue.splice(index, 1);
      job.cleanup();
      finish(false);
    };
    job.cleanup = (): void => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    fontRequestQueue.push(job);
    pumpFontRequests();
  });
}

export function isFontReady(family: string): boolean {
  return readyFamilies.has(family.trim());
}

function requestScope(signal?: AbortSignal): string {
  if (!signal) return "foreground";
  let scope = signalScopes.get(signal);
  if (scope === undefined) {
    signalScopeClock += 1;
    scope = signalScopeClock;
    signalScopes.set(signal, scope);
  }
  return `signal:${scope}`;
}

function touchFamily(family: string): void {
  usageClock += 1;
  lastUsed.set(family, usageClock);
}

function forgetFamily(family: string): void {
  for (const link of readyLinks.get(family) ?? []) link.remove();
  readyLinks.delete(family);
  readyFamilies.delete(family);
  lastUsed.delete(family);
  for (const [face, owner] of readyFaces) {
    if (owner === family) readyFaces.delete(face);
  }
  for (const [face, failure] of failedFaces) {
    if (failure.family === family) failedFaces.delete(face);
  }
}

function enforceFontBudget(): void {
  const faceCount = (): number => [...readyLinks.values()]
    .reduce((total, links) => total + links.size, 0);
  while (
    readyFamilies.size > MAX_CACHED_FONT_FAMILIES ||
    faceCount() > MAX_CACHED_FONT_FACES
  ) {
    const candidate = [...readyFamilies]
      .filter((family) => {
        if (pinnedFamilies.has(family)) return false;
        return ![...requested.values()].some((request) => request.family === family);
      })
      .sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0))[0];
    if (!candidate) return;
    forgetFamily(candidate);
  }
}

/** Active specimen families survive the small LRU used by background warmup. */
export function pinFontFamilies(families: Iterable<string>): void {
  pinnedFamilies = new Set(
    [...families].map((family) => family.trim()).filter((family) => family.length > 0),
  );
  for (const family of pinnedFamilies) touchFamily(family);
  enforceFontBudget();
}

function normalizedWeight(weight: number): number {
  return Number.isFinite(weight) && weight >= 1 && weight <= 1_000
    ? Math.round(weight)
    : 400;
}

function normalizedText(text?: string): string | undefined {
  return text && text.length > 0 ? text.slice(0, 1_000) : undefined;
}

function descriptorFamily(family: string): string {
  return family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function fontCssUrl(family: string, weight = 400, text?: string): string {
  const encodedFamily = encodeURIComponent(family.trim()).replace(/%20/g, "+");
  let url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${normalizedWeight(weight)}&display=swap`;
  const sample = normalizedText(text);
  if (sample) url += `&text=${encodeURIComponent(sample)}`;
  return url;
}

function performFontLoad(
  normalizedFamily: string,
  faceWeight: number,
  sample: string | undefined,
  faceKey: string,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let link: HTMLLinkElement | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = (success: boolean, cancelled = false): void => {
      if (settled) return;
      settled = true;

      if (timeoutId !== null) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      if (link) {
        link.onload = null;
        link.onerror = null;
        if (!success) link.remove();
      }

      if (success) {
        readyFaces.set(faceKey, normalizedFamily);
        failedFaces.delete(faceKey);
        readyFamilies.add(normalizedFamily);
        if (link) {
          const links = readyLinks.get(normalizedFamily) ?? new Set<HTMLLinkElement>();
          links.add(link);
          readyLinks.set(normalizedFamily, links);
        }
        touchFamily(normalizedFamily);
        failedFonts.delete(normalizedFamily);
      } else if (!cancelled) {
        failedFaces.set(faceKey, {
          family: normalizedFamily,
          retryAt: Date.now() + RETRY_AFTER_MS,
        });
        if (!readyFamilies.has(normalizedFamily)) failedFonts.add(normalizedFamily);
      }

      resolve(success);
    };

    const onAbort = (): void => finish(false, true);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fontCssUrl(normalizedFamily, faceWeight, sample);
      link.onerror = () => finish(false);
      link.onload = async () => {
        try {
          const descriptor = `${faceWeight} 16px "${descriptorFamily(normalizedFamily)}"`;
          const checkText = sample ?? "aegnRQ";
          await document.fonts.load(descriptor, checkText);
          // A Promise rejeita se a face correspondente falhar. Alguns browsers
          // resolvem com [] ao deduplicar regras unicode-range da mesma família;
          // o onload da folha confirma que a regra CSS foi registrada.
          finish(true);
        } catch {
          finish(false);
        }
      };

      timeoutId = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
      document.head.appendChild(link);
    } catch {
      finish(false);
    }
  });
}

/**
 * Injeta o stylesheet e resolve true quando a face está realmente utilizável.
 * Requests idênticos são deduplicados; faces da mesma família são serializadas
 * para evitar corridas entre o subset do mapa e a face completa do specimen.
 */
export function loadFont(
  family: string,
  weight = 400,
  text?: string,
  options: FontLoadOptions = {},
): Promise<boolean> {
  const normalizedFamily = family.trim();
  if (normalizedFamily.length === 0 || normalizedFamily.length > 200) {
    return Promise.resolve(false);
  }

  const faceWeight = normalizedWeight(weight);
  const sample = normalizedText(text);
  if (options.signal?.aborted) return Promise.resolve(false);

  const faceKey = JSON.stringify([normalizedFamily, faceWeight, sample ?? null]);
  const now = Date.now();
  if (readyFaces.has(faceKey)) {
    touchFamily(normalizedFamily);
    return Promise.resolve(true);
  }
  const failure = failedFaces.get(faceKey);
  if (failure && now < failure.retryAt) return Promise.resolve(false);
  if (failure) failedFaces.delete(faceKey);

  // Cancellable warmups are deduplicated only inside their own fill. A
  // foreground specimen request therefore never inherits an obsolete signal.
  const key = JSON.stringify([faceKey, requestScope(options.signal)]);
  const hit = requested.get(key);
  if (hit) return hit.promise;

  const record: FontRequest = {
    family: normalizedFamily,
    promise: Promise.resolve(false),
  };
  const previous = familyChains.get(normalizedFamily) ?? Promise.resolve();
  const promise = previous
    .catch(() => undefined)
    .then(() => {
      if (options.signal?.aborted) return false;
      if (readyFaces.has(faceKey)) {
        touchFamily(normalizedFamily);
        return true;
      }
      return scheduleFontRequest(
        () => performFontLoad(
          normalizedFamily,
          faceWeight,
          sample,
          faceKey,
          options.signal,
        ),
        options.signal,
      );
    });
  record.promise = promise;
  requested.set(key, record);

  const clearRequest = (): void => {
    if (requested.get(key) === record) requested.delete(key);
    enforceFontBudget();
  };
  void promise.then(clearRequest, clearRequest);

  const tail = promise.then(() => undefined, () => undefined);
  familyChains.set(normalizedFamily, tail);
  void tail.then(() => {
    if (familyChains.get(normalizedFamily) === tail) {
      familyChains.delete(normalizedFamily);
    }
  });

  return promise;
}
