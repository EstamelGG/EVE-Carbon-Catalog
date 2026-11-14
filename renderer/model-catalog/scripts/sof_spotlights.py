"""Build SOF spotlight cone and camera-facing glow inputs from hull/faction data.

CCP Trinity (MIT), EveSOF::SetupSpotlightSets and ModifyColor:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L1025-L1177
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L92-L104
"""

from sof_locators import placed_hulls, translated_matrix
from sof_parameters import faction_color
from sof_sprites import f32


def modern_color(color, saturation, brightness):
    # With hue fixed, scaling HSV saturation scales each channel's distance
    # from the brightest RGB channel. Trinity drops the HDR divisor after
    # this adjustment and preserves the original alpha.
    peak = max(color[:3])
    divisor = max(1., peak)
    if peak == 0.:
        return [0., 0., 0., color[3]]
    rgb = [(peak - saturation * (peak - channel)) * brightness / divisor
           for channel in color[:3]]
    return [*rgb, color[3]]


def spotlight_item(entry, offset, faction, legacy_colors, modern):
    group = entry.get('groupIndex', -1)
    if not modern and (group == -1 or group not in legacy_colors):
        return None
    # Standalone SOF applies the subsystem translation on both sides of its
    # placement step. At the root the placement matrix is identity.
    matrix = translated_matrix(entry, offset)
    matrix[12:15] = [f32(x + d) for x, d in zip(matrix[12:15], offset)]
    item = dict(type='trinity.EveSpotlightSetItem', name='', transform=[matrix[i:i+4] for i in range(0, 16, 4)],
                boneIndex=entry.get('boneIndex', 0), boosterGainInfluence=bool(entry.get('boosterGainInfluence')),
                spriteScale=entry.get('spriteScale', [1.] * 3))
    base = faction_color(faction, entry.get('colorType', 12)) if modern else None
    for role, saturation, brightness in (('cone', .75, .5), ('flare', 1., 1.), ('sprite', .9, .75)):
        key = role + 'Color'
        if modern:
            color = modern_color(base, f32(entry.get('saturation', 1.) * f32(saturation)), brightness)
        else:
            color = legacy_colors[group].get(key, [0.] * 4)
        item[key] = [f32(c * entry.get(role + 'Intensity', 0.)) for c in color]
    return item


def spotlight_sets(hulls, faction, visible, modern):
    legacy = {s.get('groupIndex', -1): s for s in faction.get('spotlightSets', [])}
    sets = []
    for hull, offset in placed_hulls(hulls):
        for source in hull.get('spotlightSets', []):
            if modern and source.get('visibilityGroup', 'primary') not in visible:
                continue
            items = [light for entry in source.get('items', [])
                     if (light := spotlight_item(entry, offset, faction, legacy, modern)) is not None]
            group = dict(items=items, intensity=1., zOffset=source.get('zOffset', 0.),
                         coneMap=source.get('coneTextureResPath', ''), glowMap=source.get('glowTextureResPath', ''))
            if source.get('skinned'):
                group['skinned'] = True
            sets.append(group)
    return sets
