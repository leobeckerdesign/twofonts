"""Gera os assets embutidos da pagina: glifos e fontes como data URI.

Depende de pipeline/data/ (renders e TTFs), que e ignorado pelo git. A saida,
data/assets.json, e versionada justamente por isso: quem clonar o repo consegue
reconstruir a pagina sem refazer o pipeline.

    python docs/case/assets.py
"""
import base64
import io
import json
import re
import unicodedata
from pathlib import Path

from fontTools import subset
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RENDERS = ROOT / "pipeline/data/renders"
FONTS = ROOT / "pipeline/data/fonts"
OUT = HERE / "data" / "assets.json"

space = json.loads((HERE / "data" / "space.json").read_text(encoding="utf-8"))

# Caracteres que a pagina realmente usa. Manter enxuto e o que segura cada face
# do Geist em ~11 KB em vez dos ~100 KB do arquivo cheio.
SUBSET_TEXT = (
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789 .,:;!?'\"()[]{}/\\-+=*%&@#_<>|~^$"
    "°·→•×"
    "áàâãéêíóôõúüç"
    "ÁÀÂÃÉÊÍÓÔÕÚÜÇ"
)

# As quatro faces do Geist que a pagina declara em @font-face.
FACES = [("Geist", 300), ("Geist", 400), ("Geist", 500), ("Geist", 700)]

# Espectro deliberado de desenhos para a folha de contato da Fig. 1.
SHOWCASE = [
    "Playfair Display", "Bitter", "Azeret Mono", "Bebas Neue",
    "Lobster", "Work Sans", "Rammetto One", "Cormorant Garamond",
]

# Os quatro glifos da comparacao concorda / discorda.
PAIR_DEMO = ["Figtree", "Google Sans", "Azeret Mono", "Bitter"]

# Quantas celulas por eixo ao varrer o mapa atras das fontes-ancora.
CELLS = 5


def slug(family: str) -> str:
    s = unicodedata.normalize("NFKD", family).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()


def glyph_uri(family: str, weight: int = 400, size: int = 224) -> str | None:
    """PNG da grade de glifos, otimizado, como data URI."""
    p = RENDERS / f"{slug(family)}-{weight}.png"
    if not p.exists():
        cands = sorted(RENDERS.glob(f"{slug(family)}-*.png"))
        if not cands:
            return None
        p = cands[0]
    img = Image.open(p).convert("L")
    if size != img.width:
        img = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def font_uri(family: str, weight: int) -> str | None:
    """Subset latino em woff2, como data URI."""
    p = FONTS / f"{slug(family)}-{weight}.ttf"
    if not p.exists() and weight == 400:
        # o pipeline salvou o peso padrao sem sufixo na primeira execucao
        p = FONTS / f"{slug(family)}.ttf"
    if not p.exists():
        return None

    out = io.BytesIO()
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.desubroutinize = True
    font = subset.load_font(str(p), opts)
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(text=SUBSET_TEXT)
    subsetter.subset(font)
    subset.save_font(font, out, opts)
    return "data:font/woff2;base64," + base64.b64encode(out.getvalue()).decode()


def main() -> None:
    # Ancoras: varre o mapa em grade e pega a familia mais popular de cada celula.
    picked: dict[tuple[int, int], dict] = {}
    for s in space:
        key = (min(CELLS - 1, int(s["x"] * CELLS)), min(CELLS - 1, int(s["y"] * CELLS)))
        if key not in picked or s["p"] < picked[key]["p"]:
            picked[key] = s
    anchors = sorted(picked.values(), key=lambda s: s["p"])[:16]

    glyphs: dict[str, str] = {}
    for fam in {*SHOWCASE, *PAIR_DEMO, *[a["f"] for a in anchors]}:
        uri = glyph_uri(fam)
        if uri:
            glyphs[fam] = uri
        else:
            print("SEM RENDER:", fam)

    fonts: dict[str, str] = {}
    for fam, w in FACES:
        uri = font_uri(fam, w)
        if uri:
            fonts[f"{fam}-{w}"] = uri
            print(f"{fam} {w}: {len(uri) / 1024:.0f} KB")
        else:
            print("SEM TTF:", fam, w)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "glyphs": glyphs,
                "fonts": fonts,
                "anchors": [a["f"] for a in anchors],
                "showcase": SHOWCASE,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"{len(glyphs)} glifos, {len(fonts)} fontes -> {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size / 1024:.0f} KB)")
    print("ancoras:", ", ".join(a["f"] for a in anchors))


if __name__ == "__main__":
    main()
