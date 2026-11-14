"""Read SmartLight definitions inside shared rigs and mixed ship effect files.

CCP Trinity (MIT), SmartLight group, distribution and attribute declarations:
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/SmartLightSets
"""
from sof_texture_schema import fields
from source_equipment import EFFECT_SCHEMAS, EquipmentProjection
from source_light_rig import LIGHT_RIG_SCHEMAS

GROUP = fields(string='name', records='attributeModifiers', i='factionColor',
               **{'?': 'useFactionColor display', '4f': 'customColor staticOffsetRotation',
                  '3f': 'staticOffsetTranslation'})
LAMP = dict(GROUP, **fields(f='brightness radius innerRadius innerAngle outerAngle',
                           wstring='lightProfilePath'))
MODIFIER = fields(string='name', records='attributeModifiers', f='attributeMultiplier crossFadeDuration crossFadeIntensity delayedActivation',
                  **{'?': 'active startsActive restartPlayTimeWhenInactive'})
CAMERA_DEFAULTS = dict(minimumActivation=0, maximumActivation=1, minimumDistance=1000, maximumDistance=10000,
                       placementIntensity=1, lookAtVisionCone=30, lookAtIntensity=1)
SCHEMAS = dict(EFFECT_SCHEMAS,
    EveChildContainer=dict(LIGHT_RIG_SCHEMAS['EveChildContainer'], objects='scene_children',
        displayFilter='I', mute='?', **dict.fromkeys(('curveSets', 'transformModifiers', 'lights',
        'fxAttributes', 'controllers', 'attachments', 'observers'), 'objects')),
    EveChildPlug=fields(string='name', scene_children='objects', objects='externalParameters controllers', **{'?': 'display'}),
    EveChildSmartLightSet=fields(string='name', record='distribution', group_bounds='lightGroups', **{'?': 'display'}),
    EveBaseDistributionMethod=fields(generators='placementGenerators', objects='spawnTriggers spawnModifiers lifetimeModifiers',
        f='timeOutOnTriggering playtimeMultiplier', **{'?': 'locationsCanReTrigger'}),
    EveDistributionPlacementGeneratorParentLocators=fields(string='locatorSetName'),
    EveSmartLightColorShareGroup=dict(GROUP, lightGroups='records'),
    EveSmartLightQuad=dict(GROUP, staticQuadScale='3f', brightness='f', softQuad='?', effect='record'),
    EveSmartLightMesh=dict(GROUP, mesh='record', staticOffsetScale='3f', rotationConstraint='I', shaderParamColorName='string'),
    EveSmartLightPointLight=LAMP, EveSmartLightSpotLight=LAMP,
    Tr2InstancedMesh=fields(string='geometryResPath', i='meshIndex', records='additiveAreas', I='boundsMethod', f='maxInstanceSize', object='instanceGeometryResource'))
SCHEMAS.update(
    Tr2MeshArea=fields(string='name', record='effect', I='index count', **{'?': 'reversed'}),
    EveSmartLightAttributeModifierColor=dict(MODIFIER, **fields(i='factionColor', f='blendValue brightnessMultiplier saturationMultiplier',
                                                 **{'?': 'useFactionColor', '4f': 'blendColor'})),
    # EveSmartLightAttributeModifierCameraDependency_Blue.cpp persists overwritePosition (no "Object").
    EveSmartLightAttributeModifierCameraDependency=dict(MODIFIER, **fields(f=' '.join(CAMERA_DEFAULTS),
        **{'?': 'useCameraDistance inverseDistanceFormula useCameraLookAt inverselookAtFormula useCameraPlacement inversePlacementFormula overwriteObjectDirection overwritePosition',
           '3f': 'angleOverwrite positionOverwrite'})),
    EveSmartLightAttributeModifierControllerVariableListener=dict(MODIFIER, variableName='string', value='f', defaultValue='f', invertReceivedValue='?'),
    EveSmartLightAttributeModifierExpressionBucket=dict(MODIFIER, expression='string'),
    EveSmartLightAttributeModifierNoise=dict(MODIFIER, noiseAmplitude='f', noiseFrequency='f', noiseOctaves='I'),
)


class SmartLightProjection(EquipmentProjection):
    # EveChildContainer.objects and EveChildPlug.objects are ordered child lists.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Children/EveChildContainer_Blue.cpp
    def object_type(self, bounds):
        cursor = self.offset
        try:
            self.offset = bounds[0]
            return self.string()
        finally:
            self.offset = cursor

    def field(self, kind):
        if kind not in ('scene_children', 'generators', 'group_bounds'):
            return super().field(kind)
        count = self.value('I')
        if kind == 'group_bounds':
            return [self.object_bounds() for _ in range(count)]
        selected = (('EveChildContainer', 'EveChildPlug', 'EveChildSmartLightSet')
                    if kind == 'scene_children' else ('EveDistributionPlacementGeneratorParentLocators',))
        records = []
        for _ in range(count):
            bounds = self.object_bounds()
            if bounds is None:
                continue
            cls = self.object_type(bounds)
            if cls in selected:
                required = {'objects'} if cls in ('EveChildContainer', 'EveChildPlug') else None
                records.append(self.record_at(bounds, required_fields=required))
        return records


def _light_sets(reader, node):
    if reader.types[id(node)] == 'EveChildSmartLightSet':
        generators = (node.get('distribution') or {}).get('placementGenerators', [])
        bounds = [group for group in node.get('lightGroups', []) if group]
        # Parent-locator distributions look up the authored name verbatim.
        # Direct point-light groups also occur on fill-light locators.
        # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Utils/EveDistributionMethods/DistributionPlacementGenerators/EveDistributionPlacementGeneratorParentLocators.cpp#L27-L67
        spotlight = any('spotlight' in g.get('locatorSetName', '').lower() for g in generators)
        fill = generators and bounds and all(reader.object_type(group) == 'EveSmartLightPointLight' for group in bounds)
        if node.get('display', True) and (spotlight or fill):
            yield dict(node, lightGroups=[reader.record_at(group) for group in bounds])
    else:
        for child in node.get('objects', []):
            yield from _light_sets(reader, child)


def read_smart_rig(resources, path):
    reader = SmartLightProjection(resources.read(path), SCHEMAS)
    # BLACK interns class names. Absence rules out a rig; presence alone never selects one.
    if ('EveChildSmartLightSet' not in reader.strings or
            'EveDistributionPlacementGeneratorParentLocators' not in reader.strings):
        return None
    cls = reader.root_type()
    if cls not in ('EveChildContainer', 'EveChildSmartLightSet', 'EveChildPlug'):
        return None
    required = {'name', 'objects'} if cls in ('EveChildContainer', 'EveChildPlug') else None
    root = reader.record_at(reader.object_bounds(), cls, required)
    sets = list(_light_sets(reader, root))
    return (root.get('name', ''), sets, reader.types) if sets else None
