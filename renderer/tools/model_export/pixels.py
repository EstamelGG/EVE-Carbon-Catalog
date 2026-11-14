# SOURCE AUDIT 2026-11-11 [B05/M01-M03]: Palette/paint replaced in segment 10, normals in segment 11. Portable specular conversion checked against Microsoft glTF-SDK in segment 105.
# See docs/source-audit-summary-2026-11-11.md; this annotation does not change historical provenance.
# Reference: https://github.com/carbonenginejs/tools-blender/blob/a4e0e709ac3dc80bd83846ed26f687757a154c48/addons/carbon_eve_resources/quad/reference.py
"""Material conversion; no image resize or atlas is implicit in this module."""
import struct
import zlib
import numpy as np
from surface_policy import weights  # Public compatibility export; segment 10.


def linearize(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def write_png(path, values, color=False):
    values = np.clip(values, 0, 1)
    if values.ndim == 2:
        values = np.repeat(values[:, :, None], 3, axis=2)
    if color:
        values = values.astype(np.result_type(values.dtype, np.float32), copy=False)
        rgb = values[:, :, :3]
        values[:, :, :3] = np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055)
    pixels = np.round(values * 255).astype(np.uint8)[::-1]
    height, width, channels = pixels.shape
    if channels not in (3, 4):
        raise ValueError("PNG requires RGB or RGBA")
    def chunk(tag, payload):
        return struct.pack('>I', len(payload)) + tag + payload + struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6 if channels == 4 else 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(b''.join(b'\0' + row.tobytes() for row in pixels), 6)) + chunk(b'IEND', b''))


def size_for(arrays):
    """Independent axes: never square a rectangular texture or reduce an input."""
    return max(a.shape[1] for a in arrays), max(a.shape[0] for a in arrays)


def sample_repeat(image, u, v):
    height, width = image.shape[:2]
    x, y = (u % 1) * width - .5, (v % 1) * height - .5
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    if image.ndim == 3:
        fx, fy = fx[:, :, None], fy[:, :, None]
    return ((image[y0 % height, x0 % width] * (1 - fx) + image[y0 % height, (x0 + 1) % width] * fx) * (1 - fy)
            + (image[(y0 + 1) % height, x0 % width] * (1 - fx) + image[(y0 + 1) % height, (x0 + 1) % width] * fx) * fy).astype(np.float32)


def grid(size, domain=None):
    width, height = size
    lo, hi = domain or ((0, 0), (1, 1))
    return np.meshgrid(lo[0] + (np.arange(width, dtype=np.float32) + .5) / width * (hi[0] - lo[0]),
                       lo[1] + (np.arange(height, dtype=np.float32) + .5) / height * (hi[1] - lo[1]))


def resize_up(image, size):
    width, height = size
    if (image.shape[1], image.shape[0]) == size:
        return image
    if width < image.shape[1] or height < image.shape[0]:
        raise ValueError("Downsampling is forbidden")
    return sample_repeat(image, *grid(size))


def tangent_normal(source):
    # glTF normalTexture: XYZ encoded in linear RGB, then normalized.
    # https://github.com/KhronosGroup/glTF/blob/51fde5dc47ac3178594e58a548f936e2910a8239/specification/2.0/Specification.adoc#additional-textures-normal
    normal = source[..., :3] * 2 - 1
    normal[..., 2] = np.maximum(normal[..., 2], 0)
    length = np.linalg.norm(normal, axis=-1, keepdims=True)
    flat = np.zeros_like(normal)
    flat[..., 2] = 1
    return np.divide(normal, length, out=flat, where=length > 0)


def specular_to_metalrough(diffuse, specular):
    # Microsoft glTF-SDK, PBRUtils.h SGToMR and PBRUtils.cpp SolveMetallic.
    def brightness(color):
        coefficients = np.array([.299, .587, .114], dtype=np.result_type(color, np.float32))
        return np.sqrt(np.sum(color * color * coefficients, axis=-1))
    remaining = 1 - np.max(specular, axis=-1)
    sb, db = brightness(specular), brightness(diffuse)
    b = db * remaining / .96 + sb - .08
    metallic = np.where(sb <= .04, 0, np.clip((-b + np.sqrt(np.maximum(b * b - 4 * .04 * (.04 - sb), 0))) / .08, 0, 1))
    from_diffuse = diffuse * (remaining / .96 / np.maximum(1 - metallic, 1e-6))[:, :, None]
    from_specular = (specular - .04 * (1 - metallic[:, :, None])) / np.maximum(metallic[:, :, None], 1e-6)
    base = np.clip(from_diffuse * (1 - metallic[:, :, None] ** 2) + from_specular * metallic[:, :, None] ** 2, 0, 1)
    return base, metallic
