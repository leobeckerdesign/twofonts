"""Config e paths compartilhados do pipeline de embeddings."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "pipeline" / "data"
CATALOG_JSON = DATA / "catalog.json"
FONTS_DIR = DATA / "fonts"
RENDERS_DIR = DATA / "renders"
FEATURES_NPZ = DATA / "features.npz"
# Artefato intermediário: 3 mil vetores de 200 dims. Fica em data/ e NUNCA em
# public/, senão os 4,7 MB iriam parar no build. O site carrega só pairs.json.
OUTPUT_JSON = DATA / "variants.json"

# Grade de glifos distintivos (mesma lógica do fontjoy: letras que melhor
# discriminam o desenho — x-height, bolsas, descendentes, caps, cauda do Q)
GLYPH_ROWS = ["aeg", "nRQ"]
IMG_SIZE = 224

METADATA_URL = "https://fonts.google.com/metadata/fonts"
CSS2_URL = "https://fonts.googleapis.com/css2?family={family}"
# Cada peso é uma fonte separada, como no fontjoy original — assim o peso
# entra no vetor em vez de ser perdido na média da família.
CSS2_WEIGHT_URL = "https://fonts.googleapis.com/css2?family={family}:wght@{weight}"

for d in (DATA, FONTS_DIR, RENDERS_DIR, OUTPUT_JSON.parent):
    d.mkdir(parents=True, exist_ok=True)
