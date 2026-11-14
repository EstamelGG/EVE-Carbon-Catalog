"""Convert the original 2D top mip to RGBA8 PNG, keeping data channels linear."""
import io
from pathlib import Path
import struct
import sys
from core import dds_header_info

DECODER_PROFILE = 'pillow-bc7-r8-blender-dds-v2'
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def decode_2d_png(source, expected_size=None):
    # Blender 5.0 uses Python 3.11. The catalog already pins Pillow for WebP.
    dependencies = Path(__file__).resolve().parents[2] / 'model-catalog/.deps/python311'
    if sys.version_info[:2] == (3, 11) and dependencies.is_dir() and str(dependencies) not in sys.path:
        sys.path.insert(0, str(dependencies))
    from PIL import Image
    with Path(source).open('rb') as stream:
        header = stream.read(148)
    r8 = False
    if header.startswith(PNG_MAGIC):
        pillow_input = True
    elif header.startswith(b'DDS ') and len(header) >= 128:
        # Microsoft DDS_HEADER / DDS_HEADER_DXT10. Do not flatten cube faces,
        # array layers or volume slices into a regular material texture.
        # https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header-dxt10
        info = dds_header_info(header)
        if info['volume'] or info['cubemap'] or info.get('arraySize', 1) != 1:
            raise ValueError('Expected a single 2D DDS image')
        pillow_input = False
        if header[84:88] == b'DX10':
            fmt = struct.unpack_from('<I', header, 128)[0]
            pillow_input = fmt in (97, 98, 99)
            r8 = fmt == 61  # DXGI_FORMAT_R8_UNORM
    else:
        raise ValueError('Expected a DDS or PNG image')

    if r8:
        # DDSD_PITCH describes the top mip's row stride. R8 samples as (R,0,0,1).
        width, height = info['width'], info['height']
        flags = struct.unpack_from('<I', header, 8)[0]
        pitch = struct.unpack_from('<I', header, 20)[0] if flags & 8 else width
        if not width or not height or pitch < width or pitch * height > Path(source).stat().st_size - 148:
            raise ValueError('Invalid DDS R8 top mip')
        with Path(source).open('rb') as stream:
            stream.seek(148)
            red = Image.frombytes('L', (width, height), stream.read(pitch * height), 'raw', 'L', pitch)
        zero = Image.new('L', red.size)
        rgba = Image.merge('RGBA', (red, zero, zero, Image.new('L', red.size, 255)))
    elif pillow_input:
        # https://github.com/python-pillow/Pillow/blob/11.3.0/src/PIL/DdsImagePlugin.py
        # https://github.com/python-pillow/Pillow/blob/11.3.0/src/libImaging/BcnDecode.c
        # Pillow's BC7 block decoder is CC0. Preserve the stored channel bytes,
        # including RGB under zero alpha and bytes in textures tagged sRGB.
        with Image.open(source) as original:
            rgba = original.convert('RGBA')
    else:
        # Blender's image loader supplies reconstructed blue for ATI2 normal
        # maps. Pillow's BC5 output supplies just XY. Preserve the published
        # Blender byte interpretation used by the viewer's glTF normalTexture.
        # https://docs.blender.org/api/5.0/bpy.types.BlendDataImages.html
        import bpy
        import numpy as np
        image = bpy.data.images.load(str(source), check_existing=False)
        try:
            image.colorspace_settings.name = 'Non-Color'
            width, height = image.size
            if not width or not height:
                raise ValueError(f'Blender could not decode {source}')
            pixels = np.empty(width * height * 4, np.float32)
            image.pixels.foreach_get(pixels)
            rows = pixels.reshape(height, width, 4)[::-1]
            rgba = Image.fromarray(np.rint(np.clip(rows, 0, 1) * 255).astype(np.uint8))
        finally:
            bpy.data.images.remove(image)
    if expected_size is not None and rgba.size != tuple(expected_size):
        raise ValueError(f'Decoded size {rgba.size} differs from source {expected_size}')
    # Metadata from a source color image must not color-manage a data map.
    rgba.info.clear()
    encoded = io.BytesIO()
    rgba.save(encoded, format='PNG')
    return encoded.getvalue()
