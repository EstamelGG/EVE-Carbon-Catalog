"""Pack sprite billboards and the remaining spotlight attachments for the viewer."""
import math


def line_positions(line):
    """Expand the local X axis for rows, or the XZ ellipse for rings.

    Trinity EveSpriteLineSetItem::GetPositions (MIT):
    https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EveSpriteLineSetItem.cpp#L58-L104
    Compute each offset from the origin in Python precision. The browser
    rounds the resulting coordinates when uploading its vertex attributes.
    """
    x, y, z, w = line['rotation']
    axis_x = (1 - 2*(y*y + z*z), 2*(x*y + w*z), 2*(x*z - w*y))
    axis_z = (2*(x*z + w*y), 2*(y*z - w*x), 1 - 2*(x*x + y*y))
    spacing = line['spacing']
    sx, sy, _ = line['scaling']
    circle = line.get('isCircle', False)
    for index in range(int(spacing if circle else sx)):
        if circle:
            angle = math.tau * index / spacing
            dx, dz = sx * math.sin(angle), sy * math.cos(angle)
        else:
            dx, dz = index * spacing, 0.
        yield [origin + dx*u + dz*v for origin, u, v in zip(line['position'], axis_x, axis_z)]


def pack_sprites(record):
    sprites = []
    for source in record.get('attachments', []):
        if source.get('display') is False:
            continue
        skinned = source.get('skinned', False)
        if source['type'] == 'trinity.EveSpriteSet':
            sprites.extend(dict(sprite, boneIndex=sprite.get('boneIndex', -1) if skinned else -1)
                           for sprite in source['sprites'])
        elif source['type'] == 'trinity.EveSpriteLineSet':
            for line in source.get('spriteLines', []):
                fields = {k: line[k] for k in ('color', 'minScale', 'maxScale', 'falloff', 'blinkRate')}
                fields['boneIndex'] = line['boneIndex'] if skinned else -1
                for index, position in enumerate(line_positions(line)):
                    sprites.append(dict(fields, position=position,
                                        blinkPhase=line['blinkPhase'] + index*line['blinkPhaseShift']))
    return sprites


def pack_attachment_spotlights(record, assets):
    """Resolve authored texture paths; older captures and hangars carry effect records."""
    if 'sofSpotlights' in record:
        return [dict(group, coneMap=assets.texture(group['coneMap']), glowMap=assets.texture(group['glowMap']))
                for group in record['sofSpotlights']]
    result = []
    for source in record.get('attachments', []):
        if source['type'] != 'trinity.EveSpotlightSet' or source.get('display') is False:
            continue
        cone, glow = source.get('coneEffect') or {}, source.get('glowEffect') or {}
        if not cone.get('effectFilePath','').lower().endswith('/spotlightconepool.fx') or not glow.get('effectFilePath','').lower().endswith('/spotlightglowpool.fx'):
            continue
        def texture(effect):
            return assets.texture(next(r['resourcePath'] for r in effect['resources'] if r['name']=='TextureMap'))
        group = dict(items=source.get('spotlightItems', []), intensity=source.get('intensity', 1),
                     coneMap=texture(cone), glowMap=texture(glow),
                     zOffset=dict(cone.get('constParameters', [])).get('zOffset', [0])[0])
        if source.get('skinned'):
            group['skinned'] = True
        result.append(group)
    return result
