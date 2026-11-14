"""Find authored SOF records by internal name in a checksum-verified local index."""
from functools import cached_property

from sof_parameters import SofProjection
from sof_texture_schema import SCHEMAS
from source_resources import SourceResources

ROOT = 'res:/dx9/model/spaceobjectfactory/'


class UnsupportedSofDNA(ValueError):
    pass


def read_record(resources, path, kind):
    cls = 'EveSOFData' + kind
    reader = SofProjection(resources.read(ROOT + path + '.black'), SCHEMAS)
    return reader.root(cls, SCHEMAS[cls])


class SofResources(SourceResources):
    def __init__(self, cache, index=None, *, service="tq"):
        super().__init__(cache, index, service=service)
        self.name_indexes = {}
        self.materials = {}
        self.locator_hulls = {}
        self.hull_mesh_paths = {}
        self.turret_profiles = {}
        self.equipment_sets = {}
        self.graphic_types = {}
        self.graphic_meshes = {}
        self.smart_rigs = {}
        self.static_meshes = {}
        self.authored_light_clusters = {}
        self.shader_defaults = {}

    def static_mesh(self, path):
        from source_child_meshes import read_static_mesh
        key = self.key(path)
        if key not in self.static_meshes:
            self.static_meshes[key] = read_static_mesh(self, key)
        return self.static_meshes[key]

    def spotlight_clusters(self, path):
        from source_authored_lights import read_spotlight_clusters
        key = self.key(path)
        if key not in self.authored_light_clusters:
            self.authored_light_clusters[key] = read_spotlight_clusters(self, key)
        return self.authored_light_clusters[key]

    def effect_defaults(self, path):
        from source_effect_options import static_defaults
        key = self.key(path)
        if key not in self.shader_defaults:
            self.shader_defaults[key] = static_defaults(self.read(key))
        return self.shader_defaults[key]

    def material_options(self, effect):
        from source_effect_options import material_resource
        from resource_errors import MissingResourceError
        path = material_resource(effect)
        if not self.has(path):
            raise MissingResourceError(path or effect.get('effectFilePath', ''))
        try:
            defaults = self.effect_defaults(path)
        except FileNotFoundError as error:
            raise MissingResourceError(path) from error
        return {**defaults, **dict(effect.get('options', []))}

    def smart_rig(self, path):
        from source_smart_light_graph import read_smart_rig
        key = self.key(path)
        if key not in self.smart_rigs:
            self.smart_rigs[key] = read_smart_rig(self, key)
        return self.smart_rigs[key]

    def graphic_type(self, path):
        from black_projection import BlackProjection
        key = self.key(path)
        if not key.endswith('.black') or key not in self.index:
            return None
        if key not in self.graphic_types:
            self.graphic_types[key] = BlackProjection(self.read(key)).root_type()
        return self.graphic_types[key]

    def is_equipment(self, path):
        return self.graphic_type(path) == 'EveTurretSet'

    def equipment(self, path):
        from source_equipment import read_equipment
        key = self.key(path)
        if key not in self.equipment_sets:
            self.equipment_sets[key] = read_equipment(self, key)
        return self.equipment_sets[key]

    def graphic_geometry(self, path):
        from source_graphic_inventory import SCHEMAS, graphic_mesh_paths
        key = self.key(path)
        if self.graphic_type(key) not in SCHEMAS:
            return None
        if key not in self.graphic_meshes:
            self.graphic_meshes[key] = graphic_mesh_paths(self.read(key))
        return self.graphic_meshes[key]

    @cached_property
    def equipment_preview(self):
        from source_equipment_preview import read_preview_rig
        return read_preview_rig(self)

    def hull_geometry(self, name):
        name = name.lower()
        if name not in self.hull_mesh_paths:
            record = self.named('hulls', name, 'Hull')
            path = record.get('geometryResFilePath', '')
            self.hull_mesh_paths[name] = path.replace('\\', '/').lower()
        return self.hull_mesh_paths[name]

    def fitting_hull(self, name):
        if name not in self.locator_hulls:
            hull = self.named('hulls', name, 'Hull')
            self.locator_hulls[name] = {k: hull[k] for k in ('locatorTurrets', 'locatorSets') if k in hull}
        return self.locator_hulls[name]

    def material(self, name):
        name = name.lower()
        if name not in self.materials:
            try:
                record = self.named('materials', name, 'Material')
            except UnsupportedSofDNA:
                record = {}
            self.materials[name] = record.get('parameters', {})
        return self.materials[name]

    @cached_property
    def generic(self):
        return read_record(self, 'generic', 'Generic')

    def named(self, folder, name, kind):
        # SOF indexes objects by their authored name. Some separate BLACK files
        # have a different basename (including three swapped Gallente modules).
        path = folder + '/' + name
        if self.has(ROOT + path + '.black'):
            record = read_record(self, path, kind)
            if record.get('name', '').lower() == name:
                return record
        if folder not in self.name_indexes:
            paths = {}
            for key in self.index:
                if key.startswith(ROOT + folder + '/') and key.endswith('.black'):
                    path = key[len(ROOT):-len('.black')]
                    record = read_record(self, path, kind)
                    paths[record['name'].lower()] = path
            self.name_indexes[folder] = paths
        path = self.name_indexes[folder].get(name)
        if path is None:
            raise UnsupportedSofDNA('Missing authored ' + kind + ': ' + name)
        return read_record(self, path, kind)
