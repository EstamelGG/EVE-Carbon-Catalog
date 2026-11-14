"""Build stationary CPU particle branches from SOF child BLACK resources.

Trinity f644516: EveChildParticleSystem, Tr2InstancedMesh, Tr2DynamicEmitter.
The mesh, emitter and simulation must reference the same particle system.
"""
from effect_gate import pack_gate
from effect_lighting import shader_name
from source_authored_lights import _transform
from source_particle_emitters import EmitterProjection, SCHEMA, node_emitters
from source_particle_materials import AREA_LISTS, SPRITES, sprite_areas
from source_smart_lights import hull_effect_children, placed_effect_root


PARTICLE = 'EveChildParticleSystem'
CONTAINER = 'EveChildContainer'
SCHEMAS = dict(SCHEMA,
    EveChildContainer=dict(SCHEMA[CONTAINER], objects='particle_children', inheritProperties='link'),
    Tr2InstancedMesh=dict(SCHEMA['Tr2InstancedMesh'], instanceGeometryResource='link', depthAreas='link_count'))


class HullParticles(EmitterProjection):
    def __init__(self, content, schemas):
        super().__init__(content, schemas)
        self.other_children = set()

    def field(self, kind):
        if kind != 'particle_children':
            return super().field(kind)
        children = []
        for _ in range(self.value('I')):
            bounds = self.object_bounds()
            if bounds:
                child_type = self.class_at(bounds)
                if child_type in (CONTAINER, PARTICLE):
                    children.append(self.record_at(bounds))
                elif child_type not in ('EveChildMesh', 'EveChildQuad'):
                    self.other_children.add(child_type)
        return children


def drawable_particle(node, reader):
    mesh = node.get('mesh') or {}
    systems = node.get('particleSystems', [])
    emitters = node.get('particleEmitters', [])
    areas = [a for key in AREA_LISTS for a in mesh.get(key, [])]
    return (reader.types.get(id(mesh)) == 'Tr2InstancedMesh'
            and mesh.get('geometryResPath', '').lower() == 'res:/graphics/generic/unit_plane.gr2'
            and not mesh.get('instanceGeometryResPath')
            and mesh.get('meshIndex', 0) == 0 and not mesh.get('depthAreas') and areas
            and all(a and a.get('index', 0) == 0 and a.get('count', 1) == 1 and not a.get('reversed')
                    and shader_name(a.get('effect') or {}) in SPRITES for a in areas)
            and len(systems) == 1 and systems[0] and mesh.get('instanceGeometryResource') == systems[0]
            and emitters and all(e and e.get('particleSystem') == systems[0] for e in emitters))


def project_branch(reader, node, recipes, path, issues, parent=()):
    chain = (*parent, node.get('name', ''))
    if not node.get('display', True) or node.get('displayFilter', 5) not in (3, 4, 5):
        return None
    inherit = node.get('inheritProperties')
    if inherit and (reader.class_at(inherit) != 'EveChildInheritProperties' or inherit[1]-inherit[0] != 2):
        issues.append(dict(resource=path, node=chain, reason='particle-inherit-properties'))
        return None
    tree = _transform(node, reader)
    if reader.types[id(node)] == PARTICLE:
        if not drawable_particle(node, reader):
            issues.append(dict(resource=path, node=chain, reason='particle-mesh-or-system-link'))
            return None
        inputs = [recipes.get((chain, i)) for i in range(len(node['particleEmitters']))]
        if not all(r and r.get('system') for r in inputs):
            issues.append(dict(resource=path, node=chain, reason='particle-generator-or-system'))
            return None
        tree.update(mesh=node['mesh'], particleEmitters=inputs)
        tree.update({field:node[field] for field in ('minScreenSize','lodSphereRadius','reflectionMode') if field in node})
    else:
        tree['objects'] = [branch for c in node.get('objects', [])
                           if (branch := project_branch(reader, c, recipes, path, issues, chain))]
        if not tree['objects']:
            return None
    return tree


def pack_hull_particles(resources, definitions, assets):
    """Return the regular ship scene effect and per-resource projection gaps."""
    scene = None
    issues = []
    for path, placement in hull_effect_children(definitions):
        if not resources.has(path):
            continue
        content = resources.read(path)
        reader = HullParticles(content, SCHEMAS)
        if PARTICLE not in reader.strings:
            continue
        source = resources.key(path)
        if 'Tr2DynamicEmitter' not in reader.strings:
            issues.append(dict(resource=source, reason='particle-emitter-type'))
            continue
        # A controller or curve on another branch can target this emitter. Without
        # its binding graph, a fixed local transform or fixed rate would be wrong.
        if any(s in reader.strings for s in ('controllers', 'curveSets', 'transformModifiers')):
            issues.append(dict(resource=source, reason='particle-animation-or-modifiers'))
            continue
        if reader.root_type() != CONTAINER:
            issues.append(dict(resource=source, reason='particle-root-type'))
            continue
        try:
            root = reader.root(CONTAINER, SCHEMAS[CONTAINER])
            for child_type in sorted(reader.other_children):
                issues.append(dict(resource=source, reason='particle-child-hierarchy', childType=child_type))
            entries = list(node_emitters(reader, root, {}, {}))
            recipes = dict(entries)
            if len(entries) != len(recipes):
                issues.append(dict(resource=source, reason='particle-duplicate-names'))
                continue
            tree = project_branch(reader, root, recipes, source, issues)
        except ValueError as error:
            if not str(error).startswith(('Unsupported published class:', 'Unsupported published field:')):
                raise
            issues.append(dict(resource=source, reason=str(error)))
            continue
        if tree is None:
            continue
        tree = placed_effect_root(tree, placement)
        paths = {key: (source, recipe) for key, recipe in entries}
        materials = {key: (source, effect) for key, effect in sprite_areas(root)}
        part = pack_gate(dict(children=[tree], sceneAnimation=dict(version=1, generic=True, targets=[], sets=[])),
                         assets, generic=True, read_options=resources.material_options,
                         read_emitters=lambda: paths, read_sprite_materials=lambda: materials)
        issues.extend(part['unsupported'])
        if not part['particles']:
            continue
        if scene is None:
            scene = part
        else:
            for particle in part['particles']:
                if 'particleNodeIndex' in particle:
                    particle['particleNodeIndex'] += len(scene['particles'])
            scene['particles'].extend(part['particles'])
    if scene:
        scene['unsupported'] = issues
    return scene, issues
