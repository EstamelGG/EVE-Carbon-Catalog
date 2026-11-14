"""Catalog/build exclusions shared by inventory and generated-asset cleanup."""
def is_wreck(item):
    # Catalog removal is limited to the SDE Celestial / Wreck group.
    # Path-based build exclusions below must not remove catalog entries.
    return item.get('groupID') == 186


def wreck_gr2_reason(record):
    """Exclude assemblies referencing wreck directories or listed generic wrecks."""
    for path in record.get('paths', []):
        normalized = path.strip().replace('\\', '/').lower()
        if normalized.endswith('.gr2') and '/wreck/' in normalized:
            return '不参与构建：GR2 资源路径包含 /wreck/（%s）' % path
        if normalized in ['res:/dx9/model/ship/generic/wreck_l.gr2', 'res:/dx9/model/ship/generic/wreck_s.gr2', 'res:/dx9/model/ship/generic/wreck_m.gr2']:
            return '不参与构建：通用残骸 GR2（%s）' % path
    # Retain the decision even when an unavailable path is removed by indexing.
    return record.get('buildExclusionReason', '')


def prune_wreck_items(data):
    """Update an existing catalog and its category counts in place."""
    removed = [item for item in data['items'] if is_wreck(item)]
    ids = {item['id'] for item in removed}
    data['items'] = [item for item in data['items'] if item['id'] not in ids]
    counts = {}
    for item in data['items']:
        counts[item['groupID']] = counts.get(item['groupID'], 0) + 1
    for category in data['categories']:
        category['groups'] = [dict(group, count=counts[group['id']])
                              for group in category['groups'] if counts.get(group['id'])]
        category['count'] = sum(group['count'] for group in category['groups'])
    data['categories'] = [category for category in data['categories'] if category['count']]
    data['readyCount'] = sum(bool(item.get('available')) for item in data['items'])
    if 'sampleIDs' in data:
        data['sampleIDs'] = [tid for tid in data['sampleIDs'] if tid not in ids]
    return removed
