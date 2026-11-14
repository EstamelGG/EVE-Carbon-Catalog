"""Select hull triangles intersecting the oriented decal box when authored indices are absent or stale.

Trinity EveSpaceObjectDecal::CreateDecalIndexBuffers and IntersectTriangleOrientedBox (MIT)
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObject/Attachments/EveSpaceObjectDecal.cpp#L688-L775
https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Utilities/BoundingBox.cpp#L626-L734
"""
import numpy as np


def decal_indices(mesh, indices, transform):
    if indices:
        count = len(mesh['vertex']['position']) // 3
        if min(indices) >= 0 and max(indices) < count:
            values = mesh['vertex']['position']
            corners = np.array([values[i*3:i*3+3] for i in indices], dtype=np.float32).reshape(-1, 3, 3)
            if intersects_box(corners, transform).any():
                return indices
            # Keep an authored miss when the triangles still exist. Some SOF
            # lists use obsolete vertex numbers and select unrelated vertices.
            if '_decalFaces' not in mesh:
                faces = set()
                for area in mesh['indices']:
                    corners = iter(area['faces'])
                    faces.update(tuple(sorted(tri)) for tri in zip(corners, corners, corners))
                mesh['_decalFaces'] = faces
            corners = iter(indices)
            if all(tuple(sorted(tri)) in mesh['_decalFaces'] for tri in zip(corners, corners, corners)):
                return indices
    return projected_indices(mesh, transform)


def projected_indices(mesh, transform):
    positions = np.asarray(mesh['vertex']['position'], dtype=np.float32).reshape(-1, 3)
    faces = np.asarray([i for group in mesh['indices'] for i in group['faces']], dtype=np.intp).reshape(-1, 3)
    return faces[intersects_box(positions[faces], transform)].ravel().tolist()


def intersects_box(corners, transform):
    x, y, z, w = transform['rotation']
    rotation = np.array([
        [1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w)],
        [2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w)],
        [2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)]], dtype=np.float32)
    # Rows hold vertices. Invert the decal-to-hull affine map once per decal.
    linear = rotation * np.asarray(transform['scaling'], dtype=np.float32)
    if np.linalg.det(linear) == 0:
        return np.zeros(len(corners), dtype=bool)
    origin = np.asarray(transform['position'], dtype=np.float32)
    vertices = (corners - origin) @ np.linalg.inv(linear).T
    # Box faces, triangle normal and nine edge/box-axis cross products form
    # the separating-axis test. Touching the boundary counts as intersection.
    inside = ((vertices.min(axis=1) <= 1) & (vertices.max(axis=1) >= -1)).all(axis=1)
    vertices = vertices[inside]
    edges = np.roll(vertices, -1, axis=1) - vertices
    def overlaps(axes):
        projections = np.einsum('nvi,ni->nv', vertices, axes)
        radius = np.abs(axes).sum(axis=1)
        return (projections.min(axis=1) <= radius) & (projections.max(axis=1) >= -radius)
    keep = overlaps(np.cross(edges[:, 0], edges[:, 1]))
    for edge in edges.transpose(1, 0, 2):
        for axis in np.eye(3, dtype=np.float32):
            keep &= overlaps(np.cross(edge, axis))
    inside[inside] = keep
    return inside
