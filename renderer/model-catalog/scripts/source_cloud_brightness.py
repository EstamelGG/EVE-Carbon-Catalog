"""Translate the two-input fractal brightness controller in SOF particle children.

CCP MIT, Tr2CurveScalarExpression.cpp (Fractal, Input and GetRandomConstant)
and TriValueBinding.cpp (scale and offset). Other expressions keep their
original playback route.
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Curves/Tr2CurveScalarExpression.cpp
"""
from source_curve_math import prepared_keys
from source_gate_colors import direct_curve_bindings, GateCurveReader
from source_light_rig import LIGHT_RIG_SCHEMAS


def cloud_brightness_bindings(content, schema, destinations):
    result = {}
    for graph, dest, binding, timeline, writers in direct_curve_bindings(
            content, schema, destinations, 'play_start', ambient=True):
        ref = binding['sourceObject']
        bounds = graph.references[ref]
        curve_reader = GateCurveReader(content, schema)
        curve_reader.offset = bounds[0]
        if curve_reader.string() != 'Tr2CurveScalarExpression':
            continue
        # Definitions nested inside this expression have IDs greater than its
        # own. Earlier definitions are back-references when revisiting the curve.
        curve_reader.highest_definition = ref
        curve_reader.references.update({i: b for i, b in graph.references.items() if i < ref})
        curve_reader.schemas['Tr2CurveScalarExpression'] = LIGHT_RIG_SCHEMAS['Tr2CurveScalarExpression']
        expression = curve_reader.record_at(bounds)
        if ''.join(expression.get('expression', '').split()) != 'fractal(time,2,2,2)*input(0)*input(1)':
            continue
        inputs = expression.get('inputs', [])
        if len(inputs) != 2 or not all(inputs):
            continue
        by_object = {id(curve_reader.objects[start]): i for i, (start, _) in curve_reader.references.items()
                     if start in curve_reader.objects}
        curves = []
        for item in inputs:
            if (curve_reader.types[id(item)] != 'Tr2CurveScalar' or by_object.get(id(item)) in writers
                    or item.get('timeScale', 1) != 1 or item.get('timeOffset', 0) != 0
                    or item.get('extrapolationBefore', 0) != 0 or item.get('extrapolationAfter', 0) != 1):
                break
            keys = prepared_keys(item)
            if len(keys) < 2 or keys[0][0] != 0 or any(
                    a[0] >= b[0] or a[5] not in (0, 1, 2) for a, b in zip(keys, keys[1:])):
                break
            curves.append([[time, value, left, right, interpolation]
                           for time, value, left, right, _, interpolation, _ in keys])
        if len(curves) == 2:
            result[dest] = dict(kind='fractalProduct', inputs=curves, clockScale=timeline.get('scale', 1),
                                scale=binding.get('scale', 1), offset=binding.get('offset', [0])[0])
    return result
