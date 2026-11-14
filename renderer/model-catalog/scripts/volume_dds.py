"""Unpack DDS volume mips into RGBA8 channel values in source Z, Y, X order.

Microsoft documents one complete stack of slices per mip:
https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-file-layout-for-volume-textures
Public byte masks and block formats:
https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-pixelformat
Pillow 11.3.0 decodes compressed 2D slices. For raw RGB, its byte-plane
operations reorder the channels without changing stored values. The slice layout code here is original.
"""
from collections import namedtuple
import io
import struct

from core import dds_header_info

VolumeLevel = namedtuple('VolumeLevel', 'width height depth rgba')
LEGACY_BLOCK_BYTES = {b'DXT1':8, b'DXT3':16, b'DXT5':16, b'ATI1':8,
                      b'ATI2':16, b'BC4U':8, b'BC5U':16}
DXGI_BLOCK_BYTES = {71:8, 72:8, 74:16, 75:16, 77:16, 78:16, 80:8,
                    83:16, 97:16, 98:16, 99:16}
# The BC1/2/3 sRGB variants store identical blocks to their UNORM partners.
# Pillow 11.3 accepts the UNORM tags. The effect sampler consumes the encoded
# channels directly, so unpack the same block without a color-space transform.
# https://github.com/python-pillow/Pillow/blob/11.3.0/src/PIL/DdsImagePlugin.py
BC_SRGB_TO_UNORM = {72: 71, 75: 74, 78: 77}

def _raw_rgba(Image, packed, width, total_rows, stride, bits, header):
    # Stack rows of consecutive slices in a single image. Each plane is one
    # byte from the original word. DDS channel masks name the destination.
    mode = 'RGB' if bits == 24 else 'RGBA'
    raw = Image.frombytes(mode, (width, total_rows), packed, 'raw', mode, stride, 1)
    planes = raw.split()
    masks = struct.unpack_from('<4I', header, 92)
    has_alpha = bool(struct.unpack_from('<I', header, 80)[0] & 1)
    indices = {255 << (8 * i): i for i in range(len(planes))}
    used = masks if has_alpha else masks[:3]
    if len(set(used)) != len(used) or any(mask not in indices for mask in used):
        raise ValueError('Expected disjoint 8-bit DDS volume channels')
    channels = [planes[indices[mask]] for mask in used]
    if not has_alpha:
        channels.append(Image.new('L', raw.size, 255))
    return Image.merge('RGBA', channels).tobytes()

def decode_volume(data):
    from texture_webp import Image
    info = dds_header_info(data[:148])
    if not info['volume'] or info['cubemap'] or info.get('arraySize', 1) != 1:
        raise ValueError('Expected a single DDS volume')
    width, height, depth = info['width'], info['height'], info['depth']
    mips = max(1, struct.unpack_from('<I', data, 28)[0])
    if min(width, height, depth) < 1 or mips > max(width, height, depth).bit_length():
        raise ValueError('Invalid DDS volume dimensions or mip count')

    fourcc = bytes(data[84:88])
    pixel_flags, _, bits = struct.unpack_from('<III', data, 80)
    header_size = 148 if fourcc == b'DX10' else 128
    block_bytes = LEGACY_BLOCK_BYTES.get(fourcc)
    if fourcc == b'DX10':
        dxgi = struct.unpack_from('<I', data, 128)[0]
        block_bytes = DXGI_BLOCK_BYTES.get(dxgi)
    if block_bytes is None:
        if pixel_flags & 4 or not pixel_flags & 0x40 or bits not in (24, 32):
            raise ValueError('Unsupported DDS volume pixel format')

    cursor = header_size
    flags, pitch = struct.unpack_from('<I', data, 8)[0], struct.unpack_from('<I', data, 20)[0]
    levels = []
    for mip in range(mips):
        w, h, d = (max(1, n >> mip) for n in (width, height, depth))
        row_size = ((w + 3) // 4) * block_bytes if block_bytes else w * (bits // 8)
        rows = (h + 3) // 4 if block_bytes else h
        # PITCH describes level zero only. A padded mip chain has no unique
        # lower-level row pitch in this subset of DDS.
        stride = pitch if mip == 0 and not block_bytes and flags & 8 and pitch else row_size
        if stride < row_size or (mips > 1 and stride != row_size):
            raise ValueError('Unsupported DDS volume row pitch')
        slice_size = stride * rows
        if cursor + d * slice_size > len(data):
            raise ValueError('Truncated DDS volume slice')

        if not block_bytes:
            end = cursor + d * slice_size
            rgba = _raw_rgba(Image, data[cursor:end], w, h * d, stride, bits, data)
            levels.append(VolumeLevel(w, h, d, rgba))
            cursor = end
            continue

        # Give the public 2D reader a single top-level image with identical
        # channel masks and format. Remove volume/mip flags and row padding.
        header = bytearray(data[:header_size])
        struct.pack_into('<I', header, 8, 0x81007)
        struct.pack_into('<5I', header, 12, h, w, row_size * rows, 0, 1)
        struct.pack_into('<II', header, 108, 0x1000, 0)
        if fourcc == b'DX10':
            struct.pack_into('<5I', header, 128, BC_SRGB_TO_UNORM.get(dxgi, dxgi), 3, 0, 1, 0)
        slices = []
        for _ in range(d):
            packed = data[cursor:cursor + slice_size]
            cursor += slice_size
            with Image.open(io.BytesIO(header + packed)) as image:
                slices.append(image.convert('RGBA').tobytes())
        levels.append(VolumeLevel(w, h, d, b''.join(slices)))
    return tuple(levels)


def decode_compressed_volume(data):
    """Compatibility with callers that handle uncompressed DDS separately."""
    dds_header_info(data[:148])
    if not struct.unpack_from('<I', data, 80)[0] & 4:
        return None
    return decode_volume(data)
