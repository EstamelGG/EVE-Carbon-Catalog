"""Project static spotlight clusters out of SOF child files.

CCP Trinity (MIT): EveChildContainer.objects, EveChildMesh.mesh,
EveChildQuad and EveChildTransform. Unrelated particle data remains opaque.
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children
"""
from collections import defaultdict, deque

from effect_lighting import TRANSFORM_FIELDS, authored_issues, shader_name
from sof_texture_schema import fields
from source_effect_options import compiled_depth_path
from source_equipment import EFFECT_SCHEMAS, EquipmentProjection
from source_smart_light_graph import SCHEMAS as SMART_SCHEMAS
from source_smart_lights import hull_effect_children, placed_effect_root

CONSTRAINED = 'EveChildModifierCameraOrientedRotationConstrained'
TRANSFORM = fields(string='name', records='transformModifiers', **{
    '3f': 'translation scaling', '4f': 'rotation', '16f': 'localTransform',
    '?': 'useSRT staticTransform useStaticRotation useStaticScale display useDynamicLod',
    'I': 'displayFilter', 'f': 'minScreenSize lodSphereRadius'})
CONTAINER = dict(SMART_SCHEMAS['EveChildContainer'], **TRANSFORM)
CONTAINER.update(objects='child_nodes', curveSets='records', controllers='has_controllers',
                 inheritProperties='opaque_inheritance')
SCHEMAS = dict(EFFECT_SCHEMAS,
    EveChildContainer=CONTAINER,
    TriCurveSet=dict(name='string', curves='objects', bindings='objects', ranges='objects', scale='f',
                     playOnLoad='?', driver='has_object'),
    EveChildMesh=dict(TRANSFORM, mesh='beam_mesh', reflectionMode='I', attachments='objects', lights='objects', curveSets='records'),
    EveChildQuad=dict(TRANSFORM, effect='record', color='4f', brightness='f'),
    Tr2Mesh=fields(string='name geometryResPath', i='meshIndex', records='additiveAreas', **{'?': 'deferGeometryLoad display'},
                   objects='transparentAreas opaqueAreas distortionAreas depthAreas'),
    Tr2MeshArea=dict(SMART_SCHEMAS['Tr2MeshArea'], reversed='?', display='?'),
    EveChildModifierCameraOrientedRotationConstrained={}, EveChildModifierHalo={},
    EveChildModifierSRT=TRANSFORM, EveChildModifierBillboard3D=dict(fixed='?'))
DRAWABLE = {'EveChildContainer', 'EveChildMesh', 'EveChildQuad'}


class UnprojectedRig(ValueError):
    """Leave this child under the existing scene loader's ownership."""


class SpotlightProjection(EquipmentProjection):
    def skip_nested_reference(self):
        # Blue BlackWriter.cpp:214-242 assigns consecutive IDs to definitions.
        # A higher ID previously defined in the stream proves that this missing
        # ID is a backreference into a subtree skipped by the projection.
        offset = self.offset
        ref = self.value('I')
        if ref and ref not in self.references and any(
            known > ref and start - 8 < offset for known, (start, _) in self.references.items()
        ):
            return True
        self.offset = offset
        return False

    def object_bounds(self):
        if self.skip_nested_reference():
            raise UnprojectedRig('Light projection needs an object inside an opaque subtree')
        return super().object_bounds()

    def skip_object(self):
        return self.skip_nested_reference() or super().object_bounds() is not None

    def field(self, kind):
        if kind == 'objects':
            for _ in range(self.value('I')):
                self.skip_object()
            return None
        if kind in ('opaque_inheritance', 'object'):
            self.skip_object()
            return None
        if kind == 'beam_mesh':
            bounds = self.object_bounds()
            if bounds is None:
                return None
            # Other passes may own geometry modifiers after the additive list.
            required = {'geometryResPath', 'additiveAreas'}
            if 'meshIndex' in self.strings:
                required.add('meshIndex')
            return self.record_at(bounds, required_fields=required)
        if kind == 'has_object':
            return self.skip_object()
        if kind == 'has_controllers':
            return any([self.skip_object() for _ in range(self.value('I'))])
        if kind != 'child_nodes':
            return super().field(kind)
        children = []
        for _ in range(self.value('I')):
            bounds = self.object_bounds()
            if bounds is None:
                children.append(None)
                continue
            resume = self.offset
            self.offset = bounds[0]
            cls = self.string()
            self.offset = resume
            if cls in DRAWABLE:
                children.append(self.record_at(bounds))
            elif cls == 'EveChildParticleSystem':
                # A particle-system leaf cannot belong to a static lamp cluster.
                children.append(None)
            else:
                raise UnprojectedRig(cls)
        return children


def _transform(node, reader):
    result = {key: node[key] for key in TRANSFORM_FIELDS if key in node}
    result['type'] = 'trinity.' + reader.types[id(node)]
    # Match constructor defaults used by the scene renderer and the rig owner.
    if result['type'].startswith('trinity.EveChildModifier'):
        return result
    result['transformModifiers'] = [_transform(m, reader) for m in node.get('transformModifiers', [])]
    for key, value in (('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]), ('scaling', [1, 1, 1]),
                       ('display', True), ('useSRT', True), ('staticTransform', False),
                       ('useStaticScale', False), ('useStaticRotation', False), ('name', '')):
        result.setdefault(key, value)
    # EveChildTransform::RebuildLocalTransform composes the authored SRT,
    # including static quads during Initialize. Retain explicit matrix mode.
    if result['useSRT']:
        result.pop('localTransform', None)
    return result


def _is_beam(node, reader):
    if node is None or reader.types[id(node)] != 'EveChildMesh':
        return False
    areas = (node.get('mesh') or {}).get('additiveAreas', [])
    return (len(areas) == 1 and shader_name(areas[0].get('effect') or {}) == 'ubershader.fx' and
            any(reader.types[id(m)] == CONSTRAINED for m in node.get('transformModifiers', [])))


def _is_member(node, reader):
    if node is None or node.get('curveSets'):
        return False
    if reader.types[id(node)] == 'EveChildMesh':
        return _is_beam(node, reader)
    return all(_is_member(c, reader) for c in node.get('objects', []))


def _effect(value, resources):
    path = value['effectFilePath']
    if '/effect/' not in path.lower():
        raise UnprojectedRig(path)
    compiled = compiled_depth_path(path)
    if not resources.has(compiled):
        raise UnprojectedRig(compiled)
    return dict(value, actualEffectFilePath=compiled, options=list(value.get('options', {}).items()),
                optionDefaults=list(resources.effect_defaults(compiled).items()))


def _lamp(node, reader, resources):
    result = _transform(node, reader)
    if result['type'] == 'trinity.EveChildQuad':
        if node.get('minScreenSize'):
            result['minScreenSize'] = node['minScreenSize']
        result.update(color=node.get('color', [1, 1, 1, 1]), brightness=node.get('brightness', 1))
        effect = node.get('effect') or {}
        if shader_name(effect) != 'flarequad.fx':
            raise UnprojectedRig('unsupported lamp material')
        result['effect'] = _effect(effect, resources)
    elif node.get('mesh'):
        mesh = node['mesh']
        result['mesh'] = dict(mesh, additiveAreas=[dict(a, effect=_effect(a['effect'], resources))
                                                   for a in mesh['additiveAreas']])
    result['objects'] = [_lamp(c, reader, resources) for c in node.get('objects', [])]
    return result


def _controlled(node):
    return node.get('controllers') or any(_controlled(c) for c in node.get('objects', []) if c is not None)


def _clusters(node, reader, resources, parents, path, controlled=False):
    if any(not curves.get('driver') for curves in node.get('curveSets', [])):
        return
    children = node.get('objects', [])
    if any(_is_beam(c, reader) for c in children) and _is_member(node, reader):
        if controlled or _controlled(node):
            raise UnprojectedRig('controller on lamp branch')
        yield dict(parents=parents, node=_lamp(node, reader, resources), sourceRigPath=path)
        return
    for index, child in enumerate(children):
        if child is not None and reader.types[id(child)] == 'EveChildContainer':
            yield from _clusters(child, reader, resources, parents + [_transform(node, reader)],
                                 path + [index, child.get('name', '')], controlled or node.get('controllers'))


def read_spotlight_clusters(resources, path):
    reader = SpotlightProjection(resources.read(path), SCHEMAS)
    if (CONSTRAINED not in reader.strings or 'EveChildMesh' not in reader.strings or
            not any(s.lower().endswith('/ubershader.fx') for s in reader.strings)):
        return []
    if reader.root_type() != 'EveChildContainer':
        return None
    try:
        root = reader.root('EveChildContainer', CONTAINER)
        rigs = list(_clusters(root, reader, resources, [], [root.get('name', '')]))
    except UnprojectedRig:
        return None
    except ValueError as error:
        # Published classes outside this projection stay with the scene loader.
        if str(error).startswith(('Unsupported published field:', 'Unsupported published class:')):
            return None
        raise
    return None if authored_issues(rigs) else rigs


def hull_spotlight_clusters(resources, definitions):
    """None denotes a root whose lamp hierarchy still needs the scene loader."""
    result = []
    for path, child in hull_effect_children(definitions):
        if not resources.has(path):
            return None
        rigs = resources.spotlight_clusters(path)
        if rigs is None:
            return None
        for rig in rigs:
            parents = rig['parents']
            if parents:
                result.append(dict(rig, parents=[placed_effect_root(parents[0], child), *parents[1:]]))
            else:
                result.append(dict(rig, node=placed_effect_root(rig['node'], child)))
    # Two same-named roots can produce the same scene address. Keep their
    # scene ordering and ownership until the root references can be distinguished.
    paths = {tuple(rig['sourceRigPath']) for rig in result}
    return result if len(paths) == len(result) else None


def assemble_authored_clusters(clusters, recorded):
    """Replace covered entries in scene order and retain independently owned lamps."""
    by_path = {tuple(rig['sourceRigPath']): rig for rig in clusters}
    by_names = defaultdict(deque)
    for path in by_path:
        by_names[path[::2]].append(path)
    result = []
    for entry in recorded:
        if 'sourceRigPath' in entry:
            path = tuple(entry['sourceRigPath'])
        else:
            # Older captures identify parents and children by name without indices.
            names = tuple(n.get('name', '') for n in [*entry['parents'], entry['node']])
            matches = by_names[names]
            while matches and matches[0] not in by_path:
                matches.popleft()
            path = matches.popleft() if matches else None
        if path in by_path:
            result.append(by_path.pop(path))
        elif 'node' in entry:
            result.append(entry)
        else:
            raise ValueError('Scene lamp address missing from current SOF resources: %r' % (path,))
    result.extend(by_path.values())
    return result
