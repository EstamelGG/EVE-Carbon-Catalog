import json
import os
import shutil
from datetime import datetime, timezone

from sde import ROOT, fetch_catalog


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def main():
    public = ROOT / 'public'
    renderer = ROOT / 'renderer/model-catalog/dist'
    identities = json.loads((public / 'icons/identities.json').read_bytes())
    build, directory = fetch_catalog(identities)
    dist = ROOT / 'dist'
    if dist.resolve() != dist:
        raise ValueError('dist must be inside the checkout')
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(public, dist)
    write_json(dist / 'catalog.json', directory)
    write_json(dist / 'icons/identities.json', identities)
    shutil.copy2(renderer / 'eve-model-viewer.js', dist)
    shutil.copytree(renderer / 'vendor', dist / 'vendor')
    shutil.copy2(renderer / 'third-party-notices.txt', dist / 'renderer-notices.txt')
    config = json.loads((dist / 'site-config.json').read_bytes())
    config['frontendPublishedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    config['sdeBuild'] = build
    for env, field in [('RESOURCE_BASE_URL', 'resourceBaseURL'), ('RENDERER_MODULE_URL', 'rendererModuleURL')]:
        if os.environ.get(env):
            config[field] = os.environ[env]
    write_json(dist / 'site-config.json', config)
    print(f'Built {sum(len(g["items"]) for c in directory for g in c["groups"])} catalog entries from SDE {build}')


if __name__ == '__main__':
    main()
