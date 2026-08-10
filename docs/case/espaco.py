"""Projeta o espaco de embeddings das fontes em 2D para a pagina do case.

Le o artefato intermediario do pipeline (pipeline/data/variants.json) e aplica a
MESMA regra de elegibilidade do build_pairs.py: sem Noto, so script latino, e
apenas o peso regular de cada familia, que e a identidade da familia.

Saida: data/space.json, versionado no repo porque pipeline/data/ e ignorado pelo
git. Sem ele, reconstruir a pagina exigiria rodar o pipeline inteiro na GPU.

    python docs/case/espaco.py
"""
import json
from pathlib import Path

import numpy as np
import umap

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "data" / "space.json"

variants = json.loads((ROOT / "pipeline/data/variants.json").read_text(encoding="utf-8"))
catalog = {f["family"]: f for f in json.loads((ROOT / "pipeline/data/catalog.json").read_text(encoding="utf-8"))}
pairs = json.loads((ROOT / "public/pairs.json").read_text(encoding="utf-8"))
eligible_names = {f["f"] for f in pairs["fonts"]}

rows, meta = [], []
for v in variants:
    if v["role"] != "regular" or v["family"] not in eligible_names:
        continue
    rows.append(v["v"])
    meta.append((v["family"], v["category"], catalog[v["family"]].get("popularity") or 9999))

X = np.asarray(rows, dtype=np.float32)
print(f"{X.shape[0]} familias x {X.shape[1]} dims")

emb = umap.UMAP(
    n_neighbors=15, min_dist=0.12, metric="cosine", random_state=42, n_components=2
).fit_transform(X)

# normaliza para 0..1; a pagina cuida da margem no canvas
lo, hi = emb.min(0), emb.max(0)
norm = (emb - lo) / np.clip(hi - lo, 1e-9, None)

out = [
    {"f": m[0], "c": m[1], "p": int(m[2]), "x": round(float(p[0]), 4), "y": round(float(p[1]), 4)}
    for m, p in zip(meta, norm)
]
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"-> {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")

cats = {}
for o in out:
    cats[o["c"]] = cats.get(o["c"], 0) + 1
print(cats)
