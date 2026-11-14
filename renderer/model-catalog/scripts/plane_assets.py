"""Upgrade only dynamic plane effects; keep completed geometry and materials.

Uses the same private batch environment as effect_assets.py, after that stage.
--refresh-existing upgrades previously completed assets under the worker lock.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from effect_assets import (EffectAssets, CATALOG, MANIFEST, CAPTURE, ROOT, DIST,
                           read_json, identity)
from billboard_assets import BillboardAssets, CHANNELS
from effect_planes import pack_planes
from sof_attachments import attachment_definitions
from sof_planes import plane_sets
from sof_resources import SofResources
from build_catalog import write
from published_effects import load_effects
from shared_effect_geometry import publish_catalog_effects


class PlaneAssets(EffectAssets):
    def __init__(self, cache, resources, *, dist=None, receipts=None):
        super().__init__(cache, resources, dist=dist, receipts=receipts)
        self.videos = BillboardAssets(self.index, self.cache, self.dist)

    def texture(self, resource):
        resource = resource.lower()
        if resource in CHANNELS:
            return self.videos.texture(resource)
        if resource.endswith('.tga') and resource not in self.index and resource[:-4] + '.dds' in self.index:
            resource = resource[:-4] + '.dds'
        if resource not in self.index:
            return super().texture(resource)
        recipe = self.texture_recipe(resource)
        cached = self.resources.get(identity(recipe))
        if cached:
            path = self.dist / cached['file']
            # A volume also needs its three dimensions from the decode receipt.
            if path.suffix != '.rgba' and path.is_file() and path.stat().st_size == cached['bytes']:
                return dict(url=cached['file'])
        return super().texture(resource)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--refresh-existing', action='store_true')
    parser.add_argument('--type-id', type=int, action='append')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    cache, refresh = args.cache, args.refresh_existing
    catalog, manifest = read_json(CATALOG), read_json(MANIFEST)
    resources = {r['key']: r for r in manifest['resources']}
    assets = PlaneAssets(cache, resources)
    sof = SofResources(cache, assets.index)
    capture = None
    selected_effects = {i.get('effects') for i in catalog['items'] if i['id'] in (args.type_id or [])}
    seen, count, upgraded = {}, 0, 0
    skipped = set()
    for item in catalog['items']:
        if not item.get('available') or not item.get('effects'):
            continue
        if args.type_id and item['effects'] not in selected_effects:
            continue
        if item['effects'] in skipped:
            continue
        target = DIST / item['effects']
        if item['effects'] not in seen:
            result = load_effects(target, DIST, refresh=refresh)
            if result is None:
                skipped.add(item['effects'])
                continue
            if item.get('dna'):
                record = dict(sofPlanes=plane_sets(*attachment_definitions(sof, item['dna'])))
            else:
                if capture is None:
                    capture = read_json(CAPTURE) if CAPTURE.exists() else {}
                native_id = str(item.get('nativeTypeID', item['id']))
                record = capture.get(native_id)
                batch = ROOT / '.work/coverage/batches' / item.get('renderKey', '') / 'native-effects.json'
                if refresh and batch.is_file():
                    record = read_json(batch).get(native_id, record)
                if record is None:
                    if refresh:
                        continue
                    raise ValueError('Missing plane source for ' + str(item['id']))
                record = {k: record.get(k, []) for k in ('attachments', 'planeSets')}
            packed = pack_planes(record, assets)
            revision = identity(packed)
            if result.get('planeGlow', {}).get('sourceRevision') != revision:
                result['planeGlow'] = dict(packed, sourceRevision=revision)
            seen[item['effects']] = publish_catalog_effects(DIST, result, resources)
            upgraded += seen[item['effects']]['effects'] != item['effects']
            count += sum(len(s['planes']) for s in result['planeGlow']['sets'])
    for item in catalog['items']:
        if item.get('effects') in seen:
            item.update(seen[item['effects']])
    manifest['resources'] = list(resources.values())
    write(MANIFEST, manifest)
    write(CATALOG, catalog)
    print('PLANE_EFFECTS_READY', upgraded, 'upgraded;', len(seen) - upgraded,
          'reused;', len(skipped), 'incomplete skipped;', count, 'planes;', len(assets.textures), 'textures decoded', flush=True)


if __name__ == '__main__':
    main()
