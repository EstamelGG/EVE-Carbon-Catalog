"""Pack material UV bindings into the viewer's four supported channels.

UV0 stays the original hull UV. Each primitive keeps only the other UV sets
its material needs; accessor references change, never coordinates or images.
"""
import json
from pathlib import Path


def texture_infos(value):
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        if key.endswith('Texture') and isinstance(child, dict) and 'index' in child:
            yield child
        elif key != 'extras':
            yield from texture_infos(child)


def texture_channel(info):
    # https://registry.khronos.org/glTF/extensions/2.0/Khronos/KHR_texture_transform/
    return info.get('extensions', {}).get('KHR_texture_transform', {}).get(
        'texCoord', info.get('texCoord', 0))


def compact_uv_channels(doc):
    materials = doc.get('materials', [])
    primitives = [p for mesh in doc.get('meshes', []) for p in mesh['primitives'] if 'material' in p]
    available = [set() for _ in materials]
    for primitive in primitives:
        available[primitive['material']].update(primitive['attributes'])

    bindings = []
    # Plan and validate first, so an unsupported material leaves doc untouched.
    for material, attributes in zip(materials, available):
        channels = {0}
        textures = []
        for info in texture_infos(material):
            active = texture_channel(info)
            fallback = info.get('texCoord', 0)
            # Some extension-only exports omit the fallback accessor entirely.
            if attributes and 'TEXCOORD_%d' % fallback not in attributes:
                fallback = active
            channels.update((active, fallback))
            textures.append((info, active, fallback))
        if len(channels) > 4:
            raise ValueError('Material needs more than four UV channels: ' + material.get('name', '?'))
        bindings.append(({old: new for new, old in enumerate(sorted(channels))}, textures))
    plans = []
    for primitive in primitives:
        _, textures = bindings[primitive['material']]
        attributes = primitive['attributes']
        aliases = {}
        for _, active, fallback in textures:
            active_key = 'TEXCOORD_%d' % active
            if active_key not in attributes:
                raise ValueError('Missing texture coordinates: ' + active_key)
            if 'TEXCOORD_%d' % fallback not in attributes:
                accessor = attributes[active_key]
                if fallback in aliases and aliases[fallback] != accessor:
                    raise ValueError('Conflicting fallback accessors for TEXCOORD_%d' % fallback)
                aliases[fallback] = accessor
        plans.append((primitive, aliases))
    changed = False
    for primitive, aliases in plans:
        mapping, _ = bindings[primitive['material']]
        attributes = primitive['attributes']
        packed = {key: value for key, value in attributes.items() if not key.startswith('TEXCOORD_')}
        for old, new in mapping.items():
            if 'TEXCOORD_%d' % old in attributes:
                packed['TEXCOORD_%d' % new] = attributes['TEXCOORD_%d' % old]
            elif old in aliases:
                packed['TEXCOORD_%d' % new] = aliases[old]
        changed |= packed != attributes
        primitive['attributes'] = packed
    for material, (mapping, textures) in zip(materials, bindings):
        if any(old != new for old, new in mapping.items()):
            material.setdefault('extras', {})['ccpdecUVChannels'] = {str(new): old for old, new in mapping.items()}
        for info, active, fallback in textures:
            if 'texCoord' in info or mapping[fallback]:
                changed |= info.get('texCoord', 0) != mapping[fallback]
                info['texCoord'] = mapping[fallback]
            transform = info.get('extensions', {}).get('KHR_texture_transform', {})
            if 'texCoord' in transform:
                changed |= transform['texCoord'] != mapping[active]
                transform['texCoord'] = mapping[active]
    return changed


if __name__ == '__main__':
    folder = Path(__file__).resolve().parents[1] / 'dist/assets/models'
    updated = []
    for path in sorted(folder.glob('*.gltf')):
        doc = json.loads(path.read_text(encoding='utf-8'))
        if compact_uv_channels(doc):
            path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            updated.append(path.stem)
    print('UV bindings updated:', ', '.join(updated) or 'none')
