"""Read the same base mesh and draw range as Tr2MeshBase at maximum detail."""
from pathlib import Path


def read_beam_meshes(source):
    from carbon_granny import read_raw
    from carbon_gr2 import emit_json, unpack_mesh_tangents
    with Path(source).open('rb') as stream:
        raw = read_raw(stream)
    bases = []
    for mesh in raw.file_info['Meshes']:
        bounds = mesh.get('ExtendedData') or {}
        if bounds.get('typeName') == 'MeshBoundsInfo' and bounds.get('maxScreenSize', 0) > 0:
            continue
        bases.append(mesh)
    projected = emit_json({'Meshes': bases}, raw.version)['meshes']
    result = []
    for source_mesh, projected_mesh in zip(bases, projected):
        unpack_mesh_tangents(projected_mesh)
        topology = source_mesh['PrimaryTopology']
        indices = topology.get('Indices') or topology.get('Indices16') or []
        mask = 0xffffffff if topology.get('Indices') else 0xffff
        if indices and isinstance(indices[0], dict):
            field = next(iter(indices[0]))
            indices = [item[field] for item in indices]
        result.append(dict(vertex=projected_mesh['vertex'], indices=[int(i) & mask for i in indices],
                           areas=[(g['TriFirst'], g['TriCount']) for g in topology['Groups']]))
    return result


def beam_geometry(meshes, resource, checksum, mesh_index, area, count, reversed_indices):
    # GetPrimitiveCount takes at least the first valid area. GetAreaIndexRange
    # begins one contiguous index draw at TriFirst, including for reversed draws.
    mesh = meshes[mesh_index] if 0 <= mesh_index < len(meshes) else None
    first = max(0, area)
    indices = []
    if mesh and first < len(mesh['areas']):
        groups = mesh['areas'][first:first + max(1, count)]
        begin = 3 * groups[0][0]
        length = 3 * sum(n for _, n in groups)
        if begin < 0 or length < 0 or begin + length > len(mesh['indices']):
            raise ValueError('GR2 beam draw exceeds index buffer')
        indices = mesh['indices'][begin:begin + length]
        if reversed_indices:
            indices.reverse()
    # The inline viewer caches BufferGeometry by checksum. Keep each draw
    # distinct while preserving the historical identity for the default range.
    identity = checksum
    if (mesh_index, area, count, reversed_indices) != (0, 0, 1, False):
        identity = f'{checksum}:{mesh_index}:{area}:{count}:{int(reversed_indices)}'
    vertex = mesh['vertex'] if mesh else {'position': [], 'normal': [], 'texcoord0': []}
    return dict(resource=resource, checksum=identity, position=vertex['position'],
                normal=vertex['normal'], uv=vertex['texcoord0'], indices=indices)
