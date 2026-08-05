export const failedFonts = new Set<string>();

const requested = new Map<string, Promise<boolean>>();

export function fontCssUrl(family: string, weight = 400, text?: string): string {
  const fam = family.replace(/ /g, "+");
  let url = `https://fonts.googleapis.com/css2?family=${fam}:wght@${weight}&display=swap`;

  if (text) url += `&text=${encodeURIComponent(text)}`;

  return url;
}

/**
 * Injeta o stylesheet e resolve true quando a fonte está utilizável.
 * Fail closed: qualquer falha marca a família em failedFonts.
 */
export function loadFont(
  family: string,
  weight = 400,
  text?: string,
): Promise<boolean> {
  const key = `${family}|${weight}|${text ?? ""}`;
  const hit = requested.get(key);

  if (hit) return hit;

  const job = new Promise<boolean>((resolve) => {
    let link: HTMLLinkElement | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;

      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (link) {
        link.onload = null;
        link.onerror = null;
      }
      if (!success) failedFonts.add(family);

      resolve(success);
    };

    try {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fontCssUrl(family, weight, text);
      link.onerror = () => finish(false);
      link.onload = async () => {
        try {
          const sample = text ?? "aegnRQ";
          const descriptor = `${weight} 16px "${family}"`;

          await document.fonts.load(descriptor, sample);
          finish(document.fonts.check(descriptor, sample));
        } catch {
          finish(false);
        }
      };

      timeoutId = setTimeout(() => finish(false), 8_000);
      document.head.appendChild(link);
    } catch {
      finish(false);
    }
  });

  requested.set(key, job);
  return job;
}
