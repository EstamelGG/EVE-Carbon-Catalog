"""Build fixed additive ship attachments from the child BLACK files selected by SOF.

CCP Trinity (MIT), hull child placement, mesh batches and area defaults:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L1981-L2064
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Tr2MeshBase_Blue.cpp#L14-L26
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Tr2MeshArea.cpp#L9-L22
"""
from collections import Counter

from effect_lighting import shader_name
from source_authored_lights import SCHEMAS, SpotlightProjection, UnprojectedRig, _is_beam, _transform
from source_smart_lights import hull_effect_children, placed_effect_root


SHADERS = {'ubershader.fx', 'ubershadertwosided.fx'}
OTHER_PASSES = ('opaqueAreas', 'transparentAreas', 'decalAreas', 'depthAreas', 'distortionAreas')
MESH_SCHEMA = dict(SCHEMAS['Tr2Mesh'], **dict.fromkeys(OTHER_PASSES, 'has_items'))
STATIC_SCHEMAS = dict(SCHEMAS, Tr2Mesh=MESH_SCHEMA,
                      EveChildMesh=dict(SCHEMAS['EveChildMesh'], mesh='record'))


class MeshProjection(SpotlightProjection):
    def field(self, kind):
        if kind == 'has_items':
            # Read every reference, including repeats, to preserve the BLACK object table.
            count = self.value('I')
            for _ in range(count):
                self.object_bounds()
            return bool(count)
        return super().field(kind)


def mesh_tree(node, reader):
    if node is None or node.get('display') is False or node.get('displayFilter', 5) not in (3, 4, 5):
        return None
    children = [branch for child in node.get('objects', []) if (branch := mesh_tree(child, reader))]
    mesh = node.get('mesh') or {}
    areas = mesh.get('additiveAreas', [])
    # Constrained lamp beams already have an owner in the authored spotlight renderer.
    if (mesh.get('display') is False or any(mesh.get(k) for k in OTHER_PASSES)
            or any(shader_name(a.get('effect') or {}) not in SHADERS or a.get('reversed') for a in areas)
            or _is_beam(node, reader)):
        areas = []
    if not children and not areas:
        return None
    result = _transform(node, reader)
    result['objects'] = children
    if areas:
        result['mesh'] = dict(geometryResPath=mesh['geometryResPath'], meshIndex=mesh.get('meshIndex', 0),
                              additiveAreas=[dict(a, index=a.get('index', 0), count=a.get('count', 1))
                                             for a in areas])
    return result


def read_static_mesh(resources, path):
    reader = MeshProjection(resources.read(path), STATIC_SCHEMAS)
    # Controller-selected state and published bindings belong to the animated scene.
    if ('EveChildMesh' not in reader.strings or 'controllers' in reader.strings
            or 'curveSets' in reader.strings or reader.root_type() != 'EveChildContainer'):
        return None
    try:
        root = reader.root('EveChildContainer', STATIC_SCHEMAS['EveChildContainer'])
        return mesh_tree(root, reader)
    except UnprojectedRig:
        return None
    except ValueError as error:
        if str(error).startswith(('Unsupported published class:', 'Unsupported published field:')):
            return None
        raise


def static_mesh_roots(resources, definitions):
    roots = []
    for path, child in hull_effect_children(definitions):
        if resources.has(path):
            tree = resources.static_mesh(path)
            if tree:
                roots.append(placed_effect_root(tree, child))
    return roots


def replace_static_meshes(children, sources):
    """Replace a matching capture's draw inputs while preserving scene target IDs and other passes."""
    source_counts = Counter(node.get('name', '') for node in sources)
    child_counts = Counter(node.get('name', '') for node in children)
    unique = {node.get('name', ''): node for node in sources if source_counts[node.get('name', '')] == 1}
    for child in children:
        name = child.get('name', '')
        source = unique.get(name)
        if source is None or child_counts[name] != 1:
            continue
        if source.get('mesh') and child.get('mesh'):
            original = child['mesh']
            fresh = source['mesh']
            # Match by draw area, so a capture's animation IDs survive material replacement.
            areas = original.get('additiveAreas', [])
            owned = fresh['additiveAreas']
            if (original.get('geometryResPath', '').lower() == fresh['geometryResPath'].lower()
                    and original.get('meshIndex', 0) == fresh['meshIndex']
                    and [(a.get('index', 0), a.get('count', 1)) for a in areas] ==
                        [(a['index'], a['count']) for a in owned]):
                for area, authored in zip(areas, owned):
                    effect = dict(authored['effect'])
                    captured = area.get('effect') or {}
                    for key in ('fxID', 'fxParameters'):
                        if key in captured:
                            effect[key] = captured[key]
                    area['effect'] = effect
        replace_static_meshes(child.get('objects', []), source['objects'])
