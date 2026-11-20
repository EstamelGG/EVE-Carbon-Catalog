"""Build the WebGL fallback for preview packages that omit native camera bounds.

Usage: py -3 build_preview_bounds.py SHARED_CACHE MODEL_ASSETS
Inputs are the installed EVE resource index and the builder's published catalog.
"""
import argparse
import json
from pathlib import Path

from sof_light_locators import _locator_sets
from sof_resources import ROOT, SofResources, read_record


def preview_bounds(cache, assets):
    resources = SofResources(cache)
    index = assets / 'public/res/index'
    plan = json.loads((assets / 'reports/sde-plan.json').read_bytes())
    roots = {item['dna']: item['roots'][0] for item in plan['items'] if item.get('roots')}

    turrets = {}
    for path in (index / 'models').glob('*.json'):
        model = json.loads(path.read_bytes())
        if model.get('renderKind') == 'equipment':
            dna = path.stem.replace('~3a~', ':')
            turrets[dna] = resources.equipment(roots[dna])['boundingSphere']

    missing = set()
    for path in (index / 'hulls').glob('*.json'):
        base = json.loads(path.read_bytes()).get('base', {})
        if not base.get('appearance', {}).get('extras', {}).get('ccpdec', {}).get('sourceRadius'):
            missing.add(path.stem)
    hull_bounds, look_at = {}, {}
    for path in resources.index:
        if not (path.startswith(ROOT + 'hulls/') and path.endswith('.black')):
            continue
        blob = resources.read(path)
        if b'camera_look_at' not in blob.lower() and Path(path).stem not in missing:
            continue
        hull = read_record(resources, path[len(ROOT):-len('.black')], 'Hull')
        name = hull['name'].lower()
        sphere = hull.get('boundingSphere')
        if name in missing and sphere and sphere[3] > 0:
            hull_bounds[name] = sphere
        for group in _locator_sets(hull.get('locatorSets', [])):
            if group.get('name') == 'camera_look_at' and group.get('locators'):
                look_at[name] = group['locators'][0].get('position', [0, 0, 0])
                break
    return {'turrets': turrets, 'hulls': hull_bounds, 'lookAt': look_at}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('assets', type=Path)
    args = parser.parse_args()
    sections = []
    for name, values in preview_bounds(args.cache, args.assets).items():
        rows = [f'    {json.dumps(key)}: {json.dumps(value)}' for key, value in sorted(values.items())]
        sections.append(f'  "{name}": {{\n' + ',\n'.join(rows) + '\n  }')
    Path(__file__).with_name('preview-bounds.json').write_text('{\n' + ',\n'.join(sections) + '\n}\n', encoding='utf-8')
