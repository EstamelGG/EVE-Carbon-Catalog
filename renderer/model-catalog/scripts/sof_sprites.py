"""Reconstruct the root SOF sprite sets from hull and faction definitions.

CCP Trinity (MIT), SetupSpriteSets, SetupSpriteLineSets and faction visibility:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L936-L1016
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L1349-L1434
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDataMgr.cpp#L1314-L1324
"""
from ctypes import c_float

from sof_locators import placed_hulls
from sof_parameters import faction_color


def f32(value):
    return c_float(value).value


def light_color(color, intensity, saturation):
    # Carbon Math Color_inline.h, Saturate. Alpha is preserved during saturation.
    # https://github.com/carbonengine/math/blob/e998264e693e0a2a6121627aed43ed584f2baa4d/include/Color_inline.h
    scaled = [f32(v * intensity) for v in color]
    if saturation == 1:
        return scaled
    r, g, b, alpha = scaled
    luminance = f32(f32(f32(r * f32(.299)) + f32(g * f32(.587))) + f32(b * f32(.114)))
    amount = max(0., saturation)
    return [f32(luminance + f32(f32(v - luminance) * amount)) for v in (r, g, b)] + [alpha]


def sprite_item(entry, offset, faction, modern, line):
    position = entry.get('position', (0., 0., 0.))
    color = faction_color(faction, entry.get('colorType', 0))
    saturation = entry.get('saturation', 1.) if modern else 1.
    item = dict(position=[f32(a + b) for a, b in zip(position, offset)],
                color=light_color(color, entry.get('intensity', 1.), saturation),
                boneIndex=entry.get('boneIndex', 0), minScale=entry.get('minScale', 1.),
                maxScale=entry.get('maxScale', 10.), falloff=entry.get('falloff', 0.),
                blinkRate=entry.get('blinkRate', f32(.1)), blinkPhase=entry.get('blinkPhase', 0.))
    if line:
        # For a root attachment the parent transform is identity. Use the authored
        # rotation directly, avoiding a matrix round trip before expanding the row.
        item.update(isCircle=bool(entry.get('isCircle')), spacing=entry.get('spacing', 1.),
                    rotation=entry.get('rotation', [0., 0., 0., 1.]),
                    scaling=entry.get('scaling', [1.] * 3), blinkPhaseShift=entry.get('blinkPhaseShift', 0.))
    else:
        item.update(name='', type='trinity.EveSpriteSetItem', warpColor=[1.] * 4)
    return item


def sprite_sets(hulls, faction, visible, modern):
    attachments = []
    for group_key, item_key, runtime_type in (('spriteSets', 'sprites', 'EveSpriteSet'),
                                              ('spriteLineSets', 'spriteLines', 'EveSpriteLineSet')):
        for hull, offset in placed_hulls(hulls):
            for group in hull.get(group_key, []):
                if group.get('visibilityGroup', 'primary') not in visible:
                    continue
                items = [sprite_item(entry, offset, faction, modern, item_key == 'spriteLines')
                         for entry in group.get('items', [])]
                attachments.append({'type': 'trinity.' + runtime_type, 'skinned': bool(group.get('skinned')), item_key: items})
    return attachments
