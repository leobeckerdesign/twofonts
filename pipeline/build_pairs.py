"""Etapa 5 — pré-computa os pares e emite o JSON que o site realmente carrega.

O fonts-map.json tem 3 mil vetores de 200 dimensões (~4,7 MB): pesado demais
para o browser. Como o usuário nunca escolhe fontes soltas — ele navega pares
que o algoritmo propôs — dá para rodar a métrica aqui e enviar só o resultado.

O par é SIMÉTRICO: as duas fontes aparecem nos dois papéis ao longo dos cards.
O contraste governa tudo — escolha do par, contraste de peso e, no runtime,
o contraste de medida.
"""
import json
from collections import defaultdict

import numpy as np

from common import CATALOG_JSON, OUTPUT_JSON, ROOT

PAIRS_JSON = ROOT / "public" / "pairs.json"

# Faixas do slider. Em cada uma, que papel cada lado do par assume — é aqui
# que "contraste de peso" vira regra: harmonia usa dois regulares, contraste
# máximo opõe bold e light.
# Dez cortes: um por marcação do slider. O peso acompanha o corte — harmonia
# usa dois regulares, o meio opõe bold a regular, o extremo bold a light.
BUCKETS = [
    (round(i / 9, 3), *roles)
    for i, roles in enumerate([
        ("regular", "regular"),
        ("regular", "regular"),
        ("regular", "regular"),
        ("bold", "regular"),
        ("bold", "regular"),
        ("bold", "regular"),
        ("bold", "light"),
        ("bold", "light"),
        ("bold", "light"),
        ("bold", "light"),
    ])
]

PAIRS_PER_BUCKET = 400
MAX_APPEARANCES = 4          # diversidade: nenhuma família domina a lista
BODY_FRIENDLY = {"Sans Serif", "Serif", "Monospace"}

# Em harmonia a métrica maximiza semelhança, e o topo vira "ache as fontes mais
# idênticas possíveis": famílias-irmãs de script (Tiro Tamil/Telugu, Noto Sans X,
# Ysabeau/Ysabeau Office) têm latinos iguais e dão similaridade 1.0000 exata.
# Um par precisa de alguma diferença para existir. Inter+Figtree, legitimamente
# parecidos, ficam em 0.95 — o teto passa acima deles e abaixo dos clones.
MAX_SIMILARITY = 0.965

# Famílias-irmãs escapam do teto por pouco (Hind + Hind Mysuru, Kaisei Opti +
# Kaisei Decol): mesmo desenho para outro script. Compartilhar a primeira
# palavra só condena quando também são parecidas — assim Roboto + Roboto Slab
# (0.65) sobrevive, que é pareamento de superfamília, técnica legítima.
SIBLING_SIMILARITY = 0.80

# Empurra o ranking para tipografias que as pessoas reconhecem. Peso baixo de
# propósito: corrige a tendência do catálogo, não substitui a métrica.
POPULARITY_WEIGHT = 0.12


def body_penalty(category: str) -> float:
    return 0.0 if category in BODY_FRIENDLY else 0.15


def main():
    variants = json.loads(OUTPUT_JSON.read_text(encoding="utf-8"))
    catalog = {f["family"]: f for f in json.loads(CATALOG_JSON.read_text(encoding="utf-8"))}

    # Fora: as ~200 Noto <script> (latino idêntico entre si) e as famílias cujo
    # script primário não é latino — nelas o latino costuma ser fallback genérico.
    def eligible(name: str) -> bool:
        meta = catalog.get(name)
        return bool(meta) and not meta["isNoto"] and meta["primaryScript"] in ("", "Latn")

    fams = defaultdict(lambda: {"faces": {}, "vecs": {}})
    for v in variants:
        if not eligible(v["family"]):
            continue
        f = fams[v["family"]]
        f["category"] = v["category"]
        f["faces"][v["role"]] = v["weight"]
        f["vecs"][v["role"]] = v["v"]

    names = sorted(fams)
    print(f"{len(names)} familias elegiveis de {len(catalog)} no catalogo")
    index = {n: i for i, n in enumerate(names)}
    cats = [fams[n]["category"] for n in names]
    # Penalidade de corpo do par = a MENOR das duas. Basta uma fonte servir
    # para texto corrido; a outra pode ser display que os cards a usam em título.
    pen = np.array([body_penalty(c) for c in cats])

    def matrix(role: str) -> np.ndarray:
        """Vetores no papel pedido, caindo para regular quando a família não o tem."""
        rows = []
        for n in names:
            v = fams[n]["vecs"]
            rows.append(v.get(role) or v.get("regular") or next(iter(v.values())))
        return np.asarray(rows, dtype=np.float32)

    # Identidade da família = seu regular, independente do papel que a faixa pede.
    ident = matrix("regular")
    ident = ident / np.clip(np.linalg.norm(ident, axis=1, keepdims=True), 1e-9, None)

    # Popularidade normalizada: 1.0 para a mais usada do catálogo, ~0 para a cauda.
    ranks = np.array([catalog[n].get("popularity") or 10_000 for n in names], dtype=np.float32)
    pop = 1.0 - (np.argsort(np.argsort(ranks)) / max(1, len(names) - 1))

    first_word = [n.split()[0].lower() for n in names]
    same_first = np.array(first_word)[:, None] == np.array(first_word)[None, :]

    buckets = []
    for contrast, role_a, role_b in BUCKETS:
        A, B = matrix(role_a), matrix(role_b)
        norm_a = np.linalg.norm(A, axis=1)
        norm_b = np.linalg.norm(B, axis=1)

        best = []
        for i in range(len(names)):
            prod = B * A[i]                       # produto elemento a elemento
            pos = np.clip(prod, 0, None).sum(1)   # onde as formas concordam
            neg = -np.clip(prod, None, 0).sum(1)  # onde discordam
            denom = norm_a[i] * norm_b
            denom[denom == 0] = 1
            score = ((1 - contrast) * pos + contrast * neg) / denom
            score -= np.minimum(pen[i], pen)      # basta uma servir para corpo
            score += POPULARITY_WEIGHT * (pop[i] + pop) / 2      # viés de curadoria

            sim = ident @ ident[i]
            score[i] = -np.inf                    # nunca parear consigo mesma
            score[sim > MAX_SIMILARITY] = -np.inf                # clones
            score[same_first[i] & (sim > SIBLING_SIMILARITY)] = -np.inf  # irmãs
            for j in np.argpartition(-score, 40)[:40]:
                if i < j:
                    best.append((float(score[j]), i, int(j)))

        best.sort(reverse=True)
        used = defaultdict(int)
        pairs = []
        for _, i, j in best:
            if used[i] >= MAX_APPEARANCES or used[j] >= MAX_APPEARANCES:
                continue
            used[i] += 1
            used[j] += 1
            pairs.append([i, j])
            if len(pairs) >= PAIRS_PER_BUCKET:
                break

        buckets.append({"c": contrast, "roles": [role_a, role_b], "pairs": pairs})
        print(f"contraste {contrast:.2f} ({role_a}/{role_b}): {len(pairs)} pares")

    out = {
        "version": 1,
        "fonts": [
            {"f": n, "c": fams[n]["category"], "w": fams[n]["faces"]}
            for n in names
        ],
        "buckets": buckets,
    }
    PAIRS_JSON.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    kb = PAIRS_JSON.stat().st_size / 1024
    print(f"{len(names)} familias, {len(buckets)} faixas -> {PAIRS_JSON} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
