"""Generate the original SZKJ Pet paw icon source as a transparent PNG."""
from pathlib import Path
import struct
import zlib

SIZE = 512
BACKGROUND = (42, 62, 71, 255)
PAW = (255, 229, 183, 255)
TRANSPARENT = (0, 0, 0, 0)
TOES = ((109, 221, 31, 38), (197, 151, 33, 43),
        (315, 151, 33, 43), (403, 221, 31, 38))


def ellipse(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def color(x, y):
    dx = max(0, abs(x - 256) - 142)
    dy = max(0, abs(y - 256) - 142)
    if dx * dx + dy * dy > 90 * 90:
        return TRANSPARENT
    if any(ellipse(x, y, *toe) for toe in TOES):
        return PAW
    if ellipse(x, y, 256, 330, 115, 72) or ellipse(x, y, 256, 286, 68, 60):
        return PAW
    return BACKGROUND


def chunk(kind, data):
    return (struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data)))


pixels = b"".join(
    b"\x00" + b"".join(bytes(color(x, y)) for x in range(SIZE))
    for y in range(SIZE)
)
path = Path(__file__).resolve().parents[1] / "src-tauri" / "app-icon.png"
path.write_bytes(
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(pixels, 9))
    + chunk(b"IEND", b"")
)
