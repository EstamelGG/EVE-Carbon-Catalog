"""Resolve the equipment preview carrier and its scene from authored BLACK resources.

MIT source, pinned in docs/licenses/carbon-trinity-MIT.txt:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/EveMobile.cpp#L473-L597
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/EveStarfield.cpp#L40-L52
"""
from source_equipment import EFFECT_SCHEMAS, EquipmentProjection, apply_equipment_surface, effect_inputs
from source_preview_scene import SCENE_SCHEMA
from sof_texture_schema import fields


CARRIER = 'res:/dx9/model/ship/IconPreview/PreviewTurretShip.red'
SCENE = 'res:/dx9/scene/fitting/previewTurrets.red'
IDENTITY = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
ROTATION = (0, 0, 0, 1)
SCHEMAS = dict(EFFECT_SCHEMAS,
    EveLocator2=fields(string='name', **{'16f': 'transform'}),
    EveTransform=fields(record='mesh', **{'3f': 'translation scaling', '4f': 'rotation'}),
    Tr2Mesh=fields(string='geometryResPath', i='meshIndex', records='transparentAreas additiveAreas'),
    Tr2MeshArea=fields(string='name', i='index count', record='effect'),
    EveStarfield=fields(i='numStars seed', B='display', record='effect',
                        f='minDist maxDist minFlashRate maxFlashRate minFlashIntensity'))


def read_preview_rig(resources):
    carrier = EquipmentProjection(resources.read(CARRIER), SCHEMAS).root(
        'EveShip2', fields(string='name', f='boundingSphereRadius', records='children locators'))
    scene = EquipmentProjection(resources.read(SCENE), SCHEMAS).root(
        'EveSpaceScene', dict(SCENE_SCHEMA, backgroundEffect='record', starfield='record'))
    stars = scene.get('starfield') or {}
    starfield = dict(display=bool(stars.get('display', True)), numStars=stars.get('numStars', 500),
                     seed=stars.get('seed', 0), minDist=stars.get('minDist', 100),
                     maxDist=stars.get('maxDist', 300), minFlashRate=stars.get('minFlashRate', .5),
                     maxFlashRate=stars.get('maxFlashRate', 1), minFlashIntensity=stars.get('minFlashIntensity', 0),
                     effect=effect_inputs(stars['effect']) if stars.get('effect') else None)
    environment = dict(background=effect_inputs(scene['backgroundEffect']), reflection=scene['envMapResPath'],
        diffuse=scene['envMap2ResPath'], rotation=list(scene.get('envMapRotation', ROTATION)),
        intensity=scene.get('reflectionIntensity', 1), backlight=scene.get('reflectionBackLightingColor', [2]*4)[:3],
        contrast=scene.get('reflectionBackLightingContrast', 8), sunColor=scene.get('sunDiffuseColor', [1]*4)[:3],
        starfield=starfield)
    floor = []
    for child in carrier['children']:
        mesh = child['mesh']
        for blend in ('transparentAreas', 'additiveAreas'):
            for area in mesh.get(blend, []):
                floor.append(dict(name=area['name'], blend=blend, index=area.get('index', 0), count=area.get('count', 1),
                    geometry=mesh['geometryResPath'], meshIndex=mesh.get('meshIndex', 0),
                    translation=list(child.get('translation', (0, 0, 0))), rotation=list(child.get('rotation', ROTATION)),
                    scaling=list(child.get('scaling', (1, 1, 1))), material=effect_inputs(area['effect'])))
    mounts = {}
    for locator in carrier['locators']:
        matrix = locator.get('transform', IDENTITY)
        mounts[locator['name']] = dict(name=locator['name'], transform=[list(matrix[i:i+4]) for i in range(0, 16, 4)])
    return mounts, floor, environment


def preview_mounts(locators, requested):
    # A standalone preview equips slot 1 on the authored two-sided carrier.
    prefix = requested.rstrip('0123456789')
    if prefix + '1a' not in locators:
        prefix = 'locator_turret_'
    return [locators[prefix + suffix] for suffix in ('1a', '1b')]


def build_equipment_inputs(item, resources):
    graphic = item['graphic']
    turret = resources.equipment(graphic['graphicFile'])
    if not turret.get('turretEffect'):
        return dict(unsupported='Equipment resource has no drawable turret material', typeID=item['id'],
                    sourceGraphic=graphic['graphicFile'], sourceGeometry=turret.get('geometryResPath', ''))
    locators, floor, scene = resources.equipment_preview
    locator = turret.get('locatorName') or 'locator_turret_'
    sphere = list(turret.get('boundingSphere', (0, 0, 0, 0)))
    preview = dict(version=1, locatorName=locator, mounts=preview_mounts(locators, locator),
                   boundingSphere=sphere, floor=floor, scene=scene)
    hull = dict(dna='', typeID=item['id'], customMasks=[], sourceRadius=sphere[3], children=0, warnings=[], equipment=preview)
    apply_equipment_surface(hull, graphic, resources)
    return dict(hull=hull, effects=dict(dna='', typeID=item['id']), supplement=dict(children=[]))
