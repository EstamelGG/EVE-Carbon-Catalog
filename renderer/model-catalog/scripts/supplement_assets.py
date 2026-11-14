"""Incrementally capture/package child effects and decals; never rebake completed hulls."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plane_assets import PlaneAssets
from effect_assets import CATALOG, MANIFEST, ROOT, DIST, read_json, identity
from effect_supplements import pack_supplements, omit_empty_decals
from build_catalog import write, store_resource
from supplement_cache import capture_revision, capture_current, receipt, reusable
from published_effects import load_effects
from shared_effect_geometry import publish_catalog_effects
from sof_attachments import attachment_definitions
from source_child_textures import apply_child_textures
from sof_decals import decal_inputs
from sof_geometry import geometry_for_dna
from sof_resources import SofResources
from catalog_effect_inputs import static_catalog_scene


class SupplementAssets(PlaneAssets):
    def __init__(self, cache, resources, *, dist=None, receipts=None):
        super().__init__(cache, resources, dist=dist, receipts=receipts)
        self.projection_meshes = {}

    def cube_texture(self, resource):
        source, checksum = self.source(resource)
        content = source.read_bytes()
        # Preserve the authored DDS cube faces and mip chain, without rebaking.
        from effect_cubemap import validate_cube
        validate_cube(content)
        target = self.folder / (hashlib.sha256(content).hexdigest() + '.dds')
        store_resource(target, content)
        recipe = dict(kind='effect-cube', resource=resource, checksum=checksum, decoder='source-dds-v1')
        key = identity(recipe)
        url = target.relative_to(self.dist).as_posix()
        self.resources[key] = dict(key=key, file=url, bytes=len(content), recipe=recipe)
        return dict(url=url, cube=True)

    def geometry(self, resource, mesh_index=0, area=0, count=1, indices=None, projection=None):
        source, checksum = self.source(resource)
        cache_key = (resource, mesh_index)
        if cache_key not in self.projection_meshes:
            from carbon_gr2 import read_gr2
            self.projection_meshes[cache_key] = read_gr2(source)['meshes'][mesh_index]
        mesh = self.projection_meshes[cache_key]
        if projection is not None:
            from decal_geometry import decal_indices
            indices = decal_indices(mesh, indices, projection)
        elif indices is None:
            indices = [v for group in mesh['indices'][area:area + count] for v in group['faces']]
        used = sorted(set(indices)); remap = {v: n for n, v in enumerate(used)}
        key = identity(dict(source=checksum, mesh=mesh_index, indices=indices))
        result = dict(checksum=key, indices=[remap[v] for v in indices])
        for dst, src, size in [('position', 'position', 3), ('normal', 'normal', 3), ('uv', 'texcoord0', 2)]:
            result[dst] = [x for v in used for x in mesh['vertex'][src][v * size:(v + 1) * size]]
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--type-id', type=int, action='append')
    parser.add_argument('--refresh-existing', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.cache = args.cache.resolve()
    catalog, manifest = read_json(CATALOG), read_json(MANIFEST)
    resources = {r['key']: r for r in manifest['resources']}
    assets = SupplementAssets(args.cache, resources)
    sof = SofResources(args.cache, assets.index)
    cache_index = identity(assets.index)
    selected = {i.get('effects') for i in catalog['items'] if i['id'] in (args.type_id or [])}
    unique = {i['effects']: i for i in reversed(catalog['items']) if i.get('available') and i.get('effects')
              and i.get('dna') and i.get('renderKind') != 'equipment'
              and (not args.type_id or i['effects'] in selected)}
    updates = {}; upgraded = 0; skipped = 0
    for number, (url, item) in enumerate(unique.items(), 1):
        target = DIST / url
        result = load_effects(target, DIST, refresh=args.refresh_existing)
        if result is None:
            skipped += 1
            continue
        work = ROOT / '.work/supplements' / item.get('renderKey', str(item['id']))
        capture = work / 'capture.json'; stamp = work / 'capture-revision.json'
        saved_stamp = read_json(stamp) if capture.exists() and stamp.exists() else None
        source_paths = [rig['sourceRigPath'] for rig in result.get('lighting', {}).get('sets', [])
                        if 'sourceRigPath' in rig]
        source_index = identity([cache_index, source_paths]) if source_paths else cache_index
        supplements = result.get('supplements', {})
        rebuild = not reusable(supplements, source_index, item['dna'], saved_stamp)
        if rebuild:
            print(f'  补充材质 {number}/{len(unique)}: {item["id"]} {item["dna"]}', flush=True)
            work.mkdir(parents=True, exist_ok=True)
            if not capture_current(saved_stamp, source_index):
                scene = static_catalog_scene(sof, item)
                if scene is not None:
                    write(capture, {str(item.get('nativeTypeID', item['id'])): scene['supplement']})
                else:
                    write(work / 'catalog.json', dict(items=[dict(item, sourceRigPaths=source_paths)]))
                    env = dict(os.environ, EVE_ROOT=str(args.cache), EVE_CLIENT_SERVICE='tq',
                        PYTHONHOME=str(ROOT.parent / 'viewer/runtime/python27'),
                        PYTHONPATH=str(ROOT.parent / 'viewer/runtime/python27/Lib'),
                        CCPDEC_CATALOG_FILE=str(work / 'catalog.json'), CCPDEC_SUPPLEMENTS_FILE=str(capture))
                    client = args.cache / 'tq/bin64/exefile.exe'
                    with (work / 'capture.log').open('w') as log:
                        subprocess.run([str(client), '/noconsole', '/py', str(ROOT / 'scripts/capture_supplements.py')],
                            env=env, cwd=client.parent, stdout=log, stderr=subprocess.STDOUT, timeout=150, check=True)
                write(stamp, capture_revision(source_index))
            record = read_json(capture)[str(item.get('nativeTypeID', item['id']))]
            geometry = geometry_for_dna(sof, item['dna'])
            definitions = attachment_definitions(sof, item['dna'])
            apply_child_textures(sof, definitions, record.get('children', []))
            record.update(geometry=geometry, decals=decal_inputs(sof, definitions, geometry, item['dna']))
            result['supplements'] = pack_supplements(record, assets, result.get('lighting'), sof.material_options)
            omit_empty_decals(result['supplements'])
            upgraded += 1
        supplements = result['supplements']
        expected = receipt(supplements, source_index, item['dna'])
        if rebuild or supplements.get('revision') != identity(expected):
            supplements.update(expected)
            supplements['revision'] = identity(expected)
        updates[url] = publish_catalog_effects(DIST, result, resources)
    for item in catalog['items']:
        if item.get('effects') in updates:
            item.update(updates[item['effects']])
    manifest['resources'] = list(resources.values())
    write(MANIFEST, manifest); write(CATALOG, catalog)
    print('SUPPLEMENTS_READY', upgraded, 'upgraded;', len(unique) - upgraded - skipped,
          'reused;', skipped, 'incomplete skipped', flush=True)


if __name__ == '__main__': main()
