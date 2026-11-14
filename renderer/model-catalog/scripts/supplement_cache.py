"""Semantic supplement receipts: change only the affected shader version.

Bump CAPTURE_VERSION for changes to captured values, BASE_VERSION for shared
packing changes, or a shader version for changes confined to that material.
Whitespace, logging and viewer-only changes must not invalidate assets.
"""
import hashlib
import json

CAPTURE_VERSION = 3
BASE_VERSION = 3
SHADERS = {'texture-color': 1, 'uber-cube': 1, 'uber-two-sided': 2, 'kill-counter': 3, 'glow': 1}
LEGACY_CAPTURE = 'a577b13490cd783ca718d1f800e09efd68023cbb6c92c39045211cf1b307e2ed'
# Exact known implementations before semantic receipts (not arbitrary files).
LEGACY_PACKERS = (
    ('d5b8eb3a9bbadc13009f1e89cdb1e2c95628313bf4cff34e4a64ce452116dbae',
     '57a514a20bd07d615afda5b140aec196aa779f51796fda70deb5c857034288c9'),
    ('93eff8101f2eebe278ce5f064b0e1c5b5556dae67484d5af3b9e73c2871c0fb4',
     'b3b370636ac2dcbe647847309daa58f1bc3bfbeffce4d89c1137f04decd09faf'),
)

def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()).hexdigest()

def versions(data):
    result = {'base': BASE_VERSION}
    for mesh in data.get('meshes', []):
        if mesh.get('twoSided'): result['uber-two-sided'] = SHADERS['uber-two-sided']
        kind = mesh.get('material')
        if kind in SHADERS: result[kind] = SHADERS[kind]
    if any(d.get('material') == 'kill-counter' for d in data.get('decals', [])):
        result['kill-counter'] = SHADERS['kill-counter']
    if any(not d.get('material') for d in data.get('decals', [])):
        result['paint-parent-normal'] = 1
    if any(d.get('material') == 'glow' for d in data.get('decals', [])):
        result['glow'] = SHADERS['glow']
    for item in data.get('unsupported', []):
        if (item.get('reason') == 'missing-uber-inputs'
                or (item.get('shader'), item.get('reason')) in {
                    ('texturecolor.fx', 'opaqueAreas'), ('ubershadercube.fx', 'additiveAreas')}):
            result['child-texture-inputs'] = 1
        if item.get('shader') == 'decalv5.fx' and item.get('reason') == 'decal-shader-or-bone':
            result['joint-paint'] = 1
        if item.get('shader') == 'decalglowv5.fx':
            result['glow'] = SHADERS['glow']
        if item.get('shader') == 'decalcounterv5.fx':
            result['kill-counter'] = SHADERS['kill-counter']
        if item.get('shader') == 'ubershadertwosided.fx':
            result['uber-two-sided'] = SHADERS['uber-two-sided']
        if item.get('shader') == 'texturecolor.fx' and item.get('reason') == 'opaqueAreas':
            result['texture-color'] = SHADERS['texture-color']
        if item.get('shader') == 'ubershadercube.fx' and item.get('reason') == 'additiveAreas':
            result['uber-cube'] = SHADERS['uber-cube']
    return result

def capture_revision(source_index):
    return identity(dict(source_index=source_index, capture_version=CAPTURE_VERSION))

def capture_current(stamp, source_index):
    return stamp == capture_revision(source_index) or (CAPTURE_VERSION == 1 and
        stamp == identity(dict(source_index=source_index, script=LEGACY_CAPTURE)))

def receipt(data, source_index, dna):
    return dict(sourceRevision=identity(dict(source_index=source_index, dna=dna,
                     capture=capture_revision(source_index))), recipeVersions=versions(data))

def reusable(data, source_index, dna, stamp):
    if not capture_current(stamp, source_index): return False
    # Old packers omitted the shader name when rejecting counter masks for a
    # nonexistent albedo map, so their receipts cannot identify the fix.
    if any(i.get('reason') == 'missing-decal-inputs' and not i.get('shader')
           for i in data.get('unsupported', [])): return False
    expected = receipt(data, source_index, dna)
    if all(data.get(k) == v for k, v in expected.items()): return True
    # Adopt known old outputs only if no newly supported source layer is missing.
    present = {m.get('material') for m in data.get('meshes', []) + data.get('decals', [])}
    if set(expected['recipeVersions']) - {'base'} - present: return False
    if CAPTURE_VERSION != 1 or any(v != 1 for v in expected['recipeVersions'].values()): return False
    for packer, runner in LEGACY_PACKERS:
        implementation = identity(dict(source_index=source_index, scripts={
            'capture_supplements.py': LEGACY_CAPTURE,
            'effect_supplements.py': packer, 'supplement_assets.py': runner}))
        if data.get('revision') == identity(dict(implementation=implementation, dna=dna)):
            return True
    return False
