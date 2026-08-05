"""Etapa 1 — baixa o catálogo completo do Google Fonts (endpoint público, sem key).

Emite catalog.json: [{family, category, weights, subsets}] apenas para famílias
com subset latin (fontes de símbolo/emoji ficam de fora).
"""
import json
import sys

import requests

from common import CATALOG_JSON, METADATA_URL


def main(limit: int | None = None):
    resp = requests.get(METADATA_URL, timeout=60)
    resp.raise_for_status()
    # O endpoint prefixa a resposta com )]}' contra XSSI
    payload = json.loads(resp.text.lstrip(")]}'\n"))
    families = []
    for fam in payload["familyMetadataList"]:
        subsets = fam.get("subsets", [])
        if "latin" not in subsets:
            continue
        weights = sorted({int(k.rstrip("i")) for k in fam.get("fonts", {})})
        families.append({
            "family": fam["family"],
            "category": fam.get("category", ""),
            "weights": weights,
        })
    if limit:
        families = families[:limit]
    CATALOG_JSON.write_text(json.dumps(families, ensure_ascii=False, indent=1))
    print(f"{len(families)} familias latin no catalogo -> {CATALOG_JSON}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
