"""Effective inputs of the fixed two-sided uber effect in the DX11 asset index."""
from source_effect_options import material_resource


def mesh_effect_options(effect, assets, read_options):
    options = read_options(effect)
    if not effect.get('effectFilePath', '').lower().endswith('/ubershadertwosided.fx'):
        return options
    # EffectInfo's Main stages in both bindless settings declare two diffuse
    # textures and MaskMapSampler (CLAMP U/V), and no MaskTransform/MaskScroll.
    # This artifact has no DIFFUSE_MAP_COUNT or MASK_* permutations.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/shadercompiler/python/shadercompiler/effectinfo.py#L301-L370
    row = getattr(assets, 'index', {}).get(material_resource(effect))
    if row and row[2].lower() == '578aa55d2d2d2c7cac199d40d56f9ecd':
        return dict(options, DIFFUSE_MAP_COUNT='TWO', MASK_TEXTURE_SAMPLING='CLAMP', MASK_TRANSFORM='OFF')
    return options
