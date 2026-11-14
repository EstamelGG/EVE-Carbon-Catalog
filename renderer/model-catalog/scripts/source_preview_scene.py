"""Reflection and lighting inputs from authored EveSpaceScene resources.

Schema/defaults: carbonengine/trinity f644516ae4f921f6f3a3e58dc5d19107781571ec,
trinity/Eve/EveSpaceScene{.h,.cpp,_Blue.cpp}. Copyright © 2023 CCP ehf.
MIT terms: ../../docs/licenses/carbon-trinity-MIT.txt.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/EveSpaceScene.cpp
"""
from black_projection import BlackProjection


# Wire widths follow the C++ member types and Blue exposure declarations.
SCENE_SCHEMA = {
    **dict.fromkeys(('name', 'envMapResPath', 'envMap1ResPath', 'envMap2ResPath',
                     'envMap3ResPath', 'lowQualityNebulaResPath', 'lowQualityNebulaMixResPath'), 'string'),
    **dict.fromkeys(('backgroundEffect', 'starfield', 'shLightingManager', 'cascadedShadowMap', 'postprocess'), 'object'),
    **dict.fromkeys(('backgroundObjects', 'objects', 'planets', 'lensflares', 'curveSets'), 'objects'),
    **dict.fromkeys(('display', 'update', 'backgroundRenderingEnabled', 'useSunDiffuseColorWithDynamicLights'), '?'),
    **dict.fromkeys(('envMapRotation', 'sunDiffuseColor', 'ambientColor', 'fogColor',
                     'reflectionBackLightingColor', 'sunDiffuseColorWithDynamicLights'), '4f'),
    'sunDirection': '3f',
    **dict.fromkeys(('reflectionIntensity', 'reflectionBackLightingContrast', 'nebulaIntensity',
                     'backgroundReflectionIntensity', 'defaultDiffuseRoughness', 'fogStart',
                     'fogEnd', 'fogMax', 'planetScale', 'planetCameraScale'), 'f'),
}

# Explicit application exposure choices retained for the accepted demo. These
# scalars are not claimed as recovered engine settings or official defaults.
PREVIEW_DIFFUSE_INTENSITY = 3.14
PREVIEW_SUN_COLOR = [1.25, 1.25, 1.25]


def reflection_inputs(scene):
    return dict(reflection=scene['envMapResPath'], diffuse=scene['envMap2ResPath'],
                rotation=scene.get('envMapRotation', [0.0, 0.0, 0.0, 1.0]),
                intensity=scene.get('reflectionIntensity', 1.0),
                backlight=scene.get('reflectionBackLightingColor', [2.0, 2.0, 2.0, 2.0])[:3],
                contrast=scene.get('reflectionBackLightingContrast', 8.0))


def read_hangar_environment(resources, path):
    from math import pi
    # Trinity Tr2PostProcess2_Blue.cpp and Tr2PostProcess2.h, f6f5ff8.
    postprocess = dict.fromkeys(('signalLoss', 'godRays', 'bloom', 'dynamicExposure',
                                 'filmGrain', 'desaturate', 'fade', 'lut', 'vignette',
                                 'fog', 'depthOfField', 'taa', 'tonemapping',
                                 'colorCorrection', 'genericEffect'), 'object')
    postprocess.update(luts='objects', sharpeningStrength='f')
    reader = BlackProjection(resources.read(path), {'Tr2PostProcess2': postprocess})
    scene = reader.root('EveSpaceScene', dict(SCENE_SCHEMA, postprocess='record'))
    return dict(reflection_inputs(scene),
                sharpeningStrength=(scene.get('postprocess') or {}).get('sharpeningStrength', 0.5),
                sunDirection=scene.get('sunDirection', [0.0, -1.0, 0.0]),
                sunColor=scene.get('sunDiffuseColor', [1.0, 1.0, 1.0])[:3],
                useSunDiffuseColorWithDynamicLights=scene.get('useSunDiffuseColorWithDynamicLights', False),
                sunDiffuseColorWithDynamicLights=scene.get('sunDiffuseColorWithDynamicLights', [1.0, 1.0, 1.0])[:3],
                defaultDiffuseRoughness=scene.get('defaultDiffuseRoughness', 1.0),
                rotationY=pi)  # Viewer orientation for the room environment.


def read_preview_scenes(resources, races):
    result = {}
    for race in races:
        # Local catalogue policy: use an authored race-named scene if present,
        # otherwise the authored generic preview; never call eveSpaceObject.
        path = 'res:/dx9/scene/preview/' + race + '.red'
        if not resources.has(path):
            path = 'res:/dx9/scene/preview/generic.red'
        scene = BlackProjection(resources.read(path)).root('EveSpaceScene', SCENE_SCHEMA)
        result[race] = dict(scene=path, **reflection_inputs(scene), shIntensity=PREVIEW_DIFFUSE_INTENSITY)
    return result
