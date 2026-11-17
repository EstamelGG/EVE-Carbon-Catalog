"""Publish immutable browser chunks; retain catalog.json for build tools."""
from collections import defaultdict
from copy import deepcopy
import json
import os
import re
import time

SEARCH_FIELDS = ('id', 'groupID', 'categoryID', 'renderKind', 'name', 'available', 'raceID', 'techLevel', 'metaGroupID', 'nativeTypeID', 'dna')
CHUNK = re.compile(r'(?:group-\d+|search)-[0-9a-f]{20}\.json\Z')


def publish_catalog_parts(path, catalog, write):
    if 'categories' not in catalog:
        return
    def references(index):
        return {index.get('searchURL')} | {g.get('itemsURL') for c in index.get('categories',[]) for g in c.get('groups',[])}
    try:
        previous = json.loads((path.parent/'catalog-index.json').read_text(encoding='utf-8'))
    except (OSError, ValueError): previous = {}
    groups = defaultdict(list)
    search = []
    for item in catalog['items']:
        groups[item['groupID']].append(item)
        search.append({key: item[key] for key in SEARCH_FIELDS if key in item})

    def chunk(name, value):
        relative = f'catalog/{name}.json'
        target = path.parent / relative
        write(target, value)
        return 'data/' + relative

    index = {key: value for key, value in catalog.items() if key != 'items'}
    index['categories'] = deepcopy(catalog['categories'])
    index['partsVersion'] = 1
    index['variantIndexVersion'] = 1
    for category in index['categories']:
        for group in category['groups']:
            items = groups[group['id']]
            group['iconTypeID'] = min((item['id'] for item in items), default=None)
            group['readyCount'] = sum(bool(i.get('available')) for i in items)
            group['itemsURL'] = chunk(f'group-{group["id"]}', {'items': items})
        category['iconTypeID'] = min((g['iconTypeID'] for g in category['groups'] if g['iconTypeID'] is not None), default=None)
    index['iconTypeID'] = min((c['iconTypeID'] for c in index['categories'] if c['iconTypeID'] is not None), default=None)
    index['searchURL'] = chunk('search', {'items': search})
    live, previous_live = references(index), references(previous)
    folder = path.parent / 'catalog'
    # A long-lived chunk may have been written months before an open tab got
    # its URL. Start the cleanup grace period when the chunk leaves the index.
    for url in previous_live - live:
        if not isinstance(url, str) or not url.startswith('data/catalog/'):
            continue
        name = url.removeprefix('data/catalog/')
        if CHUNK.fullmatch(name):
            candidate = folder / name
            try:
                if candidate.is_file() and not candidate.is_symlink():
                    os.utime(candidate, None)
            except FileNotFoundError:
                pass
    # Write the index after its named chunks.
    write(path.parent / 'catalog-index.json', index)
    # Keep the preceding publication and a one-hour grace period for open tabs.
    # Only generated catalogue chunks are collected; model assets are untouched.
    keep = live | previous_live
    cutoff = time.time()-3600
    for candidate in folder.glob('*.json'):
        if not CHUNK.fullmatch(candidate.name): continue
        if 'data/catalog/'+candidate.name in keep or candidate.is_symlink(): continue
        try:
            if candidate.stat().st_mtime < cutoff: candidate.unlink()
        except OSError: pass  # Open readers must not fail publication.
