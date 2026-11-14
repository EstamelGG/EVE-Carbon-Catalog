"""Geometry fields for authored EveBezierCurve paths in SOF child line sets."""
from sof_texture_schema import fields
from source_authored_lights import TRANSFORM
from source_particle_emitters import EmitterProjection
from source_particle_materials import SCHEMAS, particle_children

# Trinity EveChildLineSet_Blue.cpp, EveLineChildContainer_Blue.cpp and EveBezierCurve_Blue.cpp.
# https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/LineSetPaths
LINE_SET = dict(TRANSFORM, lines='path_list', alwaysOn='?', renderType='I', additiveBatches='?',
                scrollSpeed='f', brightness='f', baseColor='4f', animColor='4f', lineSet='object', mesh='object')
CURVE = dict(TRANSFORM, **fields(f='completeness segments segmentOffset lineWidth movementSpeed animValue',
             **{'?': 'scaleSegmentsByCompleteness scaleEndpoints billboardObjects',
                '3f': 'objectScale point1 point2 bezierPoint'}))
SCHEMA = dict(SCHEMAS, EveChildLineSet=LINE_SET, EveBezierCurve=CURVE,
              EveLineChildContainer=dict(TRANSFORM, lines='path_list'))
# EveBezierCurve constructor defaults. Live bindings may override individual fields.
DEFAULTS = dict(point1=[0, 0, 0], point2=[0, 0, 0], bezierPoint=[0, 0, 0],
                segments=24, completeness=1, segmentOffset=0, scaleSegmentsByCompleteness=True)


class LineProjection(EmitterProjection):
    def field(self, kind):
        if kind not in ('children', 'path_list'):
            return super().field(kind)
        result = []
        for _ in range(self.value('I')):
            bounds = self.object_bounds()
            cls = self.class_at(bounds) if bounds else None
            if kind == 'children':
                if cls in ('EveChildContainer', 'EveChildLineSet'):
                    required = {'objects'} if cls == 'EveChildContainer' else {'lines'}
                    result.append(self.record_at(bounds, required_fields=required | {'name'}))
            else:
                result.append(self.record_at(bounds) if cls in ('EveBezierCurve', 'EveLineChildContainer') else None)
        return result


def authored_paths(reader, node, parents=()):
    chain = (*parents, node.get('name', ''))
    def visit(paths, prefix=()):
        for i, path in enumerate(paths):
            if path is None:
                continue
            index = (*prefix, i)
            if reader.types[id(path)] == 'EveBezierCurve':
                yield (chain, index), (path.get('name', ''), {k: path.get(k, v) for k, v in DEFAULTS.items()})
            else:
                yield from visit(path.get('lines', []), index)
    yield from visit(node.get('lines', []))
    for child in node.get('objects', []):
        yield from authored_paths(reader, child, chain)


def bezier_paths_for_dna(resources, dna):
    result = {}
    for path, _, reader, root in particle_children(resources, dna, LineProjection, SCHEMA, (b'evebeziercurve',)):
        for key, (name, geometry) in authored_paths(reader, root):
            value = (resources.key(path), name, geometry)
            result[key] = value if key not in result or result[key] == value else None
    return result


def resolve_line_paths(paths, read_sources, chain, prefix=()):
    result = []
    for i, path in enumerate(paths):
        index = (*prefix, i)
        if path['type'] == 'trinity.EveLineChildContainer':
            path = dict(path, lines=resolve_line_paths(path.get('lines', []), read_sources, chain, index))
        elif path['type'] == 'trinity.EveBezierCurve':
            source = read_sources().get((chain, index)) if read_sources else None
            if source and source[1] == path.get('name', ''):
                resource, _, geometry = source
                overrides = {k: path[k] for k, v in geometry.items() if k in path and path[k] != v}
                path = {**path, **geometry, **overrides, 'pathSource': resource, 'capturedPathFields': sorted(overrides)}
            else:
                path = dict(path, pathSource=path.get('sourceFile') or 'capture')
        result.append(path)
    return result
