"""Python 2/3 native hull bounds contract for normal model capture."""
import math

FIELDS = ('sourceRadius', 'sourceCenter', 'sourceBounds')


def validate(value):
    radius, center, bounds = (value[name] for name in FIELDS)
    if len(center) != 3 or len(bounds) != 2 or any(len(v) != 3 for v in bounds):
        raise ValueError('Invalid native hull bounds shape')
    numbers = [radius] + list(center) + list(bounds[0]) + list(bounds[1])
    if any(isinstance(n, bool) or not isinstance(n, (int, float)) or math.isnan(n) or math.isinf(n) for n in numbers):
        raise ValueError('Non-finite native hull bounds')
    if radius < 0 or any(a > b for a, b in zip(*bounds)):
        raise ValueError('Invalid native hull bounds range')
    return dict((name, value[name]) for name in FIELDS)


def model_bounds(model, source_sphere=None):
    # EveSOF::SetupMesh assigns the standalone hull sphere. Native radius scales
    # with modelScale, while its local center does not. Keep evaluated dynamic bounds.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/EveSpaceObject2.cpp#L2318-L2339
    if source_sphere is not None and not getattr(model, 'dynamicBoundingSphereEnabled', True):
        radius = source_sphere[3] * model.modelScale
        center = source_sphere[:3]
    else:
        radius, center = model.GetBoundingSphereRadius(), model.GetBoundingSphereCenter()
    return validate(dict(sourceRadius=float(radius), sourceCenter=list(center),
                         sourceBounds=[list(v) for v in model.GetLocalBoundingBox()]))
