"""Build projected hull decal inputs using EveSOF::SetupDecalSets (CCP Trinity, MIT).
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L3156-L3288
"""
import struct

from sof_locators import placed_hulls
from sof_parameters import faction_color
from sof_sprites import f32
from sof_textures import faction_texture, texture_insert


SHADERS = ('decalv5.fx', 'decalcounterv5.fx', 'decalholev5.fx', 'decalcylindricv5.fx',
           'decalglowcylindricv5.fx', 'decalglowv5.fx', 'decalv5.fx')
LOGOS = ('Primary', 'Secondary', 'Tertiary', 'Marking_01', 'Marking_02')


def lod_index_buffers(item, combined_geometry):
    buffers = item.get('indexBuffers', [])
    if combined_geometry:
        buffers = next((entry.get('indexBuffers', []) for entry in item.get('multiHullIndexBuffers', [])
                        if entry.get('combinedGeometryResPath', '').lower() == combined_geometry), [])
    if not any(b.get('indexBuffer') for b in buffers):
        return []
    # The web mesh uses the first LOD. Trinity serializes an array of uint32_t.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFData.cpp#L963-L984
    raw = buffers[0].get('indexBuffer', b'')
    return [[v for v, in struct.iter_unpack('<I', raw)]]


def decal_effect(item, faction, location, shaders, opaque, resources, insert):
    usage = item.get('usage', 0)
    logo = {}
    textures = {t['name']: t['resFilePath'] for t in item.get('textures', [])}
    if usage == 6:
        logo = (faction.get('logoSet') or {}).get(LOGOS[item.get('logoType', 0)]) or {}
        if not logo.get('textures'):
            return None
    shader = shaders.get(SHADERS[usage], {})
    for t in shader.get('defaultTextures', []):
        textures.setdefault(t['name'], t['resFilePath'])
    # EveSOFDNA::GetHullTextureWithMeshIndex looks up the authored opaque area index.
    area = opaque.get(item.get('meshIndex', -1), {})
    for t in area.get('textures', []):
        if t['name'] in shader.get('parentTextures', []):
            textures.setdefault(t['name'], faction_texture(resources, t['resFilePath'], insert))
    for t in logo.get('textures', []):
        textures.setdefault(t['name'], t['resFilePath'])
    params = {}
    if usage not in (0, 6):
        params['DecalGlowColor'] = faction_color(faction, item.get('glowColorType', 0))
    # Tr2Effect rejects a second binding of the same name.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Shader/Tr2Effect.cpp#L484-L529
    for name, value in item.get('parameters', {}).items():
        params.setdefault(name, value)
    return dict(effectFilePath=location + SHADERS[usage],
                resources=[dict(name=k, resourcePath=v) for k, v in textures.items()],
                parameters=[dict(name=k, value=v) for k, v in params.items()])


def decal_inputs(resources, definitions, geometry, dna=''):
    hulls, faction, visible, _ = definitions
    if not any(hull.get('decalSets') for hull in hulls):
        return []
    generic = resources.generic
    location = generic['decalShaderLocation'].rstrip('/') + '/' + generic.get('shaderPrefix', '')
    shaders = {s['shader'].lower(): s for s in generic.get('decalShaders', [])}
    commands = {}
    for token in dna.lower().split(':')[3:]:
        key, sep, value = token.partition('?')
        if sep:
            commands[key] = value.split(';')
    insert = texture_insert(faction, commands)
    combined_geometry = geometry.lower() if len(hulls) > 1 else None
    output = []
    for hull, offset in placed_hulls(hulls):
        opaque = {area.get('index', 0): area for area in hull.get('opaqueAreas', [])}
        for group in hull.get('decalSets', []):
            if group.get('visibilityGroup', 'primary') not in visible:
                continue
            for item in group.get('items', []):
                effect = decal_effect(item, faction, location, shaders, opaque, resources, insert)
                if effect is None:
                    continue
                position = [f32(a + b) for a, b in zip(item.get('position', [0., 0., 0.]), offset)]
                output.append(dict(position=position, rotation=item.get('rotation', [0., 0., 0., 1.]),
                                   scaling=item.get('scaling', [1., 1., 1.]), parentBoneIndex=item.get('boneIndex', -1),
                                   staticIndexBuffers=lod_index_buffers(item, combined_geometry), decalEffect=effect,
                                   sourceProjection=True))
    return output
