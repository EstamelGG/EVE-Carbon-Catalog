"""Package source effects in Blender; keep policy separate from asset decoding."""
import os
import hashlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
EXPORTER = ROOT.parent / 'tools/model_export'
sys.path[:0] = [str(ROOT / 'scripts'), str(EXPORTER), str(EXPORTER / '.deps/tools-blender/addons')]
for package in (EXPORTER / '.deps/tools-blender/packages').glob('*/src'):
    sys.path.insert(0, str(package))

from effect_attachment_lights import pack_sprites, pack_attachment_spotlights
from source_resources import SourceResources
from source_texture import DECODER_PROFILE, decode_2d_png
from core import dds_info, inside, read_json
from texture_webp import publish
from build_catalog import identity, write, store_resource
from cache_lock import file_lock
from source_effect_options import material_resource
from effect_lighting import pack_lighting, shader_options
from shared_effect_geometry import publish_catalog_effects
from resource_errors import MissingResourceError

SCHEMA_VERSION = 3
CATALOG = Path(os.environ.get('CCPDEC_CATALOG_FILE', DIST / 'data/catalog.json'))
MANIFEST = Path(os.environ.get('CCPDEC_RESOURCES_FILE', DIST / 'data/resources.json'))
CAPTURE = Path(os.environ.get('CCPDEC_EFFECTS_FILE', ROOT / '.work/native-effects.json'))


class EffectAssets:
    """Verified source assets, deduplicated by source identity and decoder recipe."""

    def __init__(self, cache, resources, *, dist=None, receipts=None):
        self.cache = cache
        self.resources = resources
        self.index = SourceResources(cache).index
        self.textures = {}
        self.meshes = {}
        self.dist = DIST if dist is None else dist
        self.receipts = ROOT / '.work/effect-textures' if receipts is None else receipts
        self.folder = self.dist / 'assets/effects'
        self.folder.mkdir(parents=True, exist_ok=True)

    def source(self, resource):
        row = self.index.get(resource.lower())
        if row is None: raise MissingResourceError(resource)
        path = inside(self.cache / 'ResFiles', row[1])
        if hashlib.md5(path.read_bytes()).hexdigest() != row[2].lower():
            raise ValueError('Effect source checksum mismatch: ' + resource)
        return path, row[2]

    def shader(self, effect):
        resource = material_resource(effect)
        return dict(resource=resource, checksum=self.index[resource.lower()][2],
                    options=list(dict(effect.get('options', [])).items()))

    def mesh(self, resource, mesh_index=0, area=0, count=1, reversed_indices=False):
        from effect_mesh_draw import beam_geometry, read_beam_meshes
        key = resource.lower()
        draw = (mesh_index, area, count, reversed_indices)
        if key not in self.meshes:
            source, checksum = self.source(resource)
            self.meshes[key] = dict(resource=resource, checksum=checksum, meshes=read_beam_meshes(source), draws={})
        entry = self.meshes[key]
        if draw not in entry['draws']:
            entry['draws'][draw] = beam_geometry(entry['meshes'], resource, entry['checksum'], *draw)
        return entry['draws'][draw]

    def texture_recipe(self, resource):
        return dict(kind='effect-texture', resource=resource, checksum=self.index[resource][2],
                    decoder=DECODER_PROFILE, volumeDecoder='dds-mip-stack-v1')

    def texture(self, resource):
        resource = resource.lower()
        if resource in self.textures:
            return self.textures[resource]
        source, _ = self.source(resource)
        recipe = self.texture_recipe(resource)
        key = identity(recipe)
        receipt = self.receipts / (key + '.json')
        with file_lock(receipt.with_suffix('.lock')):
            if receipt.is_file():
                saved = read_json(receipt)
                path = self.dist / saved['record']['file']
                if path.is_file() and path.stat().st_size == saved['record']['bytes']:
                    self.resources[key] = saved['record']
                    self.textures[resource] = saved['result']
                    return saved['result']
            with source.open('rb') as stream:
                is_dds = stream.read(4) == b'DDS '
            if is_dds and dds_info(source)['volume']:
                from volume_dds import decode_volume
                volume = decode_volume(source.read_bytes())[0]
                target = self.folder / (key + '.rgba')
                store_resource(target, volume.rgba)
                result = dict(url=target.relative_to(self.dist).as_posix(),
                              volume=[volume.width, volume.height, volume.depth])
            else:
                target = publish(self.folder, decode_2d_png(source))
                result = dict(url=target.relative_to(self.dist).as_posix())
            self.resources[key] = dict(key=key, file=result['url'], bytes=target.stat().st_size, recipe=recipe)
            write(receipt, dict(record=self.resources[key], result=result))
            self.textures[resource] = result
            return result


def pack_effects(record, assets, sof_resources=None, item=None):
    from source_authored_lights import assemble_authored_clusters, hull_spotlight_clusters
    from source_smart_lights import assembled_light_sets, set_locator_names, source_light_rigs, uses_hull_light_order
    from sof_light_locators import lighting_locators, spotlight_locators
    from sof_boosters import pack_booster
    from sof_resources import SofResources
    from sof_attachments import attachment_definitions
    from sof_spotlights import spotlight_sets
    from sof_sprites import sprite_sets
    if sof_resources is None and record['dna']:
        sof_resources = SofResources(assets.cache, assets.index)
    lights = record
    if record['dna']:
        definitions = attachment_definitions(sof_resources, record['dna'])
        hull_order = uses_hull_light_order(item, definitions) if item is not None else record.get('hullLightOrder', False)
        record = dict(record)
        if hull_order:
            clusters = hull_spotlight_clusters(sof_resources, definitions)
            if clusters:
                record['authoredSpotlights'] = assemble_authored_clusters(clusters, record.get('authoredSpotlights', []))
        if hull_order or any('sourceRig' in s for s in record.get('smartLightSets', [])):
            record['smartLightSets'] = assembled_light_sets(source_light_rigs(sof_resources, definitions), record, hull_order)
        names = set(set_locator_names(record.get('smartLightSets', [])))
        record['locatorSets'] = lighting_locators(spotlight_locators(definitions[0], names), {} if hull_order else record)
        lights = dict(attachments=sprite_sets(*definitions), sofSpotlights=spotlight_sets(*definitions))
    return dict(
        version=SCHEMA_VERSION, typeID=record['typeID'], dna=record['dna'],
        sprites=pack_sprites(lights), attachmentSpotlights=pack_attachment_spotlights(lights, assets),
        lighting=pack_lighting(record, assets, sof_resources.material_options if sof_resources else shader_options),
        booster=pack_booster(record, assets, sof_resources),
        animation=dict(isAnimated=record.get('isAnimated', False), source='mesh GR2; controller names alone are not animation clips'),
    )


def main():
    cache = Path(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else Path('E:/EVE/SharedCache')
    manifest = read_json(MANIFEST)
    resources = {r['key']: r for r in manifest['resources']}
    assets = EffectAssets(cache, resources)
    capture = read_json(CAPTURE)
    catalog = read_json(CATALOG)
    from sof_resources import SofResources
    sof_resources = SofResources(cache, assets.index)
    report = []
    for item in catalog['items']:
        if not item.get('available'):
            continue
        result = pack_effects(capture[str(item['id'])], assets, sof_resources, item)
        item.update(publish_catalog_effects(DIST, result, resources))
        report.append(dict(typeID=item['id'], mode=result['lighting']['mode'],
                           sourceCounts=result['lighting']['sourceCounts'], unsupported=result['lighting']['unsupported']))
    manifest['resources'] = list(resources.values())
    write(MANIFEST, manifest)
    write(CATALOG, catalog)
    write(CAPTURE.parent / 'lighting-coverage.json', report)
    print('EFFECT_INPUTS_READY', len(capture), len(assets.textures), flush=True)


if __name__ == '__main__':
    main()
