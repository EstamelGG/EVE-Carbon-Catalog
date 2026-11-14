"""Validate DDS cubemaps supported by the viewer without changing their pixels."""
import struct


def prepare_sky_cube(content):
    """Return browser DDS bytes, HDR flag and sampler transfer function."""
    # DX10 describes the header layout. The DXGI value describes the pixels.
    # https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header-dxt10
    # https://learn.microsoft.com/en-us/windows/win32/api/dxgiformat/ne-dxgiformat-dxgi_format
    if content[84:88] != b'DX10':
        validate_cube(content)
        return content, False, 'srgb'
    if len(content) < 148:
        raise ValueError('Truncated DX10 sky cube header')
    fmt, dimension, flags, count, _ = struct.unpack_from('<5I', content, 128)
    if dimension != 3 or not flags & 4 or count != 1:
        raise ValueError('Expected a single DDS sky cube')
    if fmt in (95, 96):
        validate_cube(content)
        return content, True, 'srgb-linear'
    # Three r183 accepts BC1/2/3 as DXT1/3/5. Preserve every face and mip.
    # https://github.com/mrdoob/three.js/blob/r183/examples/jsm/loaders/DDSLoader.js
    codes = {71: b'DXT1', 72: b'DXT1', 74: b'DXT3', 75: b'DXT3', 77: b'DXT5', 78: b'DXT5'}
    if fmt not in codes:
        raise ValueError(f'Unsupported sky cube DXGI format {fmt}')
    header = bytearray(content[:128])
    header[84:88] = codes[fmt]
    struct.pack_into('<I', header, 112, struct.unpack_from('<I', header, 112)[0] | 0xfe00)
    cube = bytes(header) + content[148:]
    validate_cube(cube)
    return cube, False, 'srgb' if fmt in (72, 75, 78) else 'srgb-linear'


def validate_cube(content):
    if len(content) < 128 or content[:4] != b'DDS ':
        raise ValueError('Invalid effect cubemap DDS header')
    h = struct.unpack_from('<31I', content, 4)
    height, width, levels = h[2], h[3], max(1, h[6]) if h[1] & 0x20000 else 1
    if h[0] != 124 or h[18] != 32 or not width or width != height:
        raise ValueError('Invalid effect cubemap dimensions/header')
    if h[27] & 0xfe00 != 0xfe00:
        raise ValueError('Incomplete effect cubemap faces')
    if levels > width.bit_length():
        raise ValueError('Invalid effect cubemap mip count')
    code = content[84:88]
    offset = 128
    block = {b'DXT1':8, b'DXT3':16, b'DXT5':16}.get(code) if h[19] & 4 else None
    if code == b'DX10':
        if len(content) < 148: raise ValueError('Truncated DX10 cubemap header')
        format_id, dimension, flags, array_size, _ = struct.unpack_from('<5I', content, 128)
        if format_id not in (95, 96) or dimension != 3 or not flags & 4 or array_size != 1:
            raise ValueError('Unsupported DX10 effect cubemap format')
        block, offset = 16, 148  # Native BC6H HDR cubes supported by DDSLoader.
    rgb = (h[19] & 0x40 and not h[19] & 4 and
           h[22:25] == (0xff0000, 0xff00, 0xff) and
           ((h[21] == 24 and h[25] == 0) or (h[21] == 32 and h[25] == 0xff000000)))
    if not block and not rgb:
        raise ValueError('Unsupported effect cubemap pixel format')
    size = 0
    for _ in range(levels):
        size += ((width + 3)//4)**2 * block if block else width * width * (h[21]//8)
        width = max(1, width//2)
    if len(content) < offset + size * 6:
        raise ValueError('Truncated effect cubemap pixel data')
