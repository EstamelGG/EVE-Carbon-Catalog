"""Repair isolated native color interpolation singularities, with receipts."""
import copy
import math


def repair_color_samples(animation, color_targets):
    result = animation
    repairs = []
    for set_index, curve_set in enumerate(animation.get('sets', [])):
        for track_index, track in enumerate(curve_set.get('tracks', [])):
            if track.get('target') not in color_targets or track.get('field') != 'value':
                continue
            values = track.get('values', [])
            if not values or not all(isinstance(v, list) and len(v) == 4 for v in values):
                continue
            for component in range(4):
                invalid = [i for i, value in enumerate(values) if not math.isfinite(value[component])]
                if not invalid:
                    continue
                # Do not invent a default color or repair long/boundary gaps.
                # The native arena color transition has just two bad samples.
                for frame in invalid:
                    left, right = frame - 1, frame + 1
                    while left >= 0 and not math.isfinite(values[left][component]): left -= 1
                    while right < len(values) and not math.isfinite(values[right][component]): right += 1
                    if left < 0 or right == len(values) or right - left > 3:
                        raise ValueError('Unrecoverable color samples: %s target %s' % (curve_set.get('name'), track['target']))
                    if result is animation:
                        result = copy.deepcopy(animation)
                    fraction = float(frame - left) / (right - left)
                    value = values[left][component] * (1 - fraction) + values[right][component] * fraction
                    result['sets'][set_index]['tracks'][track_index]['values'][frame][component] = value
                repairs.append(dict(set=curve_set.get('name'), target=track['target'], field='value',
                                    component=component, frames=invalid, method='bounded-linear-interpolation'))
    if repairs:
        result['sampleRepairs'] = repairs
    return result
