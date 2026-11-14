"""SOF locator transforms, composed in source metres and single precision."""
from ctypes import c_float


def next_subsystem_offset(locator_sets):
    # CCP Trinity (MIT), EveSOFDataMgr::LoadLocatorData and EveSOFDNA::GetHullNextSubsystemOffset.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/Eve/SpaceObjectFactory/EveSOFDNA.cpp#L807-L816
    for entry in locator_sets:
        if entry.get('name') == 'next_subsystem' and entry.get('locators'):
            return entry['locators'][0].get('position', [0., 0., 0.])
        if entry.get('locatorSets'):
            offset = next_subsystem_offset(entry['locatorSets'])
            if offset is not None:
                return offset
    return None


def placed_hulls(hulls):
    offset = [0., 0., 0.]
    for hull in hulls:
        yield hull, offset
        connector = next_subsystem_offset(hull.get('locatorSets', []))
        if connector is not None:
            offset = [c_float(a + b).value for a, b in zip(offset, connector)]


def translated_matrix(item, offset):
    # CCP Trinity (MIT), TriMatrixTranslate adds to the translation row only.
    # https://github.com/carbonengine/trinity/blob/f644516ae4f921f6f3a3e58dc5d19107781571ec/trinity/TriMath.cpp#L613-L619
    matrix = list(item.get('transform', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
    matrix[12:15] = [c_float(v + d).value for v, d in zip(matrix[12:15], offset)]
    return matrix
