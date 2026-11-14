"""Build plane attachment inputs from hull, faction and subsystem definitions.

Trinity (MIT), EveSOF::SetupPlaneSets and GetPlaneSetEffectPath:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L1186-L1341
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L75-L90
"""
import math

from sof_locators import placed_hulls
from sof_parameters import faction_color
from sof_sprites import f32, light_color

VIDEO = {2: 'dynamic:/inspacevideos', 3: 'dynamic:/hangarvideos'}


def plane_item(entry, offset, faction, modern, group_colors):
    if modern:
        color = light_color(faction_color(faction, entry.get('colorType', 0)),
                            entry.get('intensity', 1.), entry.get('saturation', 1.))
    else:
        color = group_colors.get(entry.get('groupIndex', -1), entry.get('color', [1.] * 4))
    rotation = entry.get('rotation', [0., 0., 0., 1.])
    length = math.hypot(*rotation)
    return dict(position=[f32(a + b) for a, b in zip(entry.get('position', [0.] * 3), offset)],
                rotation=[f32(x / length) for x in rotation] if length else [0., 0., 0., 1.],
                scaling=entry.get('scaling', [1.] * 3), color=color,
                boneIndex=entry.get('boneIndex', -1), maskAtlasID=entry.get('maskMapAtlasIndex', 0),
                blinkData=[entry.get('blinkRate', 1.), entry.get('blinkPhase', 0.), 1., entry.get('blinkMode', 0)],
                **{key: entry.get(key, [0.] * 4) for key in
                   ('layer1Transform', 'layer1Scroll', 'layer2Transform', 'layer2Scroll')})


def plane_sets(hulls, faction, visible, modern):
    colors = {s['groupIndex']: s.get('color', [0.] * 4) for s in faction.get('planeSets', [])
              if s.get('groupIndex', -1) != -1}
    groups = []
    for hull, offset in placed_hulls(hulls):
        for group in hull.get('planeSets', []):
            if modern and group.get('visibilityGroup', 'primary') not in visible:
                continue
            usage = group.get('usage', 0)
            skinned = bool(group.get('skinned'))
            shader = 'planehologram.fx' if usage in VIDEO else 'planeglow.fx'
            if skinned:
                shader = 'skinned_' + shader
            if usage not in (0, 2, 3, 5):
                shader = ''
            maps = {role: group.get(role[0].lower() + role[1:] + 'ResPath', '')
                    for role in ('Layer1Map', 'Layer2Map', 'MaskMap')}
            if usage in VIDEO:
                maps['ImageMap'] = VIDEO[usage]
            groups.append(dict(skinned=skinned, shader=shader, textures=maps,
                               planeData=[float(usage == 5), group.get('atlasSize', 1),
                                          *map(math.floor, group.get('atlasAspectRatio', [1., 1.]))],
                               planes=[plane_item(item, offset, faction, modern, colors) for item in group.get('items', [])]))
    return groups
