from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public"
TAURI_ICONS_DIR = ROOT / "src-tauri" / "icons"

LIGHT_SVG = PUBLIC_DIR / "favicon-light.svg"
DARK_SVG = PUBLIC_DIR / "favicon-dark.svg"

PUBLIC_LIGHT_PNGS = {
    "logo.png": 512,
    "favicon-16.png": 16,
    "favicon-32.png": 32,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}

PUBLIC_DARK_PNGS = {
    "favicon-dark-16.png": 16,
    "favicon-dark-32.png": 32,
    "apple-touch-icon-dark.png": 180,
}

TAURI_PNGS = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "StoreLogo.png": 50,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
}

ICNS_SIZES = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

ICO_SIZES = [16, 32, 48, 64, 128, 256]


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
    base.save(out_path, format="ICO", sizes=[(size, size) for size in sizes])


def save_icns_from_svg(svg_path: Path, out_path: Path) -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        iconset = Path(tmpdir) / "Synapse.iconset"
        iconset.mkdir()
        for filename, size in ICNS_SIZES.items():
            render_svg_to_png(svg_path, iconset / filename, size)
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(out_path)],
            check=True,
            capture_output=True,
            text=True,
        )


def validate_visible_mark(path: Path) -> None:
    image = Image.open(path).convert("RGBA")
    if hasattr(image, "get_flattened_data"):
        pixels = list(image.get_flattened_data())
    else:
        pixels = list(image.getdata())
    opaque = [pixel for pixel in pixels if pixel[3] > 0]
    if not opaque:
        raise ValueError(f"{path} has no visible pixels")

    dark = sum(1 for r, g, b, _a in opaque if max(r, g, b) <= 30)
    light = sum(1 for r, g, b, _a in opaque if min(r, g, b) >= 200)
    total = len(opaque)
    min_pixels = max(4, int(total * 0.02))

    if dark < min_pixels or light < min_pixels:
        raise ValueError(
            f"{path} failed logo pixel audit: "
            f"dark={dark}, light={light}, required_each={min_pixels}"
        )


def validate_outputs(paths: list[Path]) -> None:
    for path in paths:
        validate_visible_mark(path)


def main() -> None:
    if not LIGHT_SVG.exists() or not DARK_SVG.exists():
        raise FileNotFoundError("favicon-light.svg and favicon-dark.svg must exist in web/public")

    # Primary favicon and app icons are generated from the light lockup.
    generated_paths: list[Path] = []
    for filename, size in PUBLIC_LIGHT_PNGS.items():
        path = PUBLIC_DIR / filename
        save_png_from_svg(LIGHT_SVG, path, size)
        generated_paths.append(path)

    favicon_ico = PUBLIC_DIR / "favicon.ico"
    save_ico_from_svg(LIGHT_SVG, favicon_ico, [16, 32, 48])
    generated_paths.append(favicon_ico)

    # Dark variants are used by explicit metadata entries where supported.
    for filename, size in PUBLIC_DARK_PNGS.items():
        path = PUBLIC_DIR / filename
        save_png_from_svg(DARK_SVG, path, size)
        generated_paths.append(path)

    # Desktop bundle icons use the same approved monochrome light lockup.
    TAURI_ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for filename, size in TAURI_PNGS.items():
        path = TAURI_ICONS_DIR / filename
        save_png_from_svg(LIGHT_SVG, path, size)
        generated_paths.append(path)

    tauri_ico = TAURI_ICONS_DIR / "icon.ico"
    save_ico_from_svg(LIGHT_SVG, tauri_ico, ICO_SIZES)
    generated_paths.append(tauri_ico)

    save_icns_from_svg(LIGHT_SVG, TAURI_ICONS_DIR / "icon.icns")

    validate_outputs(generated_paths)


if __name__ == "__main__":
    main()
