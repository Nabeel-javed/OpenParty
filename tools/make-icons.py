#!/usr/bin/env python3
"""Render the OpenParty icon (a warm near-black rounded square with two friends
side by side, one gold and one ivory, which also reads as a pause button) to
extension/icons/icon{16,32,48,128}.png, and the Chrome Web Store icon (96 px
artwork with 16 px transparent padding) to store/icon128.png, using only the
standard library. brand/logo-mark.svg is the same drawing as a vector."""

import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
STORE = os.path.join(os.path.dirname(__file__), "..", "store")
TILE_TOP = (29, 25, 19)  # #1D1913
TILE_BOTTOM = (15, 13, 10)  # #0F0D0A
GOLD = ((246, 194, 90), (220, 143, 38))  # #F6C25A -> #DC8F26
IVORY = ((251, 247, 239), (230, 221, 204))  # #FBF7EF -> #E6DDCC
SS = 4  # supersampling factor

# One friend: head circle and a body with round shoulders, in unit-square coordinates.
HEAD_Y, HEAD_R = 0.265, 0.095
BODY_TOP, BODY_BOTTOM, BODY_W, BODY_FOOT = 0.405, 0.81, 0.23, 0.05
FRIENDS = ((0.35, GOLD), (0.65, IVORY))
# At 16 px the neck gap would blur away: bigger heads and a gap of at least one pixel.
SMALL = dict(HEAD_Y=0.235, HEAD_R=0.115, BODY_TOP=0.44, BODY_BOTTOM=0.85, BODY_W=0.26, FRIENDS=((0.33, GOLD), (0.67, IVORY)))


def inside_rounded_rect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return x0 <= x <= x1 and y0 <= y <= y1 and (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_friend(x, y, cx):
    if (x - cx) ** 2 + (y - HEAD_Y) ** 2 <= HEAD_R * HEAD_R:
        return True
    x0, x1 = cx - BODY_W / 2, cx + BODY_W / 2
    if not (x0 <= x <= x1 and BODY_TOP <= y <= BODY_BOTTOM):
        return False
    # Round shoulders on top (radius = half the width), slightly rounded feet.
    shoulder = BODY_W / 2
    if y < BODY_TOP + shoulder:
        return (x - cx) ** 2 + (y - (BODY_TOP + shoulder)) ** 2 <= shoulder * shoulder
    return inside_rounded_rect(x, y, x0, BODY_TOP, x1, BODY_BOTTOM, BODY_FOOT)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def pixel(x, y):
    """RGBA for a point in the unit square."""
    if not inside_rounded_rect(x, y, 0, 0, 1, 1, 0.23):
        return (0, 0, 0, 0)
    for cx, (top, bottom) in FRIENDS:
        if inside_friend(x, y, cx):
            t = (y - (HEAD_Y - HEAD_R)) / (BODY_BOTTOM - (HEAD_Y - HEAD_R))
            return mix(top, bottom, min(1, max(0, t))) + (255,)
    return mix(TILE_TOP, TILE_BOTTOM, y) + (255,)


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
    regular = {k: globals()[k] for k in SMALL}
    for size in (16, 32, 48, 128):
        globals().update(SMALL if size <= 16 else regular)
        with open(os.path.join(OUT, f"icon{size}.png"), "wb") as f:
            f.write(render(size))
        print(f"wrote icon{size}.png")
    globals().update(regular)
    os.makedirs(STORE, exist_ok=True)
    with open(os.path.join(STORE, "icon128.png"), "wb") as f:
        f.write(render(128, pad=16))
    print("wrote store/icon128.png")
