#!/usr/bin/env python3
"""Render the OpenParty icon (rounded square, play triangle, two chat dots)
to extension/icons/icon{16,32,48,128}.png, and the Chrome Web Store icon
(96 px artwork with 16 px transparent padding) to store/icon128.png,
using only the standard library."""

import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
STORE = os.path.join(os.path.dirname(__file__), "..", "store")
TOP = (124, 92, 255)  # gradient start
BOTTOM = (79, 56, 230)  # gradient end
SS = 4  # supersampling factor


def inside_rounded_square(x, y, r):
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_triangle(x, y):
    # Play triangle pointing right, slightly left of centre.
    ax, ay, bx, by, cx, cy = 0.36, 0.27, 0.36, 0.73, 0.74, 0.50
    d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
    d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
    d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def inside_dot(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x, y):
    """RGBA for a point in the unit square."""
    if not inside_rounded_square(x, y, 0.22):
        return (0, 0, 0, 0)
    if inside_triangle(x, y) or inside_dot(x, y, 0.80, 0.80, 0.075) or inside_dot(x, y, 0.62, 0.86, 0.05):
        return (255, 255, 255, 255)
    t = y
    return tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,)


def render(size, pad=0):
    inner = size - 2 * pad
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter type: none
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    r, g, b, a = pixel((px - pad + (sx + 0.5) / SS) / inner, (py - pad + (sy + 0.5) / SS) / inner)
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            n = SS * SS
            alpha = acc[3] / n
            if acc[3]:
                row += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(alpha)])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        with open(os.path.join(OUT, f"icon{size}.png"), "wb") as f:
            f.write(render(size))
        print(f"wrote icon{size}.png")
    os.makedirs(STORE, exist_ok=True)
    with open(os.path.join(STORE, "icon128.png"), "wb") as f:
        f.write(render(128, pad=16))
    print("wrote store/icon128.png")
