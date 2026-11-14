"""Build the viewer's preview-light contract from data and published curves.

No client interpreter, injection, shader bytecode or captured-value fallback.
Schema/curve references live in source_light_rig.py and source_curve_math.py.
"""
import argparse
from pathlib import Path

from black_projection import BlackProjection
from pipeline_common import write
from source_curve_math import apply_curve_set
from source_light_rig import read_light_rig
from source_preview_scene import SCENE_SCHEMA
from source_resources import SourceResources

SOURCE_VERSION = 'public-preview-lighting-v1'
DEFAULT_GRAPHICS = {
    26811: 'res:/dx9/scene/skinr/skinr_scene_holographic_01a.red',
    27949: 'res:/dx9/scene/showInfo/ShowInfoWindow_LightRig_01a.red',
}


def build_preview(resources, graphics=None, sample_time=4.0):
    paths = DEFAULT_GRAPHICS if graphics is None else {int(k): v for k, v in graphics.items()}
    scene = BlackProjection(resources.read(paths[26811])).root('EveSpaceScene', SCENE_SCHEMA)
    root, types = read_light_rig(resources, paths[27949])
    for curves in root.get('curveSets', []):
        # Viewer policy: one PlayFrom/sample at 4 s. Apply order follows the
        # public TriCurveSet::Apply, including previous-input binding semantics.
        apply_curve_set(curves, types, sample_time)

    transforms, node = [], root
    while True:
        # EveChildTransform constructor: identity rotation / unit scale.
        # The existing viewer contract supports this single, untranslated chain.
        if any(node.get('translation', [0, 0, 0])):
            raise ValueError('Preview lighting contract does not support translated containers')
        transforms.append(dict(rotation=node.get('rotation', [0, 0, 0, 1]),
                               scaling=node.get('scaling', [1, 1, 1])))
        children, lights = node.get('objects', []), node.get('lights', [])
        if lights and not children:
            break
        if lights or len(children) != 1:
            raise ValueError('Preview lighting requires one container chain ending in lights')
        node = children[0]
    if len(transforms) != 3:
        raise ValueError('Preview renderer expects root, scaler and static-light transforms')
    # Only publish fields consumed by native-preview-lights.js / native-sh.js. Defaults below are
    # LightData::LightData in official Trinity Lights/Tr2Light.cpp.
    # Publish authored radii and brightness without pre-applying attenuation.
    # source-light-contract.js scales both lengths; public-point-attenuation.js
    # defines the renderer's normalized-distance brightness convention.
    defaults = dict(position=[0, 0, 0], radius=0, innerRadius=0,
                    brightness=1, color=[0, 0, 0, 1], name='')
    point_lights = []
    for light in lights:
        if types[id(light)] != 'Tr2PointLight':
            raise ValueError('Preview contract requires point lights')
        point_lights.append({key: light.get(key, value) for key, value in defaults.items()})
    return dict(profile='direct-lighting-v1', sourceVersion=SOURCE_VERSION,
                sceneResource=paths[26811], rigResource=paths[27949],
                sunDirection=scene['sunDirection'], sunColor=scene['sunDiffuseColor'][:3],
                # Application appearance policy retained from the accepted demo.
                dirtLevel=-1.5, sampleTime=sample_time,
                lights=point_lights, rigTransforms=transforms,
                provenance=dict(blue='d9d67648e0ffaae397e6399b3e072e05c2380080',
                                trinity='f644516ae4f921f6f3a3e58dc5d19107781571ec',
                                math='e998264e693e0a2a6121627aed43ed584f2baa4d',
                                inputs=list(resources.used.values())))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sample-time', type=float, default=4.0)
    args = parser.parse_args()
    write(args.output, build_preview(SourceResources(args.cache), sample_time=args.sample_time))


if __name__ == '__main__':
    main()
