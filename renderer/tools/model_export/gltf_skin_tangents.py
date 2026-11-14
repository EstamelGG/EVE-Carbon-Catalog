"""Keep skinned glTF tangents in the same space as positions and normals.

Blender 5.0 exports skinned positions/normals in object world space, but
its tangent extractor uses armature-relative space. Patch only for this
export; never change the installed Blender addon.
"""
from contextlib import contextmanager
import numpy as np


@contextmanager
def coherent_skin_tangents():
    from io_scene_gltf2.blender.exp.primitive_extract import PrimitiveCreator
    tangent_name = '_PrimitiveCreator__get_tangents'
    signs_name = '_PrimitiveCreator__get_bitangent_signs'
    original_tangents = getattr(PrimitiveCreator, tangent_name)
    original_signs = getattr(PrimitiveCreator, signs_name)

    def tangents(self):
        if not (self.armature and self.blender_object):
            return original_tangents(self)
        values = np.empty(len(self.blender_mesh.loops) * 3, dtype=np.float32)
        self.blender_mesh.loops.foreach_get('tangent', values)
        self.tangents = PrimitiveCreator.apply_mat_to_all(
            self.blender_object.matrix_world.to_3x3(), values.reshape(-1, 3))
        PrimitiveCreator.normalize_vecs(self.tangents)
        if self.export_settings['gltf_yup']:
            PrimitiveCreator.zup2yup(self.tangents)

    def signs(self):
        if not (self.armature and self.blender_object):
            return original_signs(self)
        self.signs = np.empty(len(self.blender_mesh.loops), dtype=np.float32)
        self.blender_mesh.loops.foreach_get('bitangent_sign', self.signs)
        if self.blender_object.matrix_world.to_3x3().determinant() < 0:
            self.signs *= -1

    setattr(PrimitiveCreator, tangent_name, tangents)
    setattr(PrimitiveCreator, signs_name, signs)
    try:
        yield
    finally:
        setattr(PrimitiveCreator, tangent_name, original_tangents)
        setattr(PrimitiveCreator, signs_name, original_signs)
