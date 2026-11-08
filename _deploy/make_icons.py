"""Generate PWA icons from the same design as favicon.svg.

No image library is available on the host, so the PNG is written directly with
zlib + struct: a dark rounded square, a gold trend line and a red dot. Run from
the repo root:

    python _deploy/make_icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "public"

BG = (0x12, 0x16, 0x1F)
GOLD = (0xF5, 0xB9, 0x42)
RED = (0xFF, 0x4D, 0x5E)

# Normalised polyline, same shape as the SVG favicon.
LINE = [(0.22, 0.69), (0.34, 0.53), (0.45, 0.62), (0.59, 0.40), (0.72, 0.31)]
DOT = (0.69, 0.31)
DOT_R = 0.055


def _seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def _pixel(x, y, size):
    """Colour at one pixel, in normalised 0..1 space."""
    u = x / size
    v = y / size

    # Rounded-square mask: anything outside the corner radius stays transparent.
    r = 0.22
    cx = min(max(u, r), 1 - r)
    cy = min(max(v, r), 1 - r)
    if math.hypot(u - cx, v - cy) > r:
        return (0, 0, 0, 0)

    # Gold trend line.
    half = 0.045
    for i in range(len(LINE) - 1):
        x1, y1 = LINE[i]
        x2, y2 = LINE[i + 1]
        if _seg_dist(u, v, x1, y1, x2, y2) <= half:
            return GOLD + (255,)

    # Red dot at the peak.
    if math.hypot(u - DOT[0], v - DOT[1]) <= DOT_R:
        return RED + (255,)

    return BG + (255,)


def write_png(path: Path, size: int) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: none
        for x in range(size):
            raw += bytes(_pixel(x, y, size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    # 8-bit RGBA (colour type 6).
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"{path.name}: {size}x{size}, {len(png)} bytes")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for s in (192, 512):
        write_png(OUT / f"icon-{s}.png", s)
    # Maskable variant: same art, but the safe zone is respected because the
    # rounded square already leaves margin on every edge.
    write_png(OUT / "icon-512-maskable.png", 512)
