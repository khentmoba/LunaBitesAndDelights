"""Re-encode parity screenshots as lossless WebP (pixel-identical, ~half the bytes).

    python tool/parity/to_webp.py docs/evidence/parity/flutter
"""
import json
import sys
from pathlib import Path

from PIL import Image

folder = Path(sys.argv[1])
for png in sorted(folder.glob("*.png")):
    with Image.open(png) as im:
        if max(im.size) > 16383:  # WebP's hard limit; tall full-page shots stay PNG
            continue
        im.save(png.with_suffix(".webp"), "WEBP", lossless=True, method=6)
        with Image.open(png.with_suffix(".webp")) as back:
            assert back.convert("RGBA").tobytes() == im.convert("RGBA").tobytes(), png
    png.unlink()
manifest = folder / "manifest.json"
if manifest.exists():
    data = json.loads(manifest.read_text(encoding="utf-8"))
    for s in data.get("screens", []):
        if (folder / s["file"].replace(".png", ".webp")).exists():
            s["file"] = s["file"].replace(".png", ".webp")
    manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
