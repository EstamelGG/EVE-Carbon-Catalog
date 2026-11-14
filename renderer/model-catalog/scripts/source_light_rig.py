"""Read the authored preview light graph using official Trinity declarations.

Reference: carbonengine/trinity f644516ae4f921f6f3a3e58dc5d19107781571ec,
trinity/Eve/SpaceObject/Children/EveChildContainer{.h,_Blue.cpp},
trinity/Lights/Tr2PointLight{.h,_Blue.cpp}, trinity/Curves/{class}{.h,_Blue.cpp},
trinity/TriValueBinding{.h,_Blue.cpp}, and
trinity/Eve/SpaceObject/Utils/fxAttributes/EveSpaceObjectFxAttributes{.h,_Blue.cpp}.
Copyright © 2017, 2023 CCP ehf.; MIT: ../../docs/licenses/carbon-trinity-MIT.txt.
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Curves
"""
from black_projection import BlackProjection


LIGHT_RIG_SCHEMAS = {
    'EveChildContainer': {
        'name': 'string', 'objects': 'records', 'curveSets': 'records', 'lights': 'records',
        'fxAttributes': 'records', 'inheritProperties': 'object',
        'rotation': '4f', 'translation': '3f', 'scaling': '3f', 'localTransform': '16f',
        **dict.fromkeys(('alwaysOn', 'display', 'updateOnDisplay', 'useSRT', 'staticTransform',
                         'useStaticScale', 'useStaticRotation'), '?'),
    },
    'EveSpaceObjectFxAttributes': {'name': 'string'},
    'Tr2PointLight': {
        'name': 'string', 'position': '3f', 'rotation': '4f', 'color': '4f',
        **dict.fromkeys(('radius', 'innerRadius', 'brightness', 'noiseFrequency', 'noiseAmplitude'), 'f'),
        'lightProfilePath': 'string', 'boneIndex': 'i', 'flags': 'I',
        'noiseOctaves': 'i', 'isVolumetric': '?', 'scaleBrightness': '?',
    },
    'TriCurveSet': {'name': 'string', 'curves': 'records', 'bindings': 'records',
                    'scale': 'f', 'playOnLoad': '?', 'driver': 'object'},
    'TriValueBinding': {'name': 'string', 'sourceObject': 'record', 'destinationObject': 'record',
                        'sourceAttribute': 'string', 'destinationAttribute': 'string',
                        'scale': 'f', 'offset': '4f'},
    'Tr2CurveScalarExpression': {'name': 'string', 'expression': 'string', 'inputs': 'records',
                                 **dict.fromkeys(('input1', 'input2', 'input3', 'input4'), 'f')},
    'Tr2CurveColorMixer': {'name': 'string', 'color1': '4f', 'color2': '4f',
                          **dict.fromkeys(('lerpValue', 'saturation', 'brightness', 'alphaOverride'), 'f')},
    'Tr2CurveEulerRotation': {'name': 'string', 'yaw': 'inline', 'pitch': 'inline', 'roll': 'inline'},
    'Tr2CurveScalar': {'name': 'string', 'keys': ('structures', '4fHBB'),
                       'extrapolationBefore': 'i', 'extrapolationAfter': 'i',
                       'timeOffset': 'f', 'timeScale': 'f'},
}


def read_light_rig(resources, path):
    reader = BlackProjection(resources.read(path), LIGHT_RIG_SCHEMAS)
    graph = reader.root('EveChildContainer', LIGHT_RIG_SCHEMAS['EveChildContainer'])
    return graph, reader.types
