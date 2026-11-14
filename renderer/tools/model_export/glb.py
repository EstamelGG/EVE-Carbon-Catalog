"""Check embedded PNG sizes and repair degenerate tangent frames before publishing."""
import json
import math
from pathlib import Path
import struct


# Revision 3 decodes legacy GR2 hull tangent frames from the published Carbon equations.
HULL_GEOMETRY_REVISION = 3


def audit(path, area_reports, metalrough=False):
    path = Path(path)
    blob = bytearray(path.read_bytes())
    magic, version, length = struct.unpack_from('<III', blob, 0)
    if magic != 0x46546c67 or version != 2 or length != len(blob):
        raise ValueError('Invalid GLB container')
    json_size = struct.unpack_from('<I', blob, 12)[0]
    doc = json.loads(blob[20:20 + json_size])
    binary = 20 + json_size + 8
    def texture_size(info):
        image_index = doc['textures'][info['index']]['source']
        view = doc['bufferViews'][doc['images'][image_index]['bufferView']]
        start = binary + view.get('byteOffset', 0)
        if blob[start:start + 8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError('Expected lossless PNG in GLB')
        return struct.unpack_from('>II', blob, start + 16)
    checked = []
    for material in doc.get('materials', []):
        # Only materials actually referenced by the hull are exported.
        index = int(material['name'].split('_')[0][4:])
        expected = area_reports[index]['textures']
        pbr = material['pbrMetallicRoughness']
        slots = [('mr_basecolor' if metalrough else 'basecolor', pbr['baseColorTexture']),
                 ('normal', material['normalTexture'])]
        if area_reports[index].get('runtimeMaterial'):
            slots = [('mr_basecolor', pbr['baseColorTexture']), ('normal', material['normalTexture'])]
        else:
            slots.append(('orm' if metalrough else 'roughness', pbr['metallicRoughnessTexture']))
        if not metalrough and not area_reports[index].get('runtimeMaterial'):
            specular = material['extensions']['KHR_materials_specular']
            # At the exported default IOR 1.5, glTF multiplies each channel
            # by 0.04. The factor 25 restores the stored RGB reflectance.
            factor = specular.get('specularColorFactor', [1, 1, 1])
            if len(factor) != 3 or any(not math.isclose(channel, 25, abs_tol=1e-5) for channel in factor):
                raise ValueError('glTF exporter lost F0 scale factor')
            slots.append(('f0', specular['specularColorTexture']))
        for role, info in slots:
            actual = texture_size(info)
            wanted = (expected[role]['width'], expected[role]['height'])
            if actual != wanted:
                raise ValueError('Embedded texture size changed: %s/%s %s != %s' % (material['name'], role, actual, wanted))
            checked.append(dict(material=material['name'], role=role, width=actual[0], height=actual[1], texCoord=info.get('texCoord', 0)))
    def offset(accessor, row):
        a = doc['accessors'][accessor]
        v = doc['bufferViews'][a['bufferView']]
        width = 4 if a['type'] == 'VEC4' else 3
        if a['componentType'] != 5126:
            raise ValueError('Expected float tangent/normal accessor')
        return binary + v.get('byteOffset', 0) + a.get('byteOffset', 0) + row * v.get('byteStride', width * 4)
    fixed, projected, seen = [], [], set()
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            ta, na = primitive['attributes'].get('TANGENT'), primitive['attributes'].get('NORMAL')
            if ta is None or na is None:
                raise ValueError('Missing exported tangents/normals')
            for row in range(doc['accessors'][ta]['count']):
                pos = offset(ta, row)
                if pos in seen:
                    continue
                seen.add(pos)
                tangent = struct.unpack_from('<4f', blob, pos)
                normal = struct.unpack_from('<3f', blob, offset(na, row))
                t = tangent[:3]
                dot = sum(x * n for x, n in zip(t, normal))
                if not math.isfinite(dot):
                    raise ValueError('Non-finite normal or tangent')
                zero = sum(x * x for x in t) <= 1e-12
                # Blender rounds exported vectors. Leave ordinary round-off alone.
                if not zero and abs(dot) <= 1e-3:
                    continue
                normal_sq = sum(n * n for n in normal)
                if normal_sq <= 1e-12 or not math.isfinite(normal_sq):
                    raise ValueError('Invalid normal at degenerate tangent')
                t = [x - n * dot / normal_sq for x, n in zip(t, normal)]
                magnitude = math.hypot(*t)
                if magnitude <= 1e-6:
                    # An undefined direction needs a stable axis in the tangent plane.
                    axis = [0., 0., 0.]
                    axis[min(range(3), key=lambda i: abs(normal[i]))] = 1.
                    x, y, z = normal
                    a, b, c = axis
                    t = [b * z - c * y, c * x - a * z, a * y - b * x]
                    magnitude = math.hypot(*t)
                struct.pack_into('<4f', blob, pos, *(x / magnitude for x in t), -1. if tangent[3] < 0 else 1.)
                (fixed if zero else projected).append(dict(accessor=ta, vertex=row))
    if fixed or projected:
        path.write_bytes(blob)
    return dict(file=path.name, embedded_textures=checked, repaired_zero_tangents=fixed,
                repaired_nonorthogonal_tangents=projected)
