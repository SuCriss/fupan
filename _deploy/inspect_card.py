"""Inspect the exported summary card without a vision model.

Checks that each layout band actually contains drawn pixels, so an empty or
overlapping card cannot pass as "it rendered".
"""

from __future__ import annotations

import struct
import sys
import zlib

BG = (0x0B, 0x0F, 0x16)


def read_png(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos = 8
    idat = b""
    w = h = depth = ctype = 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + length
    raw = zlib.decompress(idat)
    bpp = 4 if ctype == 6 else 3
    stride = w * bpp
    rows, prev = [], bytearray(stride)
    i = 0
    for _ in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 0xFF
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                c = prev[x - bpp] if x >= bpp else 0
                b = prev[x]
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        rows.append(bytes(line))
        prev = line
    return w, h, bpp, rows


def band_density(rows, bpp, y0, y1, x0, x1):
    """Fraction of pixels in the band that differ from the background."""
    total = 0
    ink = 0
    for y in range(y0, min(y1, len(rows))):
        row = rows[y]
        for x in range(x0, min(x1, len(rows[0]) // bpp)):
            o = x * bpp
            px = (row[o], row[o + 1], row[o + 2])
            total += 1
            # Anything meaningfully brighter/different than the dark background.
            if abs(px[0] - BG[0]) + abs(px[1] - BG[1]) + abs(px[2] - BG[2]) > 24:
                ink += 1
    return ink / total if total else 0.0


path = sys.argv[1]
w, h, bpp, rows = read_png(path)
print(f"尺寸 {w}x{h}, bpp={bpp}")

# Logical coordinates are 1200x820; the file is 2x.
sx = w / 1200
bands = [
    ("页眉 (标题+日期+情绪分)", 30, 130),
    ("KPI 行", 140, 235),
    ("龙头榜列", 280, 700),
    ("板块列", 280, 700),
    ("页脚", 740, 800),
]

for name, y0, y1 in bands:
    if name == "板块列":
        d = band_density(rows, bpp, int(y0 * sx), int(y1 * sx), int(640 * sx), int(1152 * sx))
    elif name in ("龙头榜列",):
        d = band_density(rows, bpp, int(y0 * sx), int(y1 * sx), int(48 * sx), int(600 * sx))
    else:
        d = band_density(rows, bpp, int(y0 * sx), int(y1 * sx), int(40 * sx), int(1160 * sx))
    status = "OK" if d > 0.004 else "空白!"
    print(f"  {name:<24} 内容占比 {d * 100:5.2f}%  {status}")

print()
ok = True
for name, y0, y1 in bands:
    if name == "板块列":
        d = band_density(rows, bpp, int(y0 * sx), int(y1 * sx), int(640 * sx), int(1152 * sx))
    elif name == "龙头榜列":
        d = band_density(rows, bpp, int(y0 * sx), int(y1 * sx), int(48 * sx), int(600 * sx))
    else:
        d = band_density(rows, bpp, int(y0 * sx), int(y1 * sx), int(40 * sx), int(1160 * sx))
    if d <= 0.004:
        ok = False

print("结论:", "所有区块均有内容" if ok else "存在空白区块")
sys.exit(0 if ok else 1)
