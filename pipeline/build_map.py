"""Etapa 4 — PCA 200d + UMAP 2D e emissão do fonts-map.json final."""
import json

import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from common import CATALOG_JSON, FEATURES_NPZ, OUTPUT_JSON
from render_glyphs import slug

PCA_DIMS = 200

# Corte de pesos: só light, regular e bold. Cada papel tem uma FAIXA, não só um
# alvo — sem isso o "light" de uma família que começa no 400 acabava sendo o
# próprio regular, e o regular escorregava para 500.
WEIGHT_BANDS = {
    "light":   (100, 350, 300),
    "regular": (351, 550, 400),
    "bold":    (600, 1000, 700),
}


def selected_weights(available: list[int]) -> dict[int, str]:
    """Mapeia peso escolhido -> papel. Papel sem peso na faixa simplesmente não existe."""
    chosen: dict[int, str] = {}
    for role, (lo, hi, target) in WEIGHT_BANDS.items():
        pool = [w for w in available if lo <= w <= hi and w not in chosen]
        if not pool:
            continue
        chosen[min(pool, key=lambda w: (abs(w - target), w))] = role
    return chosen


def main():
    data = np.load(FEATURES_NPZ)  # arrays numéricos + unicode; sem pickle
    features, slugs = data["features"], list(data["slugs"])
    catalog = {slug(f["family"]): f for f in json.loads(CATALOG_JSON.read_text())}

    scaled = StandardScaler().fit_transform(features)
    n_dims = min(PCA_DIMS, *scaled.shape)
    vecs = PCA(n_components=n_dims, random_state=42).fit_transform(scaled)

    # Papel de cada variante decidido por família, antes de varrer os slugs.
    roles = {
        s: selected_weights(f["weights"])
        for s, f in catalog.items()
    }

    entries = []
    for i, s in enumerate(slugs):
        # slug da variante = "<familia>-<peso>"; separa pelo último hífen
        base, _, weight = str(s).rpartition("-")
        fam = catalog.get(base)
        if not fam or not weight.isdigit():
            continue
        role = roles.get(base, {}).get(int(weight))
        if role is None:
            continue          # peso fora do corte light/regular/bold
        entries.append({
            "family": fam["family"],
            "weight": int(weight),
            "role": role,
            "category": fam["category"],
            "v": [round(float(v), 3) for v in vecs[i]],
        })

    OUTPUT_JSON.write_text(json.dumps(entries, ensure_ascii=False))
    kb = OUTPUT_JSON.stat().st_size / 1024
    fams = len({e["family"] for e in entries})
    print(f"{len(entries)} variantes de {fams} familias, {n_dims} dims -> {OUTPUT_JSON} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
