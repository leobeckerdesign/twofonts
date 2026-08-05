"""Etapa 3 — extrai features visuais das grades renderizadas com DINOv2 (GPU).

Extractor fixo, sem treino — mesma filosofia do fontjoy (que usou VGG-era CNN).
DINOv2 ViT-S/14: 384 dims por imagem via CLS token.
"""
import json

import numpy as np
import torch
from PIL import Image
from tqdm import tqdm

from common import FEATURES_NPZ, RENDERS_DIR

IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
IMAGENET_STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
BATCH = 64


def load_batch(paths):
    imgs = []
    for p in paths:
        arr = torch.from_numpy(np.asarray(Image.open(p).convert("RGB"))).float() / 255.0
        imgs.append((arr.permute(2, 0, 1) - IMAGENET_MEAN) / IMAGENET_STD)
    return torch.stack(imgs)


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14")
    model.eval().to(device)

    paths = sorted(RENDERS_DIR.glob("*.png"))
    feats = []
    with torch.inference_mode():
        for i in tqdm(range(0, len(paths), BATCH), desc="extract"):
            batch = load_batch(paths[i : i + BATCH]).to(device)
            feats.append(model(batch).cpu().numpy())
    features = np.concatenate(feats)
    # slugs como array unicode (<U) — dispensa pickle na leitura
    slugs = np.array([p.stem for p in paths])
    np.savez_compressed(FEATURES_NPZ, features=features, slugs=slugs)
    print(f"{features.shape} features ({device}) -> {FEATURES_NPZ}")


if __name__ == "__main__":
    main()
