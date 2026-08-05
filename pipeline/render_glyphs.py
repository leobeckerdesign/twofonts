"""Etapa 2 — baixa o TTF regular de cada família e renderiza a grade de glifos.

Réplica da lógica do fontjoy: imagem 224x224, preto sobre branco, grade de
letras tipograficamente distintivas. Uma imagem por família (peso regular ou
o mais próximo). Downloads e renders são cacheados; re-execução é incremental.
"""
import json
import re
import sys
import unicodedata

import requests
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
from tqdm import tqdm

from common import CATALOG_JSON, CSS2_URL, FONTS_DIR, GLYPH_ROWS, IMG_SIZE, RENDERS_DIR

# Sem User-Agent moderno o css2 responde com format('truetype') em vez de woff2
HEADERS = {"User-Agent": "python-requests"}
TTF_RE = re.compile(r"url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)")
REQUIRED_GLYPHS = set("".join(GLYPH_ROWS))


def slug(family: str) -> str:
    s = unicodedata.normalize("NFKD", family).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()


def download_ttf(family: str) -> "Path | None":
    path = FONTS_DIR / f"{slug(family)}.ttf"
    if path.exists():
        return path
    url = CSS2_URL.format(family=family.replace(" ", "+"))
    try:
        css = requests.get(url, headers=HEADERS, timeout=30)
        css.raise_for_status()
        m = TTF_RE.search(css.text)
        if not m:
            return None
        ttf = requests.get(m.group(1), timeout=60)
        ttf.raise_for_status()
        path.write_bytes(ttf.content)
        return path
    except requests.RequestException:
        return None


def has_glyphs(path) -> bool:
    try:
        font = TTFont(path, fontNumber=0)
        cmap = font.getBestCmap() or {}
        return all(ord(ch) in cmap for ch in REQUIRED_GLYPHS)
    except Exception:
        return False


def render(path, out):
    """Grade de glifos centralizada, escalada para ocupar ~80% do canvas."""
    rows = GLYPH_ROWS
    probe_size = 100
    font = ImageFont.truetype(str(path), probe_size)
    widths, heights = [], []
    for row in rows:
        l, t, r, b = font.getbbox(row)
        widths.append(r - l)
        heights.append(b - t)
    grid_w, grid_h = max(widths), sum(heights) * 1.15
    scale = (IMG_SIZE * 0.8) / max(grid_w, grid_h)
    font = ImageFont.truetype(str(path), int(probe_size * scale))

    img = Image.new("L", (IMG_SIZE, IMG_SIZE), 255)
    draw = ImageDraw.Draw(img)
    boxes = [font.getbbox(row) for row in rows]
    total_h = sum(b - t for _, t, _, b in boxes) * 1.15
    y = (IMG_SIZE - total_h) / 2
    for row, (l, t, r, b) in zip(rows, boxes):
        x = (IMG_SIZE - (r - l)) / 2 - l
        draw.text((x, y - t), row, font=font, fill=0)
        y += (b - t) * 1.15
    img.save(out)


def process(fam) -> str | None:
    """Baixa e renderiza uma família; retorna o nome se falhou."""
    name = fam["family"]
    out = RENDERS_DIR / f"{slug(name)}.png"
    if out.exists():
        return None
    ttf = download_ttf(name)
    if ttf is None or not has_glyphs(ttf):
        return name
    try:
        render(ttf, out)
        return None
    except Exception:
        return name


def main():
    from concurrent.futures import ThreadPoolExecutor

    catalog = json.loads(CATALOG_JSON.read_text())
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(tqdm(pool.map(process, catalog), total=len(catalog), desc="render"))
    skipped = [r for r in results if r]
    ok = len(catalog) - len(skipped)
    print(f"renderizadas: {ok} | puladas: {len(skipped)}")
    if skipped:
        (RENDERS_DIR.parent / "skipped.json").write_text(json.dumps(skipped, indent=1))


if __name__ == "__main__":
    main()
