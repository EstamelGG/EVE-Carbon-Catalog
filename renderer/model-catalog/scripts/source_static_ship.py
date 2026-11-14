"""Build stationary SOF6 ship inputs when the source proves the scene has no children."""
from io import BytesIO
from pathlib import Path
import sys

from hangar_capture_bounds import validate
from sof_parameters import SofProjection
from sof_resources import ROOT
from sof_texture_schema import SCHEMAS, fields
from source_smart_lights import standalone_effect_children


# The normal host worker runs outside Blender and uses the same pinned GR2 reader.
GRANNY_PACKAGE = Path(__file__).resolve().parents[2] / 'tools/model_export/.deps/tools-blender/packages/carbon-granny/src'
if str(GRANNY_PACKAGE) not in sys.path:
    sys.path.insert(0, str(GRANNY_PACKAGE))

# The audio controller changes audio and controller variables. The damage controller
# adds its child only below the healthy armor/hull defaults. The audited graphics
# table has no ArmorDamage or HullDamage overrides in any of its 6,200 entries.
AUDIO = 'a0cf4103274c23f0baebd63ea5f5e763008f29d79f19352d358568846fb1dce4'
DAMAGE = '8534c06ff18b970a8043d77ddb80498a702c1072d50c28741241e92cb2cfe475'
GRAPHICS = '40fd7c3b63fac29566629173582653c1f4c75a8335155d3a31c769394b5edfcd'
SCENE_SCHEMA = dict(SCHEMAS, EveSOFDataHull=dict(SCHEMAS['EveSOFDataHull'],
    controllers='records', instancedMeshes='count', animations='count', lightSets='count', hazeSets='count'),
    EveSOFDataHullController=fields(string='path visibilityGroup', I='buildFilter'))


def source_hash(resources, path):
    key = resources.key(path)
    if key not in resources.used:
        if not resources.has(key):
            return None
        resources.read(key)
    return resources.used[key]['sha256']


def standalone_ship(item, definitions):
    hulls = definitions[0]
    if item.get('categoryID') != 6 or item.get('gateEffects') or item.get('groupID') == 10 or len(hulls) != 1:
        return None
    # Paint commands change the surface. Layouts and class/variant commands can replace the root.
    if any(token.partition('?')[0] not in ('material', 'pattern', 'respathinsert')
           for token in item['dna'].lower().split(':')[3:]):
        return None
    hull = hulls[0]
    return None if hull.get('buildClass') else hull


def fixed_ship_sphere(item, definitions):
    hull = standalone_ship(item, definitions)
    if not hull or hull.get('enableDynamicBoundingSphere'):
        return None
    sphere = hull.get('boundingSphere')
    return sphere if sphere and sphere[3] > 0 else None


def static_ship_inputs(item, resources, definitions, geometry):
    hull = standalone_ship(item, definitions)
    if not hull:
        return None
    # EveSOF::SetupEffects selects childSets exclusively for SOF6, even if the
    # same hull retains populated legacy children. Visible standalone items must be evaluated.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L557-L569
    if (not hull.get('sof6')
            or next(standalone_effect_children(definitions), None) is not None
            or hull.get('isSkinned') or hull.get('enableDynamicBoundingSphere')
            or hull.get('modelRotationCurvePath') or hull.get('modelTranslationCurvePath')):
        return None
    sphere = hull.get('boundingSphere')
    if not sphere or sphere[3] <= 0:
        return None
    # A mismatched filename can refer to another named hull. Keep named SOF
    # resolution authoritative and use the scene schema only on the same hull.
    path = ROOT + 'hulls/' + hull['name'].lower() + '.black'
    if not resources.has(path):
        return None
    content = resources.read(path)
    try:
        scene = SofProjection(content, SCENE_SCHEMA).root('EveSOFDataHull', SCENE_SCHEMA['EveSOFDataHull'])
    except ValueError:
        # New controller fields/classes can still be processed by the scene worker.
        return None
    if scene.get('name') != hull['name'] or any(scene.get(k) for k in ('instancedMeshes', 'animations', 'lightSets', 'hazeSets')):
        return None
    for controller in scene.get('controllers', []):
        digest = source_hash(resources, controller['path'])
        if digest not in (AUDIO, DAMAGE):
            return None
        if digest == DAMAGE and source_hash(resources, 'res:/staticdata/graphicIDs.fsdbinary') != GRAPHICS:
            return None

    # TriGeometryRes::SetupModels/GetBoundingBox uses MeshBoundsInfo.bounds of
    # the main LOD. The SOF sphere is independent of the vertex or joint AABB.
    try:
        from carbon_granny import read_raw
    except ModuleNotFoundError:
        return None
    content = resources.read(geometry)
    try:
        raw = read_raw(BytesIO(content)).file_info
    except ValueError:
        return None
    meshes = raw.get('Meshes')
    if not meshes or raw.get('Animations') or meshes[0].get('MorphTargets'):
        return None
    info = meshes[0].get('ExtendedData') or {}
    if info.get('typeName') != 'MeshBoundsInfo' or info.get('maxScreenSize', 0) > 0 or not info.get('bounds'):
        return None
    box = info['bounds']
    bounds = validate(dict(sourceRadius=sphere[3], sourceCenter=sphere[:3], sourceBounds=[box['min'], box['max']]))
    identity = dict(typeID=item['id'], dna=item['dna'])
    return dict(hull=dict(identity, children=0, warnings=[], **bounds),
                effects=dict(identity, isAnimated=False, supportsDissolve=False, authoredSpotlights=[], smartLightSets=[]),
                supplement=dict(dna=item['dna'], children=[], assemblyEffects=[],
                                sceneAnimation=dict(version=1, generic=True, completeStates=True, targets=[], sets=[])))
