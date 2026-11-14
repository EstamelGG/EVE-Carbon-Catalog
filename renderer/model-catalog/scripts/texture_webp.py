"""Pixel-exact WebP for material data, including RGB beneath zero alpha."""
import hashlib
import io
from pathlib import Path
import sys
import tempfile

if sys.version_info[:2] == (3, 11):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.deps/python311'))
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/model_export'))
from cache_lock import file_lock


def capped_size(size, max_edge=None):
    if not max_edge or max(size) <= max_edge:
        return size
    scale = max_edge / max(size)
    return tuple(max(1, round(value * scale)) for value in size)


def encode(data, max_edge=None):
    image = Image.open(io.BytesIO(data)).convert('RGBA')
    size = capped_size(image.size, max_edge)
    if size != image.size:
        # Material RGBA channels are independent data. RGBA resize otherwise
        # premultiplies RGB by alpha and destroys values beneath transparent texels.
        image = Image.merge('RGBA', tuple(channel.resize(size, Image.Resampling.LANCZOS)
                                         for channel in image.split()))
    output = io.BytesIO()
    image.save(output, format='WEBP', lossless=True, exact=True, method=4)
    encoded = output.getvalue()
    decoded = Image.open(io.BytesIO(encoded)).convert('RGBA')
    if decoded.size != image.size or decoded.tobytes() != image.tobytes():
        raise ValueError('WebP changed material channel values')
    return encoded


def publish(folder, data, max_edge=None):
    folder = Path(folder); folder.mkdir(parents=True, exist_ok=True)
    if max_edge:
        with Image.open(io.BytesIO(data)) as image:
            if max(image.size) <= max_edge: max_edge = None
    # Cache encoding by input bytes, independent of the source resource recipe.
    cache = Path(__file__).resolve().parents[1] / '.work/webp-cache'
    cache.mkdir(parents=True, exist_ok=True)
    suffix = ('-channels-lanczos-%s' % max_edge) if max_edge else ''
    cached = cache / (hashlib.sha256(data).hexdigest() + suffix + '.webp')
    with file_lock(cached.with_suffix('.lock')):
        if cached.exists():
            content = cached.read_bytes()
        else:
            content = encode(data, max_edge)
            atomic_bytes(cached, content)
    target = folder / (hashlib.sha256(content).hexdigest() + '.webp')
    with file_lock(cache / (target.stem + '-publish.lock')):
        if not target.exists(): atomic_bytes(target, content)
    return target


def atomic_bytes(target, data):
    with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.tmp', delete=False) as stream:
        temp = Path(stream.name); stream.write(data)
    try: temp.replace(target)
    finally: temp.unlink(missing_ok=True)


def webp_bindings(doc):
    used = False
    for texture in doc.get('textures', []):
        source = texture.get('source')
        if source is not None and doc['images'][source].get('uri', '').endswith('.webp'):
            texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': source}
            texture.pop('source')
            used = True
    if used:
        for field in ('extensionsUsed', 'extensionsRequired'):
            doc[field] = list(dict.fromkeys(doc.get(field, []) + ['EXT_texture_webp']))
    return doc
