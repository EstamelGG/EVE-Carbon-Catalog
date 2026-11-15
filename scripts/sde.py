import json
from collections import defaultdict
from pathlib import Path
from shutil import copyfileobj
from tempfile import TemporaryFile
from urllib.request import urlopen
from zipfile import ZipFile


BASE = 'https://developers.eveonline.com/static-data/tranquility/'
ROOT = Path(__file__).resolve().parents[1]


def version(stream):
    for line in stream:
        row = json.loads(line)
        if row.get('_key') == 'sde' and type(row.get('buildNumber')) is int and row['buildNumber'] > 0:
            return row['buildNumber']
    raise ValueError('Missing SDE buildNumber')


def latest():
    with urlopen(BASE + 'latest.jsonl', timeout=45) as response:
        return version(response)


def records(archive, table):
    with archive.open(table + '.jsonl') as stream:
        for line in stream:
            yield json.loads(line)


def label(row):
    names = row['name']
    return {lang: names.get(lang) or names.get('en') or str(row['_key']) for lang in ('en', 'zh')}


def catalog(archive, identities):
    groups = {g['_key']: g for g in records(archive, 'groups')}
    categories = {c['_key']: c for c in records(archive, 'categories')}
    graphics = {g['_key'] for g in records(archive, 'graphics') if g.get('sofHullName') or g.get('graphicFile')}
    items = defaultdict(list)
    identities['typeFactions'] = {}
    identities['typeMetaGroups'] = {}
    for row in records(archive, 'types'):
        group = groups[row['groupID']]
        # Match Builder's SDE scan, including unpublished NPC and event models.
        if group['categoryID'] == 9 or row['groupID'] == 186 or row.get('graphicID') not in graphics:
            continue
        tid = row['_key']
        items[row['groupID']].append(dict(id=tid, name=label(row)))
        for field, mapping in [('factionID', 'typeFactions'), ('metaGroupID', 'typeMetaGroups')]:
            if row.get(field):
                identities[mapping][tid] = row[field]
    if not items:
        raise ValueError('SDE contains no model candidates')
    children = defaultdict(list)
    for gid, rows in items.items():
        group = groups[gid]
        children[group['categoryID']].append(dict(id=gid, name=label(group), items=sorted(rows, key=lambda r: r['id'])))
    directory = [dict(id=cid, name=label(categories[cid]), groups=sorted(entries, key=lambda g: g['name']['en']))
                 for cid, entries in children.items()]
    return sorted(directory, key=lambda c: (c['id'] != 6, c['name']['en']))


def fetch_catalog(identities):
    build = latest()
    print(f'Downloading Tranquility SDE {build}', flush=True)
    with TemporaryFile() as tmp:
        with urlopen(BASE + f'eve-online-static-data-{build}-jsonl.zip', timeout=120) as response:
            copyfileobj(response, tmp)
        with ZipFile(tmp) as archive:
            with archive.open('_sde.jsonl') as metadata:
                if version(metadata) != build:
                    raise ValueError('Downloaded archive does not match the requested SDE build')
            return build, catalog(archive, identities)


if __name__ == '__main__':
    marker = ROOT / 'sde-version.txt'
    build = latest()
    if build > int(marker.read_text()):
        marker.write_text(f'{build}\n', encoding='ascii')
    print(f'Latest Tranquility SDE: {build}')
