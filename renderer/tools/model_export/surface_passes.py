"""Separate supported hull overlays from the primary material slot mapping."""
import re

OVERLAY_PROFILE = 'fxdirectional-v1'
OVERLAY_TEXTURES = ('Layer1Map', 'Layer2Map', 'LayerMaskMap')
OVERLAY_PARAMETERS = ('BaseColor', 'FresnelFactors', 'DirectionU', 'DirectionV',
                      'Layer1Transform', 'Layer2Transform', 'Layer1Scroll', 'Layer2Scroll')


def slots(area):
    start = area.get('sourceIndex', area['index'])
    return set(range(start, start + area['count']))


def overlay_profile(area):
    if area.get('opaqueLayer'):
        return 'quad-layer-v1'
    if area['kind'] not in ('additiveAreas', 'transparentAreas'):
        return None
    shader = area['effect'].lower().rsplit('/', 1)[-1].removeprefix('skinned_')
    if shader == 'fxdirectionalv5.fx':
        return OVERLAY_PROFILE
    if shader == 'fxv5.fx':
        return 'fx-uv-v1'
    return None


def check_overlay_inputs(area, profile):
    if not set(OVERLAY_TEXTURES) <= area['textures'].keys():
        raise ValueError('Hull overlay lacks texture inputs')
    required = set(OVERLAY_PARAMETERS)
    if profile == 'fx-uv-v1':
        required -= {'DirectionU', 'DirectionV'}
    if not required <= area['parameters'].keys():
        raise ValueError('Hull overlay lacks material parameters')


def split_surface_passes(areas):
    surfaces, overlays = [], []
    for area in areas:
        if area['kind'] in ('depthAreas', 'decalAreas'): continue
        profile = overlay_profile(area)
        if profile:
            check_overlay_inputs(area, profile)
            overlays.append(area)
        else:
            surfaces.append(area)
    covered = set()
    primary = []
    next_index = max((a['index'] + a['count'] for a in areas), default=0)
    for area in surfaces:
        overlap = covered & slots(area)
        if overlap:
            quad = lambda a: a['kind'] == 'opaqueAreas' and bool(re.search(r'/(?:skinned_)?quad(?:heat)?(?:detail)?v5\.fx$', a['effect'], re.I))
            if not quad(area) or not all(quad(a) for a in primary if slots(a) & overlap):
                raise ValueError('Unsupported overlapping surface passes: ' + area['effect'])
            # Preserve the actual draw order and both opaque materials. Split
            # the underlying ranges so duplicate glTF primitives target only
            # the overlapping slots, never their neighbouring hull sections.
            primary = [dict(a,index=s,count=1) for a in primary for s in sorted(slots(a))]
            for slot in sorted(slots(area)):
                if slot in covered:
                    overlays.append(dict(area,index=next_index,sourceIndex=slot,count=1,opaqueLayer=True))
                    next_index += 1
                else: primary.append(dict(area,index=slot,count=1))
        else: primary.append(area)
        covered.update(slots(area))
    surfaces = primary
    for overlay in overlays:
        if overlay_profile(overlay) == 'fx-uv-v1':
            # Independent additive geometry has no underlying opaque material.
            # Export a hidden carrier so the viewer can skin and draw each pass.
            for slot in sorted(slots(overlay) - covered):
                surfaces.append(dict(overlay, index=slot, count=1, effectOnly=True,
                    textures={**overlay['textures'], 'AlbedoMap': overlay['textures']['Layer1Map'],
                              'NormalMap': overlay['textures']['Layer1Map']}))
                covered.add(slot)
        if not slots(overlay) <= covered:
            raise ValueError('Directional overlay requires a complete underlying hull surface')
        for surface in surfaces:
            if slots(overlay) & slots(surface) and not slots(surface) <= slots(overlay):
                raise ValueError('Partial material-slot overlays require primitive splitting')
    return surfaces, overlays


def material_texture_urls(native):
    yield from native.get('textures', {}).values()
    for overlay in native.get('overlays', []):
        yield from overlay['textures'].values()
