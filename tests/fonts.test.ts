import { afterEach, describe, expect, it, vi } from "vitest";
import { failedFonts, fontCssUrl, loadFont } from "../src/fonts";

function stubFontDocument(): HTMLLinkElement[] {
  const appended: HTMLLinkElement[] = [];
  vi.stubGlobal("document", {
    createElement: () => ({
      rel: "",
      href: "",
      onload: null,
      onerror: null,
      remove: vi.fn(),
    } as unknown as HTMLLinkElement),
    head: {
      appendChild: (link: HTMLLinkElement) => {
        appended.push(link);
        return link;
      },
    },
    fonts: { load: vi.fn(async () => []) },
  });
  return appended;
}

afterEach(() => vi.unstubAllGlobals());

describe("fontCssUrl", () => {
  it("monta a URL css2 com peso e display=swap", () => {
    expect(fontCssUrl("Playfair Display", 700)).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap",
    );
  });

  it("anexa subset text= urlencoded quando fornecido", () => {
    expect(fontCssUrl("Lora", 400, "Aa é")).toContain("&text=Aa%20%C3%A9");
  });

  it("codifica caracteres que poderiam quebrar a query", () => {
    const url = fontCssUrl("Fonte & Outra", 400);
    expect(url).toContain("family=Fonte+%26+Outra:wght@400");
    expect(new URL(url).searchParams.getAll("family")).toHaveLength(1);
  });

  it("normaliza peso inválido e ignora subset vazio", () => {
    expect(fontCssUrl("Lora", Number.NaN, "")).toBe(
      "https://fonts.googleapis.com/css2?family=Lora:wght@400&display=swap",
    );
  });

  it("libera um slot assim que um warmup ativo é cancelado", async () => {
    const appended = stubFontDocument();
    const first = new AbortController();
    const second = new AbortController();
    const firstLoad = loadFont("Cancel Active One", 400, undefined, { signal: first.signal });
    const secondLoad = loadFont("Cancel Active Two", 400, undefined, { signal: second.signal });

    await vi.waitFor(() => expect(appended).toHaveLength(2));
    const foreground = loadFont("Foreground After Cancel", 400);
    await Promise.resolve();
    expect(appended).toHaveLength(2);

    first.abort();
    await vi.waitFor(() => expect(appended).toHaveLength(3));
    await expect(firstLoad).resolves.toBe(false);
    expect(failedFonts.has("Cancel Active One")).toBe(false);

    (appended[2].onload as (() => void) | null)?.();
    await expect(foreground).resolves.toBe(true);
    second.abort();
    await expect(secondLoad).resolves.toBe(false);
  });

  it("isola a Promise foreground do signal usado pelo warmup", async () => {
    const appended = stubFontDocument();
    const controller = new AbortController();
    const warmup = loadFont("Shared Request Isolation", 700, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(appended).toHaveLength(1));

    const foreground = loadFont("Shared Request Isolation", 700);
    controller.abort();
    await expect(warmup).resolves.toBe(false);
    await vi.waitFor(() => expect(appended).toHaveLength(2));

    (appended[1].onload as (() => void) | null)?.();
    await expect(foreground).resolves.toBe(true);
  });
});
