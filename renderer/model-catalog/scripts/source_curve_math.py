"""Small data-only port of the public Trinity curves used by preview lighting.

Trinity f644516ae4f921f6f3a3e58dc5d19107781571ec: Curves/Tr2CurveScalar.cpp
(key tangents, GetValue/GetLocalTime/GetSegmentValue), Tr2CurveColorMixer.cpp,
Tr2CurveEulerRotation.cpp, TriCurveSet::Apply, TriValueBinding.cpp.
Copyright © 2017 CCP ehf.; MIT: ../../docs/licenses/carbon-trinity-MIT.txt.
Quaternion: carbonengine/math e998264e693e0a2a6121627aed43ed584f2baa4d,
src/Quaternion.cpp, RotationQuaternion scalar branch. Copyright CCP Games.
MIT: ../../docs/licenses/carbon-math-MIT.txt.
https://github.com/carbonengine/math/blob/e998264e693e0a2a6121627aed43ed584f2baa4d/src/Quaternion.cpp
"""
import ast
import math
import operator
import struct


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def prepared_keys(curve):
    keys = sorted((list(k) for k in curve.get('keys', [])), key=lambda k: k[0])
    for i, key in enumerate(keys):
        mode = key[6]
        if mode in (0, 1):
            tangent = 0.0
            if 0 < i < len(keys) - 1:
                prev, nxt = keys[i - 1], keys[i + 1]
                if mode == 0:
                    difference = abs(prev[1] - nxt[1])
                    extreme = key[1] < min(prev[1], nxt[1]) or key[1] > max(prev[1], nxt[1])
                    if difference and not extreme:
                        distance = abs(key[1] - prev[1]) / difference
                        tangent = (nxt[1] - prev[1]) / (nxt[0] - prev[0]) * min(1, min(distance, 1-distance)*6)
                else:
                    left = (key[1]-prev[1])/(key[0]-prev[0]) if key[0]-prev[0] > 1e-6 else 0
                    right = (nxt[1]-key[1])/(nxt[0]-key[0]) if nxt[0]-key[0] > 1e-6 else 0
                    fraction = (key[0]-prev[0])/(nxt[0]-prev[0])
                    tangent = left*(1-fraction)+right*fraction
            key[2] = key[3] = f32(tangent)
        elif mode == 2:
            key[3] = key[2]
        elif mode != 3:
            raise ValueError('Unsupported scalar tangent type: %s' % mode)
    return keys


def scalar_value(curve, time):
    keys = prepared_keys(curve)
    if not keys:
        return 0.0
    t = time / curve.get('timeScale', 1.0) - curve.get('timeOffset', 0.0)
    first, last = keys[0], keys[-1]
    before = t < first[0]
    mode = curve.get('extrapolationBefore' if before else 'extrapolationAfter', 0)
    if mode not in (0, 1, 2, 3):
        raise ValueError('Unsupported scalar extrapolation: %s' % mode)
    if t < first[0] or t > last[0]:
        edge = first if before else last
        if mode == 3:
            return f32(edge[1] + (f32(t)-edge[0])*edge[2 if before else 3])
        if mode == 0:
            return edge[1]
        if last[0] != first[0]:
            fraction, whole = math.modf(abs(t-first[0])/(last[0]-first[0]))
            if (before and mode == 1) or (mode == 2 and int(whole) % 2):
                fraction = 1-fraction
            t = fraction*(last[0]-first[0])+first[0]
    if len(keys) == 1:
        return first[1]
    t = f32(t)
    a, b = keys[-2:]
    for left, right in zip(keys, keys[1:]):
        if left[0] <= t < right[0]:
            a, b = left, right
            break
    length = b[0]-a[0]
    if a[5] == 0:
        return b[1] if t == b[0] else a[1]
    if length == 0:
        return b[1]
    s = (t-a[0])/length
    if a[5] == 1:
        return f32(a[1]+(b[1]-a[1])*s)
    if a[5] != 2:
        raise ValueError('Unsupported scalar interpolation: %s' % a[5])
    s2, s3 = s*s, s*s*s
    c2, c4 = -2*s3+3*s2, s3-s2
    return f32(a[1]*(1-c2)+b[1]*c2+a[3]*length*(s+c4-s2)+b[2]*length*c4)


def color_value(curve):
    first, second = curve.get('color1', [0, 0, 0, 1]), curve.get('color2', [0, 0, 0, 1])
    lerp = curve.get('lerpValue', 0)
    out = [f32(a+(b-a)*lerp) for a, b in zip(first, second)]
    saturation = curve.get('saturation', 1)
    if saturation != 1:
        intensity = out[0]*0.299+out[1]*0.587+out[2]*0.114
        out = [f32(intensity+(v-intensity)*max(0, saturation)) for v in out]
    out = [f32(v*curve.get('brightness', 1)) for v in out]
    if curve.get('alphaOverride', -1) != -1:
        out[3] = min(1, max(0, curve['alphaOverride']))
    return out


def euler_quaternion(yaw, pitch, roll):
    sy, sp, sr = [math.sin(v/2) for v in (yaw, pitch, roll)]
    cy, cp, cr = [math.cos(v/2) for v in (yaw, pitch, roll)]
    return [f32(v) for v in (sy*cp*sr+cy*sp*cr, sy*cp*cr-cy*sp*sr,
                             cy*cp*sr-sy*sp*cr, cy*cp*cr+sy*sp*sr)]


def expression_value(curve, time):
    # Local expression interpreter, not Python eval or the client's compiler.
    # Implements arithmetic + named scalar inputs; other expression features are
    # explicitly unsupported until their public semantics have been ported.
    values = {name: curve.get(name, 0) for name in ('input1', 'input2', 'input3', 'input4')}
    values['time'] = time
    binary = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
    def evaluate(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.Name) and node.id in values:
            return values[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in binary:
            return binary[type(node.op)](evaluate(node.left), evaluate(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return evaluate(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        raise ValueError('Unsupported source curve expression: ' + curve['expression'])
    return f32(evaluate(ast.parse(curve.get('expression') or '0', mode='eval').body))


def apply_curve_set(curve_set, types, time):
    # TriCurveSet::Apply evaluates all curves BEFORE copying bindings. In the
    # preview rig, getScale writes the NEXT evaluation's input1, not this one.
    for curve in curve_set.get('curves', []):
        kind = types[id(curve)]
        if kind == 'Tr2CurveScalar':
            value = scalar_value(curve, time)
        elif kind == 'Tr2CurveColorMixer':
            value = color_value(curve)
        elif kind == 'Tr2CurveScalarExpression':
            value = expression_value(curve, time)
        elif kind == 'Tr2CurveEulerRotation':
            value = euler_quaternion(*(scalar_value(curve.get(axis, {}), time) for axis in ('yaw', 'pitch', 'roll')))
        else:
            raise ValueError('Unsupported source curve: ' + kind)
        curve['currentValue'] = value
    for binding in curve_set.get('bindings', []):
        source, destination = binding['sourceObject'], binding['destinationObject']
        attribute = binding['sourceAttribute']
        if attribute == 'boundingSphereRadius' and types[id(source)] == 'EveSpaceObjectFxAttributes':
            value = source.get(attribute, 0.0)  # Official constructor, no parent ship attached.
        else:
            value = source[attribute]
        target = binding['destinationAttribute']
        width = {'color': 4, 'rotation': 4, 'scaling': 3}.get(target, 1)
        offset, scale = binding.get('offset', [0]*4), binding.get('scale', 1)
        values = value if isinstance(value, list) else [value]*width
        if len(values) != width:
            raise ValueError('Unsupported binding shape: ' + binding.get('name', target))
        out = [f32(v*scale+offset[i]) for i, v in enumerate(values)]
        destination[target] = out if width > 1 else out[0]
