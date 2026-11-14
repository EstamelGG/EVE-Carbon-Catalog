"""Direct color-curve bindings on the gate timeline in a SOF child resource.

CCP Blue assigns BLACK object IDs in definition order (BlackWriter.cpp:226–241).
CCP Trinity, MIT: Tr2CurveColor.cpp:21–37, Tr2CurveScalar.cpp and
TriValueBinding.cpp:91–119. CarbonEngineJS runtime d605cf6 implements the
same four scalar channels in src/trinity/curves/curve/Tr2CurveColor.js.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Curves/Tr2CurveColor.cpp
"""
from collections import defaultdict
from math import ceil

from black_projection import BlackProjection
from source_curve_math import f32, scalar_value
from source_light_rig import LIGHT_RIG_SCHEMAS

TIMELINE = 'Structure_Gate'
COLOR_SCHEMA = dict(name='string', timeOffset='f', srgbOutput='?',
                    **dict.fromkeys('rgba', 'inline'))
BINDING_SCHEMA = dict(LIGHT_RIG_SCHEMAS['TriValueBinding'], sourceObject='endpoint',
                      destinationObject='endpoint', isEnabled='?', isWeak='?')


class GateCurveReader(BlackProjection):
    def __init__(self, content, container_schema):
        super().__init__(content, {
            'EveChildContainer': dict(container_schema, objects='objects', curveSets='records'),
            'TriCurveSet': dict(LIGHT_RIG_SCHEMAS['TriCurveSet'], curves='ref_list',
                                bindings='ref_list', ranges='objects', driver='ref'),
            'TriValueBinding': BINDING_SCHEMA, 'Tr2CurveColor': COLOR_SCHEMA,
            'Tr2CurveScalar': LIGHT_RIG_SCHEMAS['Tr2CurveScalar'],
        })
        self.highest_definition = 0

    def reference(self):
        # An opaque subtree can define objects. A later reference to one has
        # only the four-byte ID even when the projection has no object bounds.
        ref = self.value('I')
        if ref > self.highest_definition:
            self.highest_definition = ref
            size = self.value('I')
            start = self.offset
            self.take(size)
            self.references[ref] = (start, self.offset)
        return ref

    def object_bounds(self):
        return self.references.get(self.reference())

    def field(self, kind):
        if kind == 'ref_list':
            return [self.reference() for _ in range(self.value('I'))]
        if kind == 'ref':
            return self.reference()
        if kind == 'endpoint':
            # Bindings are revisited after the index pass. Read in the ID
            # namespace at this binding, skipping any inline object definition.
            ref = self.value('I')
            if ref > self.binding_definition:
                self.binding_definition = ref
                self.take(self.value('I'))
            return ref
        return super().field(kind)


def direct_curve_bindings(content, container_schema, destinations, timeline_name, *, ambient=False):
    """Yield a single active writer per material parameter on the named timeline."""
    reader = GateCurveReader(content, container_schema)
    if ambient:
        reader.schemas['TriCurveSet']['ranges'] = 'ref_list'
    root = reader.record_at(reader.object_bounds(), required_fields={'curveSets'})
    sets = [s for s in root.get('curveSets', []) if s]
    matches = [s for s in sets if s.get('name') == timeline_name]
    if len(matches) != 1 or matches[0].get('driver'):
        return
    timeline = matches[0]
    if ambient and (len(sets) != 1 or not timeline.get('playOnLoad', True) or timeline.get('ranges')):
        return
    writers = defaultdict(list)
    for ref in timeline.get('bindings', []):
        if ref not in reader.references:
            return
        reader.binding_definition = ref
        binding = reader.record_at(reader.references[ref], 'TriValueBinding')
        if binding.get('isEnabled', True):
            writers[binding.get('destinationObject')].append(binding)
    curves = set(timeline.get('curves', []))
    for dest in destinations:
        bindings = writers.get(dest, [])
        if len(bindings) != 1:
            continue
        b = bindings[0]
        source = b.get('sourceObject')
        if (source in curves and source not in writers and source in reader.references
                and b.get('destinationAttribute') == 'value' and b.get('sourceAttribute') == 'currentValue'):
            yield reader, dest, b, timeline, writers


def gate_color_bindings(content, container_schema, destinations):
    """Map BLACK parameter identity to its single direct, linear-RGBA writer."""
    results = {}
    for reader, dest, b, _, _ in direct_curve_bindings(content, container_schema, destinations, TIMELINE):
        bounds = reader.references[b['sourceObject']]
        reader.offset = bounds[0]
        if reader.string() != 'Tr2CurveColor':
            continue
        curve = reader.record_at(bounds, 'Tr2CurveColor')
        if not curve.get('srgbOutput'):
            results[dest] = dict(curve=curve, scale=b.get('scale', 1), offset=b.get('offset', [0]*4))
    return results


def sample_colors(binding, fps, duration):
    curve = binding['curve']
    channels = [curve.get(key, {}) for key in 'rgba']
    values = []
    for frame in range(ceil(duration * fps) + 1):
        time = min(frame / fps, duration) - curve.get('timeOffset', 0)
        rgba = [scalar_value(channel, time) for channel in channels]
        if not channels[3].get('keys'):
            rgba[3] = 1
        values.append([f32(f32(v * binding['scale']) + offset) for v, offset in zip(rgba, binding['offset'])])
    return values


def apply_gate_colors(animation, materials):
    """Emit ordinary value tracks so existing gate players and catalogs interoperate."""
    if not materials:
        return animation
    sets = list(animation['sets'])
    indices = [i for i, s in enumerate(sets) if s['name'] == TIMELINE]
    if len(indices) != 1:
        return animation
    index = indices[0]
    timeline = sets[index]
    targets = list(animation['targets'])
    replacements = {}
    for material, binding in materials:
        ids = dict(material['fxParameters'])
        target = ids.get('SpriteColor')
        if target is None:
            target = len(targets)
            targets.append({})
        ids['SpriteColor'] = target
        material['fxParameters'] = ids
        values = sample_colors(binding, timeline['fps'], timeline['duration'])
        if target in replacements and replacements[target] != values:
            raise ValueError('Conflicting gate color curves for the same animation target')
        replacements[target] = values
        targets[target] = dict(targets[target], value=values[0])
        material['colorTrackSource'] = dict(resource=material['staticMaterialSource'],
                                            curve=binding['curve'].get('name', ''), set=TIMELINE)
    tracks = [track for track in timeline['tracks']
              if track['target'] not in replacements or track['field'] != 'value']
    tracks.extend(dict(target=target, field='value', values=values) for target, values in replacements.items())
    sets[index] = dict(timeline, tracks=tracks)
    return dict(animation, sets=sets, targets=targets)


def restore_gate_color_tracks(animation, sources):
    """Finish the source-owned channels omitted by the legacy scene worker."""
    if not animation.get('offlineColorTargets'):
        return animation
    animation = dict(animation)
    omitted = animation.pop('offlineColorTargets')
    materials = []
    for names, kind, index, target in omitted:
        path, effect = sources[(tuple(names), kind, index)]
        material = dict(fxParameters={'SpriteColor': target}, staticMaterialSource=path)
        materials.append((material, effect['gateColorBinding']))
    return apply_gate_colors(animation, materials)
