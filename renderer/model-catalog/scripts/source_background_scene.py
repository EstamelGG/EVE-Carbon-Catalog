"""Project authored sky texture bindings without executing a shader or client.

Official declarations: carbonengine/trinity f644516ae4f921f6f3a3e58dc5d19107781571ec,
trinity/Shader/Tr2Effect{.h,_Blue.cpp} and Shader/Parameter/
TriTextureParameter{.h,_Blue.cpp}, Tr2{Float,Vector4}Parameter{.h,_Blue.cpp}.
Copyright © 2023 CCP ehf.; MIT: ../../docs/licenses/carbon-trinity-MIT.txt.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Shader/Tr2Effect_Blue.cpp
"""
from black_projection import BlackProjection
from source_preview_scene import SCENE_SCHEMA


BACKGROUND_SCHEMAS = {
    'Tr2Effect': {
        'name': 'string', 'effectFilePath': 'string', 'resources': 'records',
        'parameters': 'records', 'constParameters': 'structures', 'options': 'structures',
        'samplerOverrides': 'objects',
    },
    'TriTextureParameter': {'name': 'string', 'resourcePath': 'string', 'uavMipLevel': 'I'},
    'Tr2FloatParameter': {'name': 'string', 'value': 'f'},
    'Tr2Vector4Parameter': {'name': 'string', 'value': '4f'},
}


def read_background_scene(resources, path):
    schema = dict(SCENE_SCHEMA, backgroundEffect='record')
    scene = BlackProjection(resources.read(path), BACKGROUND_SCHEMAS).root('EveSpaceScene', schema)
    effect = scene.get('backgroundEffect') or {}
    textures = [dict(name=r.get('name', ''), path=r.get('resourcePath', ''))
                for r in effect.get('resources', []) if r is not None]
    cube = next((r['path'] for r in textures if r['name'] == 'NebulaMap'), None)
    if not cube:
        return None  # This authored scene has no sky cube to publish.
    return dict(id=path, resource=cube, rotation=scene.get('envMapRotation', [0.0, 0.0, 0.0, 1.0]),
                backgroundResources=textures,
                backgroundParameters=[dict(name=p.get('name', ''), value=p['value'])
                                      for p in effect.get('parameters', []) if p is not None])
