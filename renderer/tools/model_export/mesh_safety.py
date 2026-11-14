"""Protect Blender's custom-normal setter and honor the client's draw list."""
from contextlib import contextmanager


@contextmanager
def safe_mesh_import(importer, visible_slots):
    original_faces = importer._build_faces_and_material_map
    original_normals = importer._apply_custom_normals
    stats = {'undrawnFaces': 0, 'invalidFaces': 0}

    def faces(entry, mesh_name):
        triangles, groups, names = original_faces(entry, mesh_name)
        kept = [(triangle, group) for triangle, group in zip(triangles, groups) if group in visible_slots]
        stats['undrawnFaces'] += len(triangles) - len(kept)
        return [t for t, g in kept], [g for t, g in kept], names

    def normals(mesh, values, count):
        # Blender 5 can access invalid topology inside normals_split_custom_set.
        # Validate before that native call, retaining UVs, weights and slot IDs.
        before = len(mesh.polygons)
        mesh.validate(clean_customdata=False)
        mesh.update(calc_edges=True)
        stats['invalidFaces'] += before - len(mesh.polygons)
        return original_normals(mesh, values, count)

    importer._build_faces_and_material_map = faces
    importer._apply_custom_normals = normals
    try:
        yield stats
    finally:
        importer._build_faces_and_material_map = original_faces
        importer._apply_custom_normals = original_normals
