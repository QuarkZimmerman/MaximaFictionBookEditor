#!/usr/bin/env python3
"""Feature 014 (D26; tasks T056): small PDFs whose single picture is coded in JBIG2, JPEG 2000 and
CCITT Group 4 - the formats a book printed elsewhere may use, which the core's Poppler must decode
when the editor reads PDFs back. The pictures are synthetic patterns made here, so the fixtures are
free of any licence restriction.

    jbig2.pdf  - a 64 x 32 one-bit picture: the top-left quadrant black. JBIG2's embedded format
                 (ISO/IEC 14492): a page information segment, an immediate lossless generic region
                 coded with MMR - the same T.6 data as the CCITT fixture - and an end of page.
    ccitt.pdf  - the same picture, CCITTFaxDecode with K -1 (Group 4).
    jpx.pdf    - a 32 x 24 RGB picture, red = 8 x, green = 10 y, blue = 128, JPEG 2000 lossless.

Each page is the picture's size in points, so at 72 dpi one point is one pixel.

Needs Pillow (with libtiff and OpenJPEG, as its wheels have) for the Group 4 and JPEG 2000 coding;
the tests read the committed fixtures and need nothing of this.
Usage: python3 tests/fixtures/pdf/make-format-fixtures.py [output folder, default: this folder]
"""

import io
import struct
import sys
from pathlib import Path

from PIL import Image

WIDTH, HEIGHT = 64, 32
RGB_WIDTH, RGB_HEIGHT = 32, 24


def bilevel() -> Image.Image:
    """The one-bit pattern: the top-left quadrant black, the rest white."""
    image = Image.new("1", (WIDTH, HEIGHT), 255)
    for y in range(HEIGHT // 2):
        for x in range(WIDTH // 2):
            image.putpixel((x, y), 0)
    return image


def group4(image: Image.Image) -> bytes:
    """T.6 (Group 4) data of `image`, from a single-strip TIFF written by libtiff."""
    out = io.BytesIO()
    image.save(out, format="TIFF", compression="group4", tiffinfo={278: HEIGHT})
    data = out.getvalue()
    order = "<" if data[:2] == b"II" else ">"
    ifd = struct.unpack(order + "I", data[4:8])[0]
    count = struct.unpack(order + "H", data[ifd:ifd + 2])[0]
    tags = {}
    for i in range(count):
        tag, kind, n, value = struct.unpack(order + "HHII", data[ifd + 2 + 12 * i:ifd + 14 + 12 * i])
        if kind == 3 and n == 1:  # SHORT stored in the first two bytes of the value field
            value = struct.unpack(order + "H", data[ifd + 10 + 12 * i:ifd + 12 + 12 * i])[0]
        tags[tag] = (n, value)
    assert tags[259][1] == 4, "not Group 4"
    assert tags[273][0] == 1, "more than one strip"
    # PhotometricInterpretation: libtiff codes white runs as white whatever the photometric value;
    # the pattern's colours are checked by the test after decoding.
    offset, length = tags[273][1], tags[279][1]
    return data[offset:offset + length]


def segment(number: int, kind: int, data: bytes) -> bytes:
    """A JBIG2 segment: header (number, flags with the type, no referred-to segments, page 1,
    data length) and its data."""
    return struct.pack(">IBBBI", number, kind, 0, 1, len(data)) + data


def jbig2(g4: bytes) -> bytes:
    page = struct.pack(">IIIIBH", WIDTH, HEIGHT, 0, 0, 0x01, 0)  # eventually lossless
    region = struct.pack(">IIIIB", WIDTH, HEIGHT, 0, 0, 0) + bytes([0x01])  # OR; MMR = 1
    return segment(0, 48, page) + segment(1, 39, region + g4) + segment(2, 49, b"")


def jpeg2000() -> bytes:
    image = Image.new("RGB", (RGB_WIDTH, RGB_HEIGHT))
    for y in range(RGB_HEIGHT):
        for x in range(RGB_WIDTH):
            image.putpixel((x, y), (x * 8, y * 10, 128))
    out = io.BytesIO()
    image.save(out, format="JPEG2000", irreversible=False)  # lossless (reversible 5/3 wavelet)
    return out.getvalue()


def pdf(width: int, height: int, image_dict: str, image_data: bytes) -> bytes:
    """A one-page PDF drawing one image XObject over the whole page."""
    content = f"q {width} 0 0 {height} 0 0 cm /Im1 Do Q".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
        f"/Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>".encode(),
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} {image_dict} "
        f"/Length {len(image_data)} >>\nstream\n".encode() + image_data + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def main() -> int:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    folder.mkdir(parents=True, exist_ok=True)
    # Pillow writes one-bit pictures as MinIsBlack TIFFs, whose 0 bits (Pillow's black) libtiff codes
    # as T.6 white runs; the picture is therefore coded inverted, so that its black quadrant becomes
    # the black runs that CCITTFaxDecode and JBIG2's MMR regions draw black.
    g4 = group4(bilevel().point(lambda v: 0 if v else 255))
    one_bit = "/ColorSpace /DeviceGray /BitsPerComponent 1"
    files = {
        "jbig2.pdf": pdf(WIDTH, HEIGHT, f"{one_bit} /Filter /JBIG2Decode", jbig2(g4)),
        "ccitt.pdf": pdf(
            WIDTH,
            HEIGHT,
            f"{one_bit} /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns {WIDTH} /Rows {HEIGHT} >>",
            g4,
        ),
        "jpx.pdf": pdf(RGB_WIDTH, RGB_HEIGHT, "/Filter /JPXDecode", jpeg2000()),
    }
    for name, data in files.items():
        (folder / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
