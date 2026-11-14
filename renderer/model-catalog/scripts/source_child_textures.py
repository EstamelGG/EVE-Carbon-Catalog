"""Named texture parameters on SOF child mesh effects, including animated children.

https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Shader/Tr2Effect_Blue.cpp
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Tr2MeshArea.cpp
"""
from effect_lighting import shader_name
from mesh_effect_options import mesh_effect_options
from resource_errors import MissingResourceError
from source_authored_lights import SpotlightProjection, UnprojectedRig
from source_particle_materials import AREA_LISTS, MESH, PARTICLE_TRANSFORM, SCHEMAS
from source_smart_lights import rig_paths


SHADERS = {'ubershader.fx', 'ubershadertwosided.fx', 'ubershadercube.fx', 'texturecolor.fx'}
MESH_SCHEMAS = dict(SCHEMAS, Tr2Mesh=MESH,
    EveChildContainer=dict(SCHEMAS['EveChildContainer'], objects='mesh_children'),
    EveChildMesh=dict(PARTICLE_TRANSFORM, mesh='record', reflectionMode='I',
                      attachments='objects', lights='objects', curveSets='objects'))


class TextureProjection(SpotlightProjection):
    def field(self, kind):
        if kind != 'mesh_children':
            return super().field(kind)
        children = []
        for _ in range(self.value('I')):
            bounds = self.object_bounds()
            if bounds is None:
                continue
            resume = self.offset
            self.offset = bounds[0]
            cls = self.string()
            self.offset = resume
            if cls == 'EveChildContainer':
                children.append(self.record_at(bounds, required_fields={'name', 'objects'}))
            elif cls == 'EveChildMesh':
                children.append(self.record_at(bounds, required_fields={'name', 'mesh'}))
        return children


def draw_key(chain, mesh, kind, area):
    return (chain, mesh['geometryResPath'].lower(), mesh.get('meshIndex', 0), kind,
            area.get('index', 0), area.get('count', 1), area['effect']['effectFilePath'].lower())


def child_draws(node, parents=()):
    chain = (*parents, node.get('name', ''))
    mesh = node.get('mesh') or {}
    for kind in AREA_LISTS:
        for area in mesh.get(kind, []):
            if shader_name(area.get('effect') or {}) in SHADERS and mesh.get('geometryResPath'):
                yield draw_key(chain, mesh, kind, area), area
    for child in node.get('objects', []):
        yield from child_draws(child, chain)


def missing_mesh_textures(effect, resources):
    shader = shader_name(effect)
    if shader == 'texturecolor.fx':
        roles = {'DiffuseMap'}
    elif shader == 'ubershadercube.fx':
        roles = {'DiffuseMap1', 'DiffuseMap2', 'MainCubeMap', 'MaskMap'}
    else:
        options = dict(effect.get('optionDefaults', []))
        options.update(effect.get('options', []))
        if shader == 'ubershadertwosided.fx' or 'DIFFUSE_MAP_COUNT' not in options:
            try:
                options = mesh_effect_options(effect, resources, resources.material_options)
            except MissingResourceError:
                return set()
        layers = {'TWO': 2, 'THREE': 3}.get(options.get('DIFFUSE_MAP_COUNT'), 1)
        roles = {'MaskMap', *('DiffuseMap%d' % n for n in range(1, layers + 1))}
    return roles.difference(p['name'] for p in effect.get('resources', []))


def apply_child_textures(resources, definitions, children):
    draws = [(key, area, missing) for node in children for key, area in child_draws(node)
             if (missing := missing_mesh_textures(area['effect'], resources))]
    if not draws:
        return
    wanted = {key for key, _, _ in draws}
    authored = {}
    for path in dict.fromkeys(rig_paths(definitions)):
        if not resources.has(path):
            continue
        reader = TextureProjection(resources.read(path), MESH_SCHEMAS)
        if reader.root_type() != 'EveChildContainer' or 'EveChildMesh' not in reader.strings:
            continue
        try:
            root = reader.record_at(reader.object_bounds(), required_fields={'name', 'objects'})
        except UnprojectedRig:
            continue
        except ValueError as error:
            if str(error).startswith(('Unsupported published class:', 'Unsupported published field:')):
                continue
            raise
        for key, area in child_draws(root):
            if key not in wanted:
                continue
            bindings = {p['name']: p['resourcePath'] for p in area['effect'].get('resources', [])
                        if p and p.get('name') and p.get('resourcePath')}
            if key in authored and authored[key] != bindings:
                authored[key] = None
            else:
                authored[key] = bindings
    updates = {}
    for key, area, missing in draws:
        bindings = authored.get(key) or {}
        recovered = {name: path for name, path in bindings.items() if name in missing}
        # BLACK references can put the same area in several scene branches.
        previous = updates.get(id(area))
        if previous and previous[1] != recovered:
            recovered = {}
        updates[id(area)] = (area, recovered)
    for area, recovered in updates.values():
        if recovered:
            effect = area['effect']
            # Preserve explicit runtime replacements and shader defaults.
            added = [dict(name=name, resourcePath=path) for name, path in recovered.items()]
            area['effect'] = dict(effect, resources=[*effect.get('resources', []), *added])
