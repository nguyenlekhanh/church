#!/usr/bin/env python3
"""
Christian Prayer Live — licensed imagery fetcher.

Downloads freely licensed, commercially usable Christian themed images from
Wikimedia Commons, optimises them for a 1080x1920 (9:16) livestream, and writes
public/assets/christian/asset-manifest.json with source + license + attribution.

Only images whose machine readable license is one of ALLOWED_LICENSES are used.
Commercial livestream broadcasting is permitted by all licenses in that list.

Usage (Windows):
    .venv\\Scripts\\python.exe scripts\\fetch_christian_assets.py
    .venv\\Scripts\\python.exe scripts\\fetch_christian_assets.py --contact-sheet
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover
    print("Pillow is required: uv pip install pillow", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parent.parent
ASSET_ROOT = ROOT / "public" / "assets" / "christian"
MANIFEST = ASSET_ROOT / "asset-manifest.json"
API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "ChristianPrayerLive/1.0 (asset fetch script; contact: local project)"

# Licenses that allow commercial use of the artwork in a livestream broadcast.
ALLOWED_LICENSES = (
    "cc0",
    "public domain",
    "pdm",
    "cc by 4.0",
    "cc by-sa 4.0",
    "cc by 3.0",
    "cc by-sa 3.0",
    "cc by 2.0",
    "cc by-sa 2.0",
    "cc by 2.5",
    "cc by-sa 2.5",
    "cc by 1.0",
    "cc by-sa 1.0",
    "attribution",
)

# Categories requested in the project brief.
CATEGORY_QUERIES = {
    "church": [
        "church interior nave altar",
        "cathedral interior arches",
        "church pews sunlight interior",
    ],
    "cross": [
        "altar cross church",
        "illuminated cross at night",
        "crucifix church interior",
    ],
    "bible": [
        "open bible on table",
        "holy bible candlelight",
        "bible book closeup",
    ],
    "candles": [
        "prayer candles church",
        "votive candles burning",
        "candle flame dark background",
    ],
    "jesus": [
        "Jesus Christ painting",
        "Christ in art public domain painting",
    ],
    "backgrounds": [
        "golden sunrise clouds",
        "peaceful sky sunrise landscape",
        "sunlight rays forest morning",
        "calm lake sunrise",
    ],
    "overlays": [
        "bokeh lights gold background",
        "light rays texture overlay",
    ],
}

BLOCKED_NAME_RE = re.compile(
    r"(logo|coat[_ ]of[_ ]arms|map|diagram|chart|icon|seal|flag|graph|document|"
    r"scan|page|text|signature|stamp|plaque|statue[_ ]of[_ ]liberty)",
    re.IGNORECASE,
)

# Reviewed manually on the contact sheet: off-topic, portrait-of-a-person, or
# manuscript images that are not suitable for a prayer livestream backdrop.
REVIEWED_REJECT_RE = re.compile(
    r"(soyuz|spacecraft|landing|evangeliarium|marie[-_ ]leszczy|kulturen|"
    r"young[_ ]woman|bronze[_ ]age|cozy[_ ]table|orchid|purple[_ ]hair|"
    r"bulla|portrait[_ ]of[_ ]a[_ ]woman|capuchin)",
    re.IGNORECASE,
)

GENERATED_OVERLAYS = [
    "overlays/gold-bokeh-particles.png",
    "overlays/golden-light-rays.png",
    "overlays/soft-vignette.png",
]


def api_get(params: dict, retries: int = 3) -> dict:
    params = {**params, "format": "json", "formatversion": "2"}
    url = f"{API}?{urllib.parse.urlencode(params)}"
    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Commons API failed: {last_error}")


def strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def search_files(query: str, limit: int = 25) -> list[dict]:
    data = api_get(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"filetype:bitmap {query}",
            "gsrnamespace": "6",
            "gsrlimit": str(limit),
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": "1800",
        }
    )
    return data.get("query", {}).get("pages", []) or []


def license_ok(meta: dict) -> tuple[bool, str, str]:
    short = (meta.get("LicenseShortName", {}).get("value") or "").strip()
    url = (meta.get("LicenseUrl", {}).get("value") or "").strip()
    lowered = short.lower()
    if not short:
        return False, short, url
    if lowered in ALLOWED_LICENSES:
        return True, short, url
    for allowed in ("cc0", "public domain"):
        if lowered.startswith(allowed):
            return True, short, url
    for allowed in ("cc by 4.0", "cc by-sa 4.0", "cc by 3.0", "cc by-sa 3.0", "cc by 2.0", "cc by-sa 2.0"):
        if lowered.startswith(allowed):
            return True, short, url
    return False, short, url


def slugify(title: str, category: str, index: int) -> str:
    base = re.sub(r"^file:", "", title, flags=re.IGNORECASE)
    base = re.sub(r"\.(jpe?g|png|gif|tif{1,2}|webp|svg)$", "", base, flags=re.IGNORECASE)
    base = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    base = base[:58].strip("-") or category
    return f"{category}-{index:02d}-{base}.jpg"


def download(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def optimise_image(raw: bytes, max_edge: int = 1600, quality: int = 86) -> tuple[bytes, tuple[int, int]]:
    with Image.open(io.BytesIO(raw)) as img:
        img = img.convert("RGB")
        width, height = img.size
        scale = min(1.0, max_edge / float(max(width, height)))
        if scale < 1.0:
            img = img.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True, progressive=True)
        return out.getvalue(), img.size


def build_generated_overlays() -> list[dict]:
    """Create original overlay artwork (no third party rights involved)."""
    import random as _random

    import numpy as np

    overlay_dir = ASSET_ROOT / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    width, height = 1080, 1920

    # 1. Warm bokeh particles (subtle, seamless over any background)
    bokeh = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(bokeh)
    rng = _random.Random(7)
    for _ in range(90):
        x, y = rng.randint(0, width), rng.randint(0, height)
        radius = rng.randint(5, 30)
        alpha = rng.randint(8, 40)
        colour = rng.choice([(255, 214, 140), (255, 236, 190), (244, 193, 80)])
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*colour, alpha))
    bokeh = bokeh.filter(ImageFilter.GaussianBlur(3))
    bokeh.save(overlay_dir / "gold-bokeh-particles.png", optimize=True)

    # 2. Golden light rays: draw a luminance mask, then cap the whole overlay at 9% opacity.
    ray_mask = Image.new("L", (width, height), 0)
    mask_draw = ImageDraw.Draw(ray_mask)
    rng = _random.Random(11)
    for _ in range(18):
        spread = rng.uniform(-0.38, 0.38)
        end_x = width / 2 + spread * width * 1.25
        mask_draw.polygon(
            [(width / 2 - 24, -40), (width / 2 + 24, -40), (end_x + 80, height), (end_x - 80, height)],
            fill=rng.randint(26, 70),
        )
    ray_mask = ray_mask.filter(ImageFilter.GaussianBlur(34))
    ray_mask = ray_mask.point(lambda v: int(v * 0.20))
    rays = Image.new("RGBA", (width, height), (255, 219, 150, 0))
    rays.putalpha(ray_mask)
    rays.save(overlay_dir / "golden-light-rays.png", optimize=True)

    # 3. Cinematic vignette from a smooth radial falloff (no banding).
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    nx = (xx - width / 2) / (width / 2)
    ny = (yy - height / 2) / (height / 2)
    dist = np.sqrt(nx * nx + ny * ny) / np.sqrt(2.0)
    alpha = np.clip((dist - 0.32) / 0.68, 0.0, 1.0) ** 2.2 * 150.0
    vignette = Image.new("RGBA", (width, height), (3, 7, 15, 0))
    vignette.putalpha(Image.fromarray(alpha.astype(np.uint8), mode="L"))
    vignette.save(overlay_dir / "soft-vignette.png", optimize=True)

    generated = []
    for rel in GENERATED_OVERLAYS:
        path = ASSET_ROOT / rel
        with Image.open(path) as img:
            size = img.size
        generated.append(
            {
                "file": rel,
                "category": "overlays",
                "title": path.stem.replace("-", " ").title(),
                "source": "Generated locally for Christian Prayer Live",
                "downloadUrl": "",
                "license": "CC0 1.0 (generated in-project)",
                "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
                "attribution": "Christian Prayer Live (generated)",
                "credit": "Generated with Pillow",
                "widthOriginal": size[0],
                "heightOriginal": size[1],
                "width": size[0],
                "height": size[1],
                "bytes": path.stat().st_size,
                "searchQuery": "generated",
                "retrievedAt": time.strftime("%Y-%m-%d"),
            }
        )
    return generated


def build_contact_sheet(entries: list[dict]) -> Path | None:
    thumbs = []
    for entry in entries:
        path = ASSET_ROOT / entry["file"]
        if not path.is_file():
            continue
        try:
            img = Image.open(path)
            img.thumbnail((260, 380))
            thumbs.append((entry["file"], img.convert("RGB"), entry["category"]))
        except Exception:  # noqa: BLE001
            continue
    if not thumbs:
        return None
    cols = 5
    cell_w, cell_h = 270, 400
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (16, 20, 32))
    for idx, (_name, img, _cat) in enumerate(thumbs):
        x = (idx % cols) * cell_w + (cell_w - img.width) // 2
        y = (idx // cols) * cell_h + 10
        sheet.paste(img, (x, y))
    out_path = ROOT / "docs" / "asset-contact-sheet.jpg"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, format="JPEG", quality=80)
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-category", type=int, default=4, help="target images kept per category")
    parser.add_argument("--contact-sheet", action="store_true", help="write a review contact sheet")
    parser.add_argument("--force", action="store_true", help="re-download files that already exist")
    parser.add_argument("--prune", action="store_true", help="remove reviewed/rejected files and generate overlays")
    args = parser.parse_args()

    for category in CATEGORY_QUERIES:
        (ASSET_ROOT / category).mkdir(parents=True, exist_ok=True)

    existing: dict = {}
    if MANIFEST.is_file():
        try:
            existing = {e["file"]: e for e in json.loads(MANIFEST.read_text("utf-8"))}
        except Exception:  # noqa: BLE001
            existing = {}

    entries: list[dict] = []
    seen_hashes: set[str] = set()

    if args.prune and MANIFEST.is_file():
        kept_existing = []
        for entry in json.loads(MANIFEST.read_text("utf-8")):
            if REVIEWED_REJECT_RE.search(entry.get("title", "")) or REVIEWED_REJECT_RE.search(entry.get("file", "")):
                (ASSET_ROOT / entry["file"]).unlink(missing_ok=True)
                print(f"  - pruned {entry['file']}")
            else:
                kept_existing.append(entry)
        entries = kept_existing
        existing = {e["file"]: e for e in kept_existing}
        seen_hashes = {
            hashlib.sha1((ASSET_ROOT / e["file"]).read_bytes()).hexdigest()
            for e in kept_existing
            if (ASSET_ROOT / e["file"]).is_file()
        }

    for category, queries in CATEGORY_QUERIES.items():
        kept = 0
        for query in queries:
            if kept >= args.per_category:
                break
            try:
                pages = search_files(query)
            except Exception as exc:  # noqa: BLE001
                print(f"  ! search failed for '{query}': {exc}")
                continue
            for page in pages:
                if kept >= args.per_category:
                    break
                title = page.get("title", "")
                if BLOCKED_NAME_RE.search(title) or REVIEWED_REJECT_RE.search(title):
                    continue
                info = (page.get("imageinfo") or [{}])[0]
                mime = info.get("mime", "")
                if mime not in ("image/jpeg", "image/png"):
                    continue
                if int(info.get("width") or 0) < 1200 or int(info.get("height") or 0) < 800:
                    continue
                meta = info.get("extmetadata") or {}
                ok, short_license, license_url = license_ok(meta)
                if not ok:
                    continue
                source_url = info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title)}"
                artist = strip_html(meta.get("Artist", {}).get("value") or "")
                credit = strip_html(meta.get("Credit", {}).get("value") or "")
                download_url = info.get("thumburl") or info.get("url")
                if not download_url:
                    continue

                filename = slugify(title, category, kept + 1)
                target = ASSET_ROOT / category / filename
                record = {
                    "file": f"{category}/{filename}",
                    "category": category,
                    "title": re.sub(r"^File:", "", title),
                    "source": source_url,
                    "downloadUrl": download_url,
                    "license": short_license,
                    "licenseUrl": license_url,
                    "attribution": artist or credit or "Wikimedia Commons contributor",
                    "credit": credit,
                    "widthOriginal": info.get("width"),
                    "heightOriginal": info.get("height"),
                    "searchQuery": query,
                    "retrievedAt": time.strftime("%Y-%m-%d"),
                }

                if target.is_file() and not args.force:
                    with Image.open(target) as img:
                        record["width"] = img.width
                        record["height"] = img.height
                    record["bytes"] = target.stat().st_size
                    entries.append(record)
                    seen_hashes.add(hashlib.sha1(target.read_bytes()).hexdigest())
                    kept += 1
                    print(f"  = {category}: kept existing {filename}")
                    continue

                try:
                    raw = download(download_url)
                    optimised, (width, height) = optimise_image(raw)
                except Exception as exc:  # noqa: BLE001
                    print(f"  ! download failed {title}: {exc}")
                    continue

                digest = hashlib.sha1(optimised).hexdigest()
                if digest in seen_hashes:
                    print(f"  ~ duplicate skipped: {title}")
                    continue
                seen_hashes.add(digest)
                target.write_bytes(optimised)
                record["width"] = width
                record["height"] = height
                record["bytes"] = len(optimised)
                entries.append(record)
                kept += 1
                print(f"  + {category}: {filename} ({width}x{height}, {short_license})")

    entries = [e for e in entries if e["file"] not in GENERATED_OVERLAYS]
    entries.extend(build_generated_overlays())

    entries.sort(key=lambda e: (e["category"], e["file"]))
    MANIFEST.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"\nManifest written: {MANIFEST} ({len(entries)} images)")

    if args.contact_sheet:
        sheet = build_contact_sheet(entries)
        if sheet:
            print(f"Contact sheet: {sheet}")

    missing = [c for c in CATEGORY_QUERIES if not any(e["category"] == c for e in entries)]
    if missing:
        print("Categories with no licensed image found: " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
