#!/usr/bin/env python3
"""Render the Roku map-lite base map (dark equirectangular coastlines).

Source: Natural Earth 110m coastline (public domain-ish,
https://www.naturalearthdata.com). Regenerate with:

    curl -fsSL -o /tmp/ne-coast.geojson \\
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson
    python3 render-map.py /tmp/ne-coast.geojson map.png
"""
import json
import sys
import urllib.request

W, H = 960, 480
BG = (10, 14, 20)
GRID = (28, 38, 50)
LAND = (143, 163, 184)

GEOJSON_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector"
    "/master/geojson/ne_110m_coastline.geojson"
)


def proj(lon, lat):
    return ((lon + 180.0) / 360.0 * W, (90.0 - lat) / 180.0 * H)


def segments(coords):
    """Split a lon/lat ring at antimeridian jumps."""
    seg, out = [], []
    prev = None
    for lon, lat in coords:
        if prev is not None and abs(lon - prev) > 180:
            if len(seg) > 1:
                out.append(seg)
            seg = []
        seg.append(proj(lon, lat))
        prev = lon
    if len(seg) > 1:
        out.append(seg)
    return out


def main(src, dst):
    if src.startswith("http"):
        with urllib.request.urlopen(src) as r:
            geo = json.load(r)
    else:
        with open(src) as f:
            geo = json.load(f)

    from PIL import Image, ImageDraw

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for lon in range(-180, 180, 30):
        x = (lon + 180) / 360 * W
        d.line([(x, 0), (x, H)], fill=GRID)
    for lat in range(-60, 91, 30):
        y = (90 - lat) / 180 * H
        d.line([(0, y), (W, y)], fill=GRID)

    for feat in geo["features"]:
        g = feat["geometry"]
        if g["type"] == "LineString":
            rings = [g["coordinates"]]
        elif g["type"] == "MultiLineString":
            rings = g["coordinates"]
        elif g["type"] == "Polygon":
            rings = g["coordinates"]
        elif g["type"] == "MultiPolygon":
            rings = [ring for poly in g["coordinates"] for ring in poly]
        else:
            continue
        for ring in rings:
            for seg in segments(ring):
                d.line(seg, fill=LAND, width=2, joint="curve")

    img.save(dst)
    print(f"wrote {dst} ({W}x{H})")


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else GEOJSON_URL
    dst = sys.argv[2] if len(sys.argv) > 2 else "map.png"
    main(src, dst)
