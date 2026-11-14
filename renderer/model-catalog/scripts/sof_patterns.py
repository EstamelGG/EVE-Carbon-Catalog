"""Project SOF pattern layers into the coordinate and sampler inputs used by the web material.

CCP Trinity (MIT, docs/licenses/carbon-trinity-MIT.txt), EveSOFDataMgr's pattern
import, EveSOFDNA::GetPatternApplicationData, EveSOFUtils::GeneratePatternLayerData,
EveSOF::SetupCustomMask and the EveSOFDataPatternTransform constructor:
https://github.com/carbonengine/trinity/tree/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory
"""
from dataclasses import dataclass


@dataclass
class PatternLayer:
    texture: dict
    flags: dict
    transform: dict | None

    @property
    def role(self):
        return self.texture.get('textureName')

    def sampler(self):
        # Projection enum (repeat/clamp/border) -> Tr2RenderContextEnum::TA_*.
        address = {1: 3, 2: 4}
        u = address.get(self.flags.get('projectionTypeU'), 1)
        v = address.get(self.flags.get('projectionTypeV'), 1)
        return dict(name=self.role + 'Sampler', addressU=u, addressV=v)

    def mask(self):
        sampler = self.sampler()
        u, v = sampler['addressU'], sampler['addressV']
        return dict(role=self.role, position=self.transform.get('position', [0., 0., 0.]),
                    rotation=self.transform.get('rotation', [0., 0., 0., 1.]),
                    scaling=self.transform.get('scaling', [1., 1., 1.]),
                    isMirrored=bool(self.transform.get('isMirrored')),
                    clampU=u == 3, clampV=v == 3, addressU=u, addressV=v,
                    materialIndex=self.texture.get('materialSource', 0),
                    targetMaterials=[float(self.flags.get('isTargetMtl%d' % n, True)) for n in range(1, 5)])


def pattern_layers(resources, hull, faction, name):
    modern_default = hull.get('sof6') and not name
    if modern_default:
        name = faction.get('defaultPatternName')
    if not name:
        transform = (hull.get('defaultPattern') or {}).get('transformLayer1')
        layer = faction.get('defaultPattern')
        return [PatternLayer(layer, layer, transform)] if not modern_default and transform is not None and layer else []

    pattern = resources.named('patterns', name, 'Pattern')
    layers = []
    if not modern_default and not pattern.get('sof6'):
        for projection in pattern.get('projections', []):
            if projection.get('name') == hull['name']:
                layers = [PatternLayer(pattern[key], pattern[key], projection.get('transformLayer' + key[-1]))
                          for key in ('layer1', 'layer2') if pattern.get(key)]
        return layers

    for group in pattern.get('applicationGroups', []):
        for projection in group.get('projections', []):
            if projection.get('name') == hull['name']:
                layers = []
                for number in ('1', '2'):
                    layer = pattern.get('layer' + number)
                    properties = group.get('layer' + number + 'Properties')
                    transform = projection.get('transformLayer' + number)
                    if layer and properties is not None and transform is not None:
                        layers.append(PatternLayer(layer, properties, transform))
    return layers
