from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public"

LIGHT_SVG = PUBLIC_DIR / "favicon-light.svg"
DARK_SVG = PUBLIC_DIR / "favicon-dark.svg"


def render_svg_to_png(svg_path: Path, out_path: Path, size: int) -> None:
    subprocess.run(
        [
            "sips",
            "-s",
            "format",
            "png",
            "-z",
            str(size),
            str(size),
            str(svg_path),
            "--out",
            str(out_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def save_png_from_svg(svg_path: Path, out_path: Path, size: int) -> None:
    render_svg_to_png(svg_path, out_path, size)


def save_ico_from_svg(svg_path: Path, out_path: Path, sizes: list[int]) -> None:
    largest = max(sizes)
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_png = Path(tmpdir) / "base.png"
        render_svg_to_png(svg_path, tmp_png, largest)
        base = Image.open(tmp_png).convert("RGBA")
    resized = [base.resize((size, size), Image.Resampling.LANCZOS) for size in sizes]
    resized[0].save(
        out_path,
        format="ICO",
        sizes=[(size, size) for size in sizes],
        append_images=resized[1:],
    )


def main() -> None:
    if not LIGHT_SVG.exists() or not DARK_SVG.exists():
        raise FileNotFoundError("favicon-light.svg and favicon-dark.svg must exist in web/public")

    # Primary favicon and app icons are generated from the light lockup.
    save_png_from_svg(LIGHT_SVG, PUBLIC_DIR / "favicon-16.png", 16)
    save_png_from_svg(LIGHT_SVG, PUBLIC_DIR / "favicon-32.png", 32)
    save_ico_from_svg(LIGHT_SVG, PUBLIC_DIR / "favicon.ico", [16, 32, 48])
    save_png_from_svg(LIGHT_SVG, PUBLIC_DIR / "apple-touch-icon.png", 180)
    save_png_from_svg(LIGHT_SVG, PUBLIC_DIR / "icon-192.png", 192)
    save_png_from_svg(LIGHT_SVG, PUBLIC_DIR / "icon-512.png", 512)

    # Dark variants are used by explicit metadata entries where supported.
    save_png_from_svg(DARK_SVG, PUBLIC_DIR / "favicon-dark-16.png", 16)
    save_png_from_svg(DARK_SVG, PUBLIC_DIR / "favicon-dark-32.png", 32)
    save_png_from_svg(DARK_SVG, PUBLIC_DIR / "apple-touch-icon-dark.png", 180)


if __name__ == "__main__":
    main()
