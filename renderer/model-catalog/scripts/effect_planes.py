"""Bind plane attachment inputs to their published textures and vertex fields."""
from itertools import chain
import struct


def captured_groups(record):
    # Hangars and existing build receipts can still supply serialized scene attachments.
    for source in record.get('attachments', []) + record.get('planeSets', []):
        if source.get('type') != 'trinity.EvePlaneSet' or source.get('display') is False:
            continue
        effect = source.get('effect') or {}
        resource = effect.get('effectFilePath', '')
        yield dict(resource=resource, shader=resource.lower().rsplit('/', 1)[-1],
                   textures={r['name']: r['resourcePath'] for r in effect.get('resources', [])},
                   planeData=dict(effect.get('constParameters', [])).get('PlaneData', [1, 1, 1, 1]),
                   skinned=source.get('skinned', False), planes=source.get('planes', []))


def pack_plane(item):
    plane = {k: item[k] for k in ('position', 'rotation', 'scaling', 'color', 'boneIndex', 'maskAtlasID') if k in item}
    # EvePlaneSet::Rebuild stores the following per-instance fields as Vector4_16.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/Sets/EvePlaneSet.cpp#L298-L311
    for key, default in [('layer1Transform', [1, 1, 0, 0]), ('layer2Transform', [1, 1, 0, 0]),
                         ('layer1Scroll', [0] * 4), ('layer2Scroll', [0] * 4), ('blinkData', [0] * 4)]:
        plane[key] = list(struct.unpack('<4e', struct.pack('<4e', *item.get(key, default))))
    return plane


def pack_planes(record, assets):
    sets, unsupported = [], []
    groups = record['sofPlanes'] if 'sofPlanes' in record else captured_groups(record)
    for group in chain(groups, record.get('layoutVideoPlanes', ())):
        shader = group['shader']
        if shader not in ('planeglow.fx', 'skinned_planeglow.fx', 'planehologram.fx', 'skinned_planehologram.fx'):
            unsupported.append(shader or 'missing-plane-shader')
            continue
        hologram = shader.endswith('planehologram.fx')
        roles = ('Layer1Map', 'Layer2Map', 'MaskMap') + (('ImageMap',) if hologram else ())
        if any(not group['textures'].get(role) for role in roles):
            unsupported.append('missing-plane-texture:' + shader)
            continue
        # EveSOF selects the effect name from usage and skinning. This viewer
        # uses that authored name for both SOF and serialized scene attachments.
        # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L75-L90
        resource = group.get('resource', 'res:/graphics/effect/managed/space/spaceobject/fx/' + shader)
        sets.append(dict(skinned=group['skinned'], hologram=hologram, shader=dict(resource=resource), planeData=group['planeData'],
                         planes=[pack_plane(p) for p in group['planes'] if any(p.get('color', [1.] * 4))],
                         textures={role: assets.texture(group['textures'][role]) for role in roles}))
    return dict(version=1, sets=sets, unsupported=unsupported)
