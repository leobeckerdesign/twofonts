export const ATLAS_URL = "/font-atlas.webp";
export const ATLAS_COMPACT_URL = "/font-atlas-compact.webp";
export const ATLAS_TILE_SIZE = 72;
export const ATLAS_COMPACT_TILE_SIZE = 47;
export const ATLAS_COLUMNS = 43;
export const ATLAS_ROWS = 43;

export interface AtlasSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FontAtlasAsset {
  url: string;
  tileSize: number;
}

export const DEFAULT_ATLAS: FontAtlasAsset = {
  url: ATLAS_URL,
  tileSize: ATLAS_TILE_SIZE,
};

export const COMPACT_ATLAS: FontAtlasAsset = {
  url: ATLAS_COMPACT_URL,
  tileSize: ATLAS_COMPACT_TILE_SIZE,
};

export function preferredFontAtlas(): FontAtlasAsset {
  const compact = typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;
  return compact ? COMPACT_ATLAS : DEFAULT_ATLAS;
}

export function atlasSourceRect(index: number, tileSize = ATLAS_TILE_SIZE): AtlasSourceRect {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  return {
    x: safeIndex % ATLAS_COLUMNS * tileSize,
    y: Math.floor(safeIndex / ATLAS_COLUMNS) * tileSize,
    width: tileSize,
    height: tileSize,
  };
}

export function atlasBackgroundPosition(index: number): { x: string; y: string } {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  const column = safeIndex % ATLAS_COLUMNS;
  const row = Math.floor(safeIndex / ATLAS_COLUMNS);
  return {
    x: `${column / (ATLAS_COLUMNS - 1) * 100}%`,
    y: `${row / (ATLAS_ROWS - 1) * 100}%`,
  };
}

export class FontAtlas {
  constructor(
    readonly image: HTMLImageElement,
    readonly tileSize = ATLAS_TILE_SIZE,
  ) {}

  draw(
    context: CanvasRenderingContext2D,
    index: number,
    x: number,
    y: number,
    size: number,
  ): void {
    const source = atlasSourceRect(index, this.tileSize);
    context.drawImage(
      this.image,
      source.x,
      source.y,
      source.width,
      source.height,
      x,
      y,
      size,
      size,
    );
  }
}

const atlasPromises = new Map<string, Promise<FontAtlas>>();

/** Loads and decodes the sprite once so navigation never pays decode cost. */
export function loadFontAtlas(
  asset: FontAtlasAsset = DEFAULT_ATLAS,
  signal?: AbortSignal,
): Promise<FontAtlas> {
  const cached = atlasPromises.get(asset.url);
  if (cached && !signal) return cached;

  const request = new Promise<FontAtlas>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";

    const cleanup = (): void => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (message: string): void => {
      cleanup();
      reject(new Error(message));
    };
    const onAbort = (): void => {
      image.src = "";
      fail("Carregamento do atlas cancelado");
    };

    image.onload = () => {
      void image.decode()
        .catch(() => undefined)
        .then(() => {
          cleanup();
          resolve(new FontAtlas(image, asset.tileSize));
        });
    };
    image.onerror = () => fail("Não foi possível carregar o atlas tipográfico");
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.src = asset.url;
  });

  if (!signal) atlasPromises.set(asset.url, request);
  return request;
}
