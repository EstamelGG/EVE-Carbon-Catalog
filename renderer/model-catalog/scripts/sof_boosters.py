"""Build single- and multi-hull boosters from SOF hull locators and race-specific effect data.

CCP Trinity (MIT, docs/licenses/carbon-trinity-MIT.txt): CreateBoosterEffect,
SetupBoosters, and EveSOFData.cpp constructors for missing BLACK attributes.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L2875-L2919
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L2951-L3068
"""
from sof_resources import SofResources, UnsupportedSofDNA
from sof_locators import placed_hulls, translated_matrix


LIGHT_FIELDS = ('lightColor', 'lightRadius', 'lightOffset', 'lightFlickerAmplitude', 'lightFlickerFrequency')


def placement(item, offset):
    matrix = translated_matrix(item, offset)
    rows = [matrix[i:i + 4] for i in range(0, 16, 4)]
    return dict(type='trinity.EveSOFDataHullBoosterItem', transform=rows,
                functionality=item.get('functionality', [0, 1, 1, 1]), lightScale=item.get('lightScale', 1.),
                hasTrail=bool(item.get('hasTrail', True)), atlasIndex0=item.get('atlasIndex0', 0),
                atlasIndex1=item.get('atlasIndex1', 0))


def booster_inputs(resources, dna):
    empty = dict(placements=[], parameters={}, textures={}, lights={}, alwaysOn=False, alwaysOnIntensity=0)
    if not dna:
        return empty  # Equipment has no SOF hull or engine set.
    parts = dna.lower().split(':')
    if len(parts) < 3:
        raise UnsupportedSofDNA('Missing hull, faction or race in ' + dna)
    commands = {}
    for token in parts[3:]:
        name, _, value = token.partition('?')
        commands[name] = value
    if 'variant' in commands:
        # EveSOFDNA::SetupCustomData builds replacement hull records without boosters.
        return empty
    hulls = [resources.named('hulls', name, 'Hull') for name in parts[0].split(';')]
    classes = ('ship', 'mobile', 'stationary', 'swarm', 'extension')
    override = commands.get('class')
    build_class = classes.index(override) if override in classes else hulls[0].get('buildClass', 0)
    if build_class not in (0, 3):
        return empty
    placements = []
    for hull, offset in placed_hulls(hulls):
        booster = hull.get('booster') or {}
        placements.extend(placement(item, offset) for item in booster.get('items', []))
    if not placements:
        return empty
    race = resources.named('races', parts[2], 'Race').get('booster')
    if not race:
        raise UnsupportedSofDNA('Missing race booster definition: ' + parts[2])

    zero = [0.] * 4
    params = dict(BoosterScale=race.get('scale', [1.] * 4),
                  ShapeAtlasSize=[race.get('shapeAtlasHeight', 0), race.get('shapeAtlasCount', 0), 0., 0.])
    for key, prefix in (('shape', ''), ('warpShape', 'Warp')):
        for number in ('0', '1'):
            shape = race.get(key + number) or {}
            params[prefix+'NoiseSpeed'+number] = [shape.get('noiseSpeed', 0.)] * 4
            params[prefix+'NoiseAmplitudeStart'+number] = shape.get('noiseAmplitureStart', zero)
            params[prefix+'NoiseAmplitudeEnd'+number] = shape.get('noiseAmplitureEnd', zero)
            params[prefix+'Color'+number] = shape.get('color', zero)
            if number == '0':
                params[prefix+'NoiseFrequency0'] = shape.get('noiseFrequency', zero)
    textures = dict(ShapeMap=race.get('shapeAtlasResPath', ''), GradientMap0=race.get('gradient0ResPath', ''),
                    GradientMap1=race.get('gradient1ResPath', ''), NoiseMap='res:/texture/global/noise32cube_volume.dds')
    lights = {k: race.get(k, zero if k == 'lightColor' else 0.) for k in LIGHT_FIELDS}
    return dict(placements=placements, parameters=params, textures=textures,
                lights=lights, alwaysOn=bool(booster.get('alwaysOn')), alwaysOnIntensity=1.)


def pack_booster(record, assets, resources):
    if resources is None and record['dna']:
        resources = SofResources(assets.cache, assets.index)
    data = booster_inputs(resources, record['dna'])
    data['textures'] = {name: assets.texture(path) for name, path in data['textures'].items()}
    return data
