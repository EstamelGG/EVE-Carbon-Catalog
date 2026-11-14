"""Complete the web preview's material inputs when SOF leaves a slot unspecified.

These are project appearance defaults. White leaves color and reflection untinted,
0.4 gloss is a visual calibration against the preview, and the remaining gloss
components are unused. UV defaults have unit scale and zero offset. Authored SOF
values, including HDR colors, always take precedence.
"""
import re


PALETTE_SURFACES = {
    'quadv5', 'quadheatv5', 'quaddetailv5', 'quadheatdetailv5', 'quadenvironmentv5',
    'quadsailsv5', 'quadglassv5', 'quadinstancedv5', 'quadoilv5', 'quadwreckv5',
    'asteroidv5', 'rockv5',
}


def surface_family(effect):
    name = effect.lower().rsplit('/', 1)[-1].removesuffix('.fx')
    return re.sub(r'^(?:unpackedskinned_|unpacked_|skinned_|static_)', '', name)


def runtime_material_parameters(effect, authored):
    family = surface_family(effect)
    params = dict(authored)
    white = (1., 1., 1., 1.)
    defaults = {}
    if family in ('quaddetailv5', 'quadheatdetailv5'):
        for index in range(1, 4):
            defaults['Detail%dData' % index] = (1., 1., 0., 0.)
        defaults.update(DetailSelector=white, DetailAlbedoColor=white, DetailFresnelColor=white)
        if family == 'quadheatdetailv5':
            defaults['SecondaryDetail2Data'] = (1., 1., 0., 0.)
    if family == 'quadenvironmentv5':
        defaults.update(GeneralTiling=white, DetailData=white)
        for index in (1, 2):
            # An omitted environment selector applies no extra layer.
            defaults['Detail%dMaterial' % index] = (0., 0., 0., 0.)
            defaults['Detail%dAlbedoColor' % index] = white
            defaults['Detail%dFresnelColor' % index] = white
    for index in range(1, 5):
        for suffix in ('DiffuseColor', 'FresnelColor', 'Gloss', 'DustDiffuseColor'):
            name = 'Mtl%d%s' % (index, suffix)
            if family in PALETTE_SURFACES:
                defaults[name] = (.4, 1., 1., 1.) if suffix == 'Gloss' else white
            elif name not in params and suffix != 'DustDiffuseColor':
                raise ValueError('Missing runtime material parameter: ' + name)
    for name, value in defaults.items():
        if name not in params:
            params[name] = list(value)
    return params
