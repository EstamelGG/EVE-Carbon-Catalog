"""Resolve the main GR2 chosen by the authored SOF hull and its DNA.

CCP Trinity (MIT), EveSOF::CreateMesh and EveSOFDNA::GetHullGeometryResPath:
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDNA.cpp#L1023-L1058
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOF.cpp#L724-L741
"""
from math import dist

from sof_locators import placed_hulls
from sof_resources import UnsupportedSofDNA


def geometry_for_dna(resources, dna):
    names = dna.partition(':')[0].lower().split(';')
    if not all(names):
        raise UnsupportedSofDNA('Missing SOF hull name: ' + dna)
    geometry = resources.hull_geometry(names[0])
    if len(names) == 1:
        return geometry
    # The order of subsystem names is also the order in the combined GR2 filename.
    variant = ''.join(name[-1] for name in names)
    suffix = names[0].rsplit('_', 1)[-1]
    return geometry.replace(suffix + '.gr2', variant + '.gr2').replace(suffix + '/', 'all/')


def hull_bounding_sphere(hulls):
    if len(hulls) == 1:
        return hulls[0].get('boundingSphere')
    # EveSOFDNA::GetHullBoundingSphere places the authored spheres at their
    # subsystem offsets. IncludeSphere supplies the exterior tangent sphere.
    # https://github.com/carbonengine/math/blob/e998264e693e0a2a6121627aed43ed584f2baa4d/include/Sphere_inline.h#L72-L95
    result = None
    for hull, offset in placed_hulls(hulls):
        sphere = hull.get('boundingSphere')
        if sphere is None or sphere[3] < 0:
            continue
        center = [v + d for v, d in zip(sphere[:3], offset)]
        radius = sphere[3]
        if result is None:
            result = [*center, radius]
            continue
        previous, old_radius = result[:3], result[3]
        distance = dist(center, previous)
        if distance + radius <= old_radius:
            continue
        if distance + old_radius <= radius:
            result = [*center, radius]
            continue
        merged = (old_radius + radius + distance) / 2
        weight = (merged - old_radius) / distance
        result = [a + (b - a) * weight for a, b in zip(previous, center)] + [merged]
    return result
