"""Build a single browser-friendly glyph atlas from the cached font renders.

The atlas follows the exact order of ``public/fonts-map.json``. Runtime code can
therefore address a preview by the entry index without shipping another lookup
table. Source renders stay in ``pipeline/data`` and are intentionally ignored;
only the compact WebP is a product asset.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent.parent
MAP_PATH = ROOT / "public" / "fonts-map.json"
RENDERS_DIR = ROOT / "pipeline" / "data" / "renders"
COLUMNS = 43
OUTPUTS = (
    (ROOT / "public" / "font-atlas.webp", 72),
    (ROOT / "public" / "font-atlas-compact.webp", 47),
)


def slug(family: str) -> str:
    normalized = unicodedata.normalize("NFKD", family).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", normalized).strip("-").lower()


def alpha_preview(path: Path, tile_size: int) -> Image.Image:
    source = Image.open(path).convert("L")
    inset = max(5, round(tile_size * 0.11))
    source.thumbnail((tile_size - inset, tile_size - inset), Image.Resampling.LANCZOS)

    alpha = ImageOps.invert(source)
    tile = Image.new("RGBA", (tile_size, tile_size), (255, 255, 255, 0))
    glyph = Image.new("RGBA", source.size, (242, 240, 234, 255))
    glyph.putalpha(alpha)
    tile.alpha_composite(
        glyph,
        ((tile_size - source.width) // 2, (tile_size - source.height) // 2),
    )
    return tile


def build(entries: list[dict[str, object]], output_path: Path, tile_size: int) -> None:
    rows = math.ceil(len(entries) / COLUMNS)
    atlas = Image.new(
        "RGBA",
        (COLUMNS * tile_size, rows * tile_size),
        (0, 0, 0, 0),
    )

    missing: list[str] = []
    for index, entry in enumerate(entries):
        family = entry["family"]
        render_path = RENDERS_DIR / f"{slug(family)}.png"
        if not render_path.exists():
            missing.append(family)
            continue

        tile = alpha_preview(render_path, tile_size)
        x = index % COLUMNS * tile_size
        y = index // COLUMNS * tile_size
        atlas.alpha_composite(tile, (x, y))

    atlas.save(output_path, "WEBP", lossless=True, method=6)
    size_kib = output_path.stat().st_size / 1024
    print(
        f"{output_path.name}: {len(entries) - len(missing)}/{len(entries)} previews, "
        f"{atlas.width}x{atlas.height}, {size_kib:.1f} KiB"
    )
    if missing:
        print(f"missing ({len(missing)}): {', '.join(missing[:10])}")


def main() -> None:
    entries = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    for output_path, tile_size in OUTPUTS:
        build(entries, output_path, tile_size)


if __name__ == "__main__":
    main()
