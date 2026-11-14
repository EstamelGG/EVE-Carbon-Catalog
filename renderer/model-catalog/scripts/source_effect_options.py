"""Read only the static option table in a published Trinity effect resource.

CCP Trinity (MIT), EffectInfo._load and Permutation:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shadercompiler/python/shadercompiler/effectinfo.py#L498-L514
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shadercompiler/python/shadercompiler/effectinfo.py#L589-L624
"""
from io import BytesIO
from struct import calcsize, unpack


def compiled_depth_path(path):
    # shadercompiler/paths.py::get_compiled_path, DX11 / DEPTH preview.
    parts = path.lower().split('/')
    index = len(parts) - 1 - parts[::-1].index('effect')
    parts[index] = 'effect.dx11'
    parts[-1] = parts[-1].removesuffix('.fx') + '.sm_depth'
    return '/'.join(parts)


def material_resource(effect):
    """Resolve the DX11 depth resource from the authored effect identity."""
    path = (effect.get('effectFilePath') or '').replace('\\', '/').lower()
    if path.endswith('.fx') and '/effect/' in path:
        return compiled_depth_path(path)
    if '.sm_' in path.rsplit('/', 1)[-1]:
        return path
    # Some older records carry only the compiled resource identity.
    return (effect.get('actualEffectFilePath') or '').replace('\\', '/').lower()


def static_defaults(content):
    stream = BytesIO(content)

    def read(fmt):
        return unpack('<' + fmt, stream.read(calcsize('<' + fmt)))

    version, = read('I')
    if not 2 <= version <= 15:
        raise ValueError('Unsupported Trinity effect version %s' % version)
    if version < 5:
        return {}  # No named permutations in this format.
    if version == 15:
        stream.seek(36, 1)  # compiler version and source hash
    size, = read('I')
    table = stream.read(size)

    def string(offset):
        return table[offset:table.index(b'\0', offset)].decode('utf-8')

    defaults = {}
    count, = read('B')
    for _ in range(count):
        name, default, _description = read('IBI')
        kind = read('B')[0] if version > 5 else 0
        options, = read('B')
        names = read('I' * options)
        if kind == 0:
            defaults[string(name)] = string(names[default])
    return defaults
