"""Project authored sprite materials from SOF children using the public Blue reader.

Property declarations: carbonengine/trinity f644516, EveChildParticleSystem_Blue.cpp,
Tr2InstancedMesh_Blue.cpp, Tr2Mesh_Blue.cpp, Tr2MeshArea_Blue.cpp and Tr2Effect_Blue.cpp.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/EveChildParticleSystem_Blue.cpp
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Tr2InstancedMesh_Blue.cpp
EveChildContainer.h declares inheritProperties as an object pointer.
EquipmentProjection implements the Blue stream format and effect parameter layouts.
"""
from source_authored_lights import TRANSFORM
from source_gate_colors import gate_color_bindings
from source_cloud_brightness import cloud_brightness_bindings
from source_equipment import EFFECT_SCHEMAS, EquipmentProjection
from source_smart_lights import rig_paths
from sof_resources import UnsupportedSofDNA
from sof_attachments import attachment_definitions

ATLAS_SPRITE = '1layerdynv2.fx'
LAYERED_SPRITES = {'2layerdynmaskv2.fx', '2layermodulatenoatlasv2.fx', '2layermask.fx'}
SPRITES = LAYERED_SPRITES | {ATLAS_SPRITE}
AREA_LISTS = ('additiveAreas', 'transparentAreas', 'distortionAreas', 'opaqueAreas')
MESH = dict(name='string', geometryResPath='string', meshIndex='i', display='?',
            deferGeometryLoad='?', instanceGeometryResource='object', instanceGeometryResPath='string',
            minBounds='3f', maxBounds='3f', boundsMethod='I', maxInstanceSize='f',
            depthAreas='objects', **{kind: 'records' for kind in AREA_LISTS})
PARTICLE_TRANSFORM = dict(TRANSFORM, transformModifiers='objects')
SCHEMAS = dict(EFFECT_SCHEMAS,
    EveChildContainer=dict(PARTICLE_TRANSFORM, objects='children', inheritProperties='object', controllers='objects', curveSets='objects', lights='objects'),
    EveChildParticleSystem=dict(PARTICLE_TRANSFORM, mesh='record', reflectionMode='I', particleEmitters='objects', particleSystems='objects'),
    Tr2InstancedMesh=MESH,
    Tr2MeshArea=dict(name='string', effect='record', index='I', count='I', reversed='?', display='?'))


class ParticleProjection(EquipmentProjection):
    particle_fields = {'name', 'mesh'}

    def class_at(self, bounds):
        resume = self.offset
        self.offset = bounds[0]
        cls = self.string()
        self.offset = resume
        return cls

    def field(self, kind):
        if kind != 'children':
            return super().field(kind)
        children = []
        for _ in range(self.value('I')):
            bounds = self.object_bounds()
            if bounds is None:
                continue
            cls = self.class_at(bounds)
            if cls == 'EveChildContainer':
                children.append(self.record_at(bounds, required_fields={'objects'}))
            elif cls == 'EveChildParticleSystem':
                children.append(self.record_at(bounds, required_fields=self.particle_fields))
        return children


def sprite_areas(node, parents=()):
    chain = (*parents, node.get('name', ''))
    for kind in AREA_LISTS:
        for index, area in enumerate((node.get('mesh') or {}).get(kind, [])):
            effect = area.get('effect') or {}
            if effect.get('effectFilePath', '').lower().rsplit('/', 1)[-1] in SPRITES:
                yield (chain, kind, index), effect
    for child in node.get('objects', []):
        yield from sprite_areas(child, chain)


def particle_children(resources, dna, reader_class, schemas, markers):
    try:
        definitions = attachment_definitions(resources, dna)
    except UnsupportedSofDNA:
        return
    for path in dict.fromkeys(rig_paths(definitions)):
        try:
            content = resources.read(path)
        except FileNotFoundError:
            continue
        names = content.lower()
        if not any(marker in names for marker in markers):
            continue
        reader = reader_class(content, schemas)
        if reader.root_type() != 'EveChildContainer':
            continue
        try:
            root = reader.record_at(reader.object_bounds(), required_fields={'objects'})
        except ValueError as error:
            # The declared projection covers only a subset of child/mesh classes.
            # A different published schema keeps the capture provenance visible in the output.
            if not str(error).startswith(('Unsupported published class:', 'Unsupported published field:')):
                raise
            continue
        yield path, content, reader, root


def sprite_materials_for_dna(resources, dna):
    materials = {}
    markers = tuple(shader.encode() for shader in SPRITES)
    for path, content, reader, root in particle_children(resources, dna, ParticleProjection, SCHEMAS, markers):
        areas = list(sprite_areas(root))
        ref_by_object = {id(reader.objects[start]): ref for ref, (start, _) in reader.references.items()
                         if start in reader.objects}
        bindings = {}
        for field, name, shaders, project in (
                ('gateColorBinding', 'SpriteColor', (ATLAS_SPRITE, '2layermask.fx'), gate_color_bindings),
                ('cloudBrightnessBinding', 'Brightness', ('2layermask.fx',), cloud_brightness_bindings)):
            destinations = {key: ref_by_object[id(p)] for key, effect in areas
                            if effect['effectFilePath'].lower().rsplit('/', 1)[-1] in shaders
                            for p in effect.get('parameters', []) if p.get('name') == name}
            if not destinations:
                continue
            try:
                values = project(content, SCHEMAS['EveChildContainer'], set(destinations.values()))
            except ValueError as error:
                if not str(error).startswith(('Unsupported published class:', 'Unsupported published field:')):
                    raise
                continue
            for key, target in destinations.items():
                if target in values:
                    bindings.setdefault(key, {})[field] = values[target]
        for key, effect in areas:
            if key in bindings:
                effect = dict(effect, **bindings[key])
            value = (resources.key(path), effect)
            if key in materials and materials[key] != value:
                materials[key] = None
            else:
                materials[key] = value
    return materials
