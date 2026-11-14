"""Construct root hull attachments from the BLACK files selected by SOF DNA."""
from sof_planes import plane_sets
from sof_sprites import sprite_sets
from sof_spotlights import spotlight_sets


SOF_BUILD_CLASSES = ('ship', 'mobile', 'stationary', 'swarm', 'extension')


def hull_build_class(hull, override):
    if override in SOF_BUILD_CLASSES:
        return SOF_BUILD_CLASSES.index(override)
    return hull.get('buildClass', 0)


def attachment_definitions(resources, dna):
    hull_names, faction_name, _race, *options = dna.lower().split(':')
    commands = dict(token.split('?', 1) for token in options if '?' in token)
    hulls = [resources.named('hulls', name, 'Hull') for name in hull_names.split(';')]
    # Variant hull records omit attachments. Extensions place theirs on a child.
    build_class = hull_build_class(hulls[0], commands.get('class'))
    if 'variant' in commands or build_class == 4:
        return [], {}, set(), False
    faction = resources.named('factions', faction_name, 'Faction')
    visible = set((faction.get('visibilityGroupSet') or {}).get('visibilityGroups', []))
    modern = hulls[0].get('sof6', False)
    return hulls, faction, visible, modern


def root_attachment_inputs(definitions):
    return dict(attachments=sprite_sets(*definitions), sofSpotlights=spotlight_sets(*definitions),
                sofPlanes=plane_sets(*definitions))
