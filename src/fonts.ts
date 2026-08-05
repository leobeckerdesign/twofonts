export const failedFonts = new Set<string>();

const readyFamilies = new Set<string>();
const RETRY_AFTER_MS = 30_000;
const LOAD_TIMEOUT_MS = 8_000;

type RequestStatus = "pending" | "ready" | "failed";

interface FontRequest {
  promise: Promise<boolean>;
  status: RequestStatus;
  retryAt: number;
}

const requested = new Map<string, FontRequest>();
const familyChains = new Map<string, Promise<void>>();

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
  record: FontRequest,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
  let link: HTMLLinkElement | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const finish = (success: boolean): void => {
    if (settled) return;
    settled = true;

    if (timeoutId !== null) clearTimeout(timeoutId);
    if (link) {
      link.onload = null;
      link.onerror = null;
      if (!success) link.remove();
    }

    if (success) {
      record.status = "ready";
      readyFamilies.add(normalizedFamily);
      failedFonts.delete(normalizedFamily);
    } else {
      record.status = "failed";
      record.retryAt = Date.now() + RETRY_AFTER_MS;
      if (!readyFamilies.has(normalizedFamily)) failedFonts.add(normalizedFamily);
    }

    resolve(success);
  };

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
): Promise<boolean> {
  const normalizedFamily = family.trim();
  if (normalizedFamily.length === 0 || normalizedFamily.length > 200) {
    return Promise.resolve(false);
  }

  const faceWeight = normalizedWeight(weight);
  const sample = normalizedText(text);
  const key = `${normalizedFamily}|${faceWeight}|${sample ?? ""}`;
  const now = Date.now();
  const hit = requested.get(key);
  if (hit && (hit.status !== "failed" || now < hit.retryAt)) return hit.promise;

  const record: FontRequest = {
    promise: Promise.resolve(false),
    status: "pending",
    retryAt: 0,
  };
  const previous = familyChains.get(normalizedFamily) ?? Promise.resolve();
  const promise = previous
    .catch(() => undefined)
    .then(() => performFontLoad(normalizedFamily, faceWeight, sample, record));
  record.promise = promise;
  requested.set(key, record);

  const tail = promise.then(() => undefined, () => undefined);
  familyChains.set(normalizedFamily, tail);
  void tail.then(() => {
    if (familyChains.get(normalizedFamily) === tail) {
      familyChains.delete(normalizedFamily);
    }
  });

  return promise;
}
