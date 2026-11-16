import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from html import escape

from sde import ROOT, fetch_catalog


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def render_branding(destination):
    config = json.loads((ROOT / 'app-config.json').read_bytes())
    name, version = config['appName'], config['appVersion']
    labels = {'appName': name, 'appVersion': version, 'appNameUpper': name.upper()}
    public = ROOT / 'public'
    for filename in ('index.html', 'viewer-guide.html'):
        template = (public / filename).read_text(encoding='utf-8')
        html = re.sub(r'\{\{(appName|appVersion|appNameUpper)\}\}',
                      lambda match: escape(labels[match[1]]), template)
        (destination / filename).write_text(html, encoding='utf-8')
    template = (public / 'messages.mjs').read_text(encoding='utf-8')
    messages = template.replace('"{{appTitle}}"', json.dumps(f'{name} {version}'))
    (destination / 'messages.mjs').write_text(messages, encoding='utf-8')


def generate_catalog(destination):
    public = ROOT / 'public'
    identities = json.loads((public / 'icons/identities.json').read_bytes())
    build, directory = fetch_catalog(identities)
    write_json(destination / 'catalog.json', directory)
    write_json(destination / 'icons/identities.json', identities)
    config = json.loads((destination / 'site-config.json').read_bytes())
    config['sdeBuild'] = build
    write_json(destination / 'site-config.json', config)
    print(f'Built {sum(len(g["items"]) for c in directory for g in c["groups"])} catalog entries from SDE {build}')


def main():
    public = ROOT / 'public'
    renderer = ROOT / 'renderer/model-catalog/dist'
    dist = ROOT / 'dist'
    if dist.resolve() != dist:
        raise ValueError('dist must be inside the checkout')
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(public, dist)
    render_branding(dist)
    if not os.environ.get('CF_PAGES'):
        generate_catalog(dist)
    shutil.copy2(renderer / 'eve-model-viewer.js', dist)
    shutil.copytree(renderer / 'vendor', dist / 'vendor')
    shutil.copy2(renderer / 'third-party-notices.txt', dist / 'renderer-notices.txt')
    config = json.loads((dist / 'site-config.json').read_bytes())
    config['frontendPublishedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    for env, field in [('RESOURCE_BASE_URL', 'resourceBaseURL'), ('RENDERER_MODULE_URL', 'rendererModuleURL')]:
        if os.environ.get(env):
            config[field] = os.environ[env]
    write_json(dist / 'site-config.json', config)


if __name__ == '__main__':
    if sys.argv[1:] == ['--cloudflare']:
        generate_catalog(ROOT / 'public')
        # Some Pages commands stage the static files before compiling the renderer.
        staged = ROOT / 'dist'
        if (staged / 'catalog.json').is_file():
            render_branding(staged)
            for name in ('catalog.json', 'icons/identities.json'):
                shutil.copy2(ROOT / 'public' / name, staged / name)
    else:
        main()
