# Segment 15: new builds supply per-area masks selected using the authored SOF
# generic shader defaults. Existing capture documents retain the legacy adapter.
# Reference: https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveCustomMask.cpp
"""Native quad projections; never flatten these onto overlapping hull UVs."""
import math
import re

PROFILE = 'projected-pattern-v1'


def projected_patterns(source, area):
    authored = 'sofPatterns' in area
    masks = area['sofPatterns'] if authored else source.get('customMasks', [])
    if not masks or area.get('effectOnly'):
        return []
    # Older records lack per-area applicability. These preview families have
    # no projected material stage in this renderer and no generic mask slots.
    if re.search(r'(?:^|/)(?:skinned_)?quad(?:glass|sails|environment)v5\.fx$', area['effect'], re.I):
        return []
    if len(masks) > 2:
        raise ValueError('Quad supports at most two projected masks')
    if not re.search(r'/(?:skinned_)?quad(?:heat)?(?:detail)?v5\.fx$', area['effect'], re.I):
        raise ValueError('Projected masks require a supported quad shader: ' + area['effect'])
    samplers = {s['name']: s for s in area.get('samplers', [])}
    result = []
    for index, mask in enumerate(masks):
        role = mask['role'] if authored else 'PatternMask%dMap' % (index + 1)
        if role not in ('PatternMask1Map', 'PatternMask2Map'):
            raise ValueError('Unsupported projection texture role: ' + role)
        if not area['textures'].get(role):
            raise ValueError('Missing projected texture: ' + role)
        record = {'role': role}
        for key, length in [('position', 3), ('rotation', 4), ('scaling', 3), ('targetMaterials', 4)]:
            values = mask.get(key, [])
            if len(values) != length or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
                raise ValueError('Invalid projection ' + key)
            record[key] = list(values)
        if min(abs(v) for v in record['scaling']) < 1e-8 or sum(v*v for v in record['rotation']) < 1e-8:
            raise ValueError('Singular projection transform')
        material = mask.get('materialIndex')
        if type(material) is not int or not 0 <= material <= 5:
            raise ValueError('Invalid projection material index')
        prefix = 'Mtl%d' % (material + 1) if material < 4 else 'PMtl%d' % (material - 3)
        for suffix in ('DiffuseColor', 'FresnelColor', 'Gloss'):
            if prefix + suffix not in area['parameters']:
                raise ValueError('Missing projection palette: ' + prefix + suffix)
        sampler = mask if authored else samplers.get(role + 'Sampler')
        if sampler is None:
            raise ValueError('Projection sampler metadata missing; recapture source')
        if any(sampler[k] not in (1, 2, 3, 4) for k in ('addressU', 'addressV')):
            raise ValueError('Unsupported projection sampler')
        record.update(materialIndex=material, isMirrored=bool(mask.get('isMirrored')),
                      clampU=bool(mask.get('clampU')), clampV=bool(mask.get('clampV')),
                      addressU=sampler['addressU'], addressV=sampler['addressV'])
        result.append(record)
    return result
