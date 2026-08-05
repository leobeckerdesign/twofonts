"""Etapa 4 — PCA 200d + UMAP 2D e emissão do fonts-map.json final."""
import json

import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from common import CATALOG_JSON, FEATURES_NPZ, OUTPUT_JSON
from render_glyphs import slug

PCA_DIMS = 200


def main():
    data = np.load(FEATURES_NPZ)  # arrays numéricos + unicode; sem pickle
    features, slugs = data["features"], list(data["slugs"])
    catalog = {slug(f["family"]): f for f in json.loads(CATALOG_JSON.read_text())}

    scaled = StandardScaler().fit_transform(features)
    n_dims = min(PCA_DIMS, *scaled.shape)
    vecs = PCA(n_components=n_dims, random_state=42).fit_transform(scaled)

    import umap  # import tardio: umap-learn é lento para carregar

    xy = umap.UMAP(n_neighbors=15, min_dist=0.1, random_state=42).fit_transform(vecs)
    xy = (xy - xy.min(axis=0)) / (xy.max(axis=0) - xy.min(axis=0))

    entries = []
    for i, s in enumerate(slugs):
        fam = catalog.get(s)
        if not fam:
            continue
        entries.append({
            "family": fam["family"],
            "category": fam["category"],
            "weights": fam["weights"],
            "v": [round(float(v), 3) for v in vecs[i]],
            "x": round(float(xy[i][0]), 4),
            "y": round(float(xy[i][1]), 4),
        })
    OUTPUT_JSON.write_text(json.dumps(entries, ensure_ascii=False))
    kb = OUTPUT_JSON.stat().st_size / 1024
    print(f"{len(entries)} familias, {n_dims} dims -> {OUTPUT_JSON} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
