"""Selected Blue fields used by the SOF surface texture builder.

CCP Trinity, MIT (docs/licenses/carbon-trinity-MIT.txt), declarations and Blue
exposures in EveSOFData.h, EveSOFData_Blue.cpp and EveSOFData_Blue2.cpp:
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory
"""


def fields(**groups):
    return {name: kind for kind, names in groups.items() for name in names.split()}


AREA_LISTS = ('opaqueAreas', 'decalAreas', 'transparentAreas', 'additiveAreas', 'distortionAreas')
AREA_TYPES = ('Primary', 'Glass', 'Sails', 'Reactor', 'Darkhull', 'Wreck', 'Rock',
              'Monument', 'Ornament', 'SimplePrimary', 'Turret')
COLOR_NAMES = ('Primary Secondary Tertiary Black White Yellow Orange Red Blue Green Cyan Fire Hull Glass '
               'Reactor Darkhull Booster Killmark PrimaryLight SecondaryLight TertiaryLight WhiteLight '
               'PrimaryHologram SecondaryHologram TertiaryHologram State0 State1 State2 State3 '
               'StateVulnerable StateInvulnerable PrimaryForcefield SecondaryForcefield PrimaryBanner '
               'PrimaryFx SecondaryFx PrimarySpotlight SecondarySpotlight TertiarySpotlight '
               'PrimaryBillboard PrimaryWarpFx PrimaryAttackFX PrimarySiegeFX PrimaryDockedFX').split()

SCHEMAS = {
    'EveSOFDataHull': fields(
        string='name description category geometryResFilePath modelRotationCurvePath modelTranslationCurvePath',
        I='buildClass impactEffectType', B='isSkinned sof6 castShadow enableDynamicBoundingSphere',
        records=' '.join((*AREA_LISTS, 'locatorSets', 'locatorTurrets', 'spriteSets', 'spriteLineSets', 'spotlightSets', 'planeSets', 'decalSets', 'children', 'childSets')), record='defaultPattern booster',
        objects='hazeSets banners bannerSets lightSets '
                'animations soundEmitters controllers', count='instancedMeshes',
        **{'4f': 'boundingSphere', '3f': 'shapeEllipsoidCenter shapeEllipsoidRadius audioPosition'}),
    'EveSOFDataHullChild': fields(string='name redFilePath', i='id groupIndex lowestLodVisible', I='buildFilter',
        **{'3f': 'translation scaling', '4f': 'rotation'}),
    'EveSOFDataHullChildSet': fields(string='visibilityGroup', records='items'),
    'EveSOFDataHullChildSetItem': fields(string='redFilePath', i='lowestLodVisible', I='buildFilter',
        **{'3f': 'translation scaling', '4f': 'rotation'}),
    'EveSOFDataFactionChild': fields(string='name', i='groupIndex', B='isVisible'),
    'EveSOFDataGenericDecalShader': fields(string='shader', records='defaultTextures',
        strings='parentTextures parameters', B='additive'),
    'EveSOFDataHullDecalSet': fields(string='name visibilityGroup', records='items'),
    'EveSOFDataHullDecalSetItem': fields(string='name', i='meshIndex boneIndex', I='usage glowColorType logoType',
        records='multiHullIndexBuffers indexBuffers textures', parameter_map='parameters',
        **{'3f': 'position scaling', '4f': 'rotation'}),
    'EveSOFDataMultiHullDecalIndexBuffers': fields(string='combinedGeometryResPath', records='indexBuffers'),
    'EveSOFDataDecalIndexBuffer': {'indexBuffer': 'binary'},
    'EveSOFDataLogoSet': fields(record='Primary Secondary Tertiary Marking_01 Marking_02'),
    'EveSOFDataLogo': fields(records='textures'),
    'EveSOFDataHullLocator': fields(string='name', **{'16f': 'transform'}),
    'EveSOFDataHullLocatorSet': fields(string='name', records='locators'),
    'EveSOFDataHullLocatorSetGroup': fields(string='name', records='locatorSets'),
    'EveSOFDataTransform': fields(i='boneIndex', **{'3f': 'position scaling', '4f': 'rotation'}),
    'EveSOFDataHullArea': fields(string='name shader', I='index count areaType blockedMaterials',
                                 records='textures', parameter_map='parameters'),
    'EveSOFDataTexture': fields(string='name resFilePath'),
    'EveSOFDataFaction': fields(
        string='name description resPathInsert defaultPatternLayer1MaterialName defaultPatternLayer2MaterialName '
               'defaultPatternName', i='materialUsageMtl1 materialUsageMtl2 materialUsageMtl3 materialUsageMtl4',
        record='logoSet areaTypes colorSet defaultPattern visibilityGroupSet', records='spotlightSets planeSets children'),
    'EveSOFDataFactionVisibilityGroupSet': fields(strings='visibilityGroups'),
    'EveSOFDataFactionSpotlightSet': fields(string='name', i='groupIndex', **{'4f': 'coneColor spriteColor flareColor'}),
    'EveSOFDataHullSpotlightSet': fields(string='name visibilityGroup glowTextureResPath coneTextureResPath',
                                        B='skinned', f='zOffset', records='items'),
    'EveSOFDataHullSpotlightSetItem': fields(i='boneIndex groupIndex', I='colorType', B='boosterGainInfluence',
        f='coneIntensity flareIntensity spriteIntensity saturation', object='light',
        **{'16f': 'transform', '3f': 'spriteScale'}),
    'EveSOFDataFactionPlaneSet': fields(string='name', i='groupIndex', **{'4f': 'color'}),
    'EveSOFDataHullPlaneSet': fields(string='name visibilityGroup layer1MapResPath layer2MapResPath maskMapResPath',
        i='usage', I='atlasSize', B='skinned', records='items', **{'2f': 'atlasAspectRatio'}),
    'EveSOFDataHullPlaneSetItem': fields(i='groupIndex boneIndex blinkMode maskMapAtlasIndex colorType',
        f='intensity saturation blinkRate blinkPhase', objects='lights',
        **{'3f': 'position scaling', '4f': 'rotation color layer1Transform layer2Transform layer1Scroll layer2Scroll'}),
    'EveSOFDataHullSpriteSet': fields(string='name visibilityGroup', B='skinned', records='items'),
    'EveSOFDataHullSpriteLineSet': fields(string='name visibilityGroup', B='skinned', records='items'),
    'EveSOFDataHullSpriteSetItem': fields(
        f='blinkRate blinkPhase minScale maxScale falloff intensity saturation',
        i='boneIndex', I='colorType', object='light', **{'3f': 'position'}),
    'EveSOFDataHullSpriteLineSetItem': fields(
        f='blinkRate blinkPhase blinkPhaseShift minScale maxScale falloff intensity saturation spacing',
        i='boneIndex', I='colorType', B='isCircle', object='light', **{'3f': 'position scaling', '4f': 'rotation'}),
    'EveSOFDataArea': fields(record=' '.join(AREA_TYPES)),
    'EveSOFDataAreaMaterial': fields(string='material1 material2 material3 material4', I='colorType'),
    'EveSOFDataFactionColorSet': fields(**{'4f': ' '.join(COLOR_NAMES)}),
    'EveSOFDataRace': fields(string='name', I='hullPrimaryHeatColorType hullReactorHeatColorType', record='booster', object='damage'),
    'EveSOFDataHullBooster': fields(string='driveName effectPath', B='alwaysOn hasTrails', records='items',
                                    objects='parameters textures'),
    'EveSOFDataHullBoosterItem': fields(B='hasTrail', I='atlasIndex0 atlasIndex1', f='lightScale',
                                        **{'16f': 'transform', '4f': 'functionality'}),
    'EveSOFDataBooster': fields(record='shape0 shape1 warpShape0 warpShape1',
        string='shapeAtlasResPath gradient0ResPath gradient1ResPath', I='shapeAtlasHeight shapeAtlasCount',
        f='glowScale haloScaleX haloScaleY symHaloScale lightOffset lightRadius lightWarpRadius '
          'lightFlickerAmplitude lightFlickerFrequency',
        **{'4f': 'scale glowColor warpGlowColor haloColor warpHalpColor trailColor trailSize lightColor lightWarpColor'}),
    'EveSOFDataBoosterShape': fields(f='noiseFunction noiseSpeed',
                                     **{'4f': 'noiseAmplitureStart noiseAmplitureEnd noiseFrequency color'}),
    'EveSOFDataMaterial': fields(string='name', parameter_map='parameters'),
    'EveSOFDataGenericString': fields(string='str'),
    'EveSOFDataGeneric': fields(
        string='resPathDefaultAlliance resPathDefaultCorp resPathDefaultCeo areaShaderLocation decalShaderLocation '
               'shaderPrefix shaderPrefixAnimated', records='areaShaders decalShaders', I='turretAreaType',
        objects='variants visibilityGroups hullCategories hullCategoriesData',
        strings='materialPrefixes patternMaterialPrefixes', object='damage hullDamage swarm',
        record='genericWreckMaterial', inline='bannerShader',
        f='decalMinScreenSizeSTANDARD decalMinScreenSizeKILLCOUNTER decalMinScreenSizeHOLE '
          'decalMinScreenSizeCYLINDRICAL decalMinScreenSizeGLOWCYLINDRICAL decalMinScreenSizeGLOWSTANDARD decalMinScreenSizeLOGO'),
    'EveSOFDataGenericShader': fields(string='shader transparencyTextureName', B='doGenerateDepthArea',
                                      strings='parameters', parameter_map='defaultParameters', records='defaultTextures'),
    'EveSOFDataPattern': fields(string='name', B='sof6', record='layer1 layer2', records='projections applicationGroups'),
    'EveSOFDataPatternLayer': fields(string='textureName textureResFilePath',
                                     I='materialSource projectionTypeU projectionTypeV',
                                     B='isTargetMtl1 isTargetMtl2 isTargetMtl3 isTargetMtl4'),
    'EveSOFDataPatternPerHull': fields(string='name', record='transformLayer1 transformLayer2'),
    'EveSOFDataPatternTransform': fields(B='isMirrored', **{'3f': 'position scaling', '4f': 'rotation'}),
    'EveSOFDataPatternApplicationGroup': fields(string='name', record='layer1Properties layer2Properties', records='projections'),
    'EveSOFDataPatternLayerProperties': fields(I='projectionTypeU projectionTypeV',
        B='isTargetMtl1 isTargetMtl2 isTargetMtl3 isTargetMtl4 Primary Glass Sails Reactor Darkhull Rock Monument Ornament SimplePrimary'),
}

for suffix, fmt in {'': '4f', 'Color': '4f', 'Vector3': '3f', 'Vector2': '2f',
                    'Bool': 'B', 'Int': 'i', 'Float': 'f'}.items():
    SCHEMAS['EveSOFDataParameter' + suffix] = {'name': 'string', 'value': fmt}
