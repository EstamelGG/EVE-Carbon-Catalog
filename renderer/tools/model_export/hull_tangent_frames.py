"""Project verified EVE hull tangent declarations after Granny section decoding.

The pinned CarbonEngineJS reader supplies the reflected GR2 data, mesh graph
and animation curves. CCP's Carbon Mesh and Trinity supply the legacy vertex
frame mathematics used here. Copyright © 2026 CCP ehf. and Fenris Creations.
MIT terms: ../../docs/licenses/carbon-trinity-MIT.txt.
https://github.com/carbonengine/mesh/blob/b0e5c24aed6384dd06b7b62bfa9ff556c84516fa/src/cmf/utils.cpp#L306-L318
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shaders/include/Carbon/PackedTangents.fxh#L61-L78
"""
from pathlib import Path
import struct

import numpy as np


def unpack_hull_tangents(mesh, vertices, unorm_maxima):
    declaration = {m['name']: m for m in getattr(vertices, 'granny_type', ())}
    tangent = declaration.get('Tangent')
    if not tangent or 'Normal' in declaration or 'Binormal' in declaration:
        return False
    maximum = unorm_maxima.get(tangent['type'])
    if not maximum or tangent['array_width'] != 4 or not vertices:
        return False

    # Read the declared integer components before any third-party tangent expansion.
    packed = np.asarray([v['Tangent'] for v in vertices], dtype=np.float64)
    angles = packed * (2.0 * np.pi / maximum) - np.pi
    azimuth = angles[:, (0, 2)]
    polar = angles[:, (1, 3)]
    radial = np.abs(np.sin(polar))
    # Exact poles have no radial component. Keeping that zero prevents numerical
    # noise from becoming an arbitrary unit normal during Blender normalization.
    polar_codes = packed[:, (1, 3)]
    radial[(polar_codes == 0) | (polar_codes == maximum)] = 0.0
    basis = np.stack((np.cos(azimuth) * radial, np.sin(azimuth) * radial, np.cos(polar)), axis=2)
    tangent, bitangent = basis[:, 0], basis[:, 1]
    normals = np.cross(bitangent, tangent)
    normals[(polar > 0.0).all(axis=1)] *= -1
    mesh['vertex'].update(normal=normals.ravel().tolist(), tangent=tangent.ravel().tolist(),
                          binormal=bitangent.ravel().tolist())
    return True


def read_hull_gr2(path):
    from carbon_granny import MEMBER_TYPES, read_raw, is_gstate_root
    from carbon_gr2 import Gr2Error, emit_json, decompress_animation_curves, unpack_mesh_tangents

    try:
        with Path(path).open('rb') as stream:
            raw = read_raw(stream)
        if is_gstate_root(raw.file_info):
            raise Gr2Error('Granny State files are not render geometry')
        graph = emit_json(raw.file_info, raw.version)
        decompress_animation_curves(graph)
        unorm_maxima = {MEMBER_TYPES['NormalUInt8']: 255, MEMBER_TYPES['NormalUInt16']: 65535}
        sources = (m for m in raw.file_info.get('Meshes') or [] if m)
        for mesh, source in zip(graph['meshes'], sources, strict=True):
            vertices = (source.get('PrimaryVertexData') or {}).get('Vertices') or []
            if not unpack_hull_tangents(mesh, vertices, unorm_maxima):
                # Explicit normals pass through. Unrecognized legacy layouts
                # retain the pinned reader's existing behavior.
                unpack_mesh_tangents(mesh)
        return graph
    except Gr2Error:
        raise
    except (IndexError, KeyError, TypeError, ValueError, struct.error) as error:
        raise Gr2Error(str(error)) from error
