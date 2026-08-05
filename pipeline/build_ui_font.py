"""Subset the cached IBM Plex Mono face used by the local application shell."""

from pathlib import Path

from fontTools import subset


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "pipeline" / "data" / "fonts" / "ibm-plex-mono.ttf"
OUTPUT = ROOT / "public" / "fonts" / "ibm-plex-mono-latin.woff"
UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193"
)


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"cached source font not found: {SOURCE}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    subset.main([
        str(SOURCE),
        f"--output-file={OUTPUT}",
        "--flavor=woff",
        "--layout-features=*",
        f"--unicodes={UNICODES}",
    ])
    print(f"ui font: {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
