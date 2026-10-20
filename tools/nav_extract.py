"""Raw OSM road-graph export for a future router (stdlib only).

peninsula-snapshot.json is lossy on purpose: projected/rounded/simplified points,
tunnels dropped, node ids gone. This module records what OSM returned so routing
work can start from real data. It builds no graph, repairs no connectivity and
computes no route.
"""

import json
import os

FORMAT = 'osm-nav-raw/1'


def _elements(elements):
    return elements.values() if isinstance(elements, dict) else elements


def _is_restriction(tags):
    # Conditional/mode variants ride on type=restriction as restriction:* tags; the
    # prefix match is defensive for rare type=restriction:<mode> relations.
    kind = tags.get('type') or ''
    return kind == 'restriction' or kind.startswith('restriction:')


def build_nav(elements, meta=None):
    """Collect highway ways, their node coordinates and turn restrictions.

    Ways keep OSM order and full tags (oneway incl. -1, lanes, width, surface,
    maxspeed, layer, bridge, tunnel, access, junction, sidewalk). Nodes keep
    original WGS84 lon/lat. Missing refs are reported, never dropped.

    JSON contract: node ids are decimal strings everywhere (nodes keys, way.nodes,
    missingNodes, restriction node refs) so refs resolve directly after json.load.
    Way and relation ids stay JSON numbers.
    """
    node_coords = {}
    for e in _elements(elements):
        if e.get('type') == 'node':
            node_coords[e['id']] = [e['lon'], e['lat']]

    ways, restrictions, used = [], [], set()
    for e in _elements(elements):
        tags = e.get('tags') or {}
        if e.get('type') == 'way' and tags.get('highway'):
            refs = list(e.get('nodes') or [])
            used.update(refs)
            ways.append({'id': e['id'], 'nodes': [str(n) for n in refs], 'tags': dict(tags)})
        elif e.get('type') == 'relation' and _is_restriction(tags):
            raw_members = e.get('members') or []
            used.update(m['ref'] for m in raw_members if m['type'] == 'node')
            members = [{'type': m['type'], 'ref': str(m['ref']) if m['type'] == 'node' else m['ref'],
                'role': m.get('role', '')} for m in raw_members]
            restrictions.append({'id': e['id'], 'tags': dict(tags), 'members': members})

    ways.sort(key=lambda w: w['id'])
    restrictions.sort(key=lambda r: r['id'])
    nodes = {str(i): node_coords[i] for i in sorted(used) if i in node_coords}
    way_ids = {w['id'] for w in ways}
    for way in ways:
        way['missingNodes'] = [n for n in way['nodes'] if n not in nodes]
    for restriction in restrictions:
        restriction['missingRefs'] = [{'type': m['type'], 'ref': m['ref']}
            for m in restriction['members']
            if (m['type'] == 'way' and m['ref'] not in way_ids)
            or (m['type'] == 'node' and m['ref'] not in nodes)]

    nav_meta = {
        'format': FORMAT,
        'coordinateUnits': 'WGS84 lon/lat degrees, unprojected and unrounded',
        'sceneConversion': 'x=(lon-106.5888)*96800/12, z=-(lat-29.5715)*111320/12; '
            'the 12 m scene unit applies to scene coordinates only, never to this file',
        'idEncoding': 'node ids are decimal strings everywhere; way and relation ids are JSON numbers',
        'source': 'https://www.openstreetmap.org/copyright',
        'tunnelPolicy': 'tunnels kept; this file is not the render road list',
        'routing': 'raw only: no connectivity repair, turn costs or simplification',
        'extent': 'the 8 bbox tiles; not clipped to the district polygon, so cross-river ways are included',
    }
    nav_meta.update(meta or {})
    nav_meta['counts'] = {'ways': len(ways), 'nodes': len(nodes),
        'restrictions': len(restrictions),
        'incompleteWays': sum(1 for w in ways if w['missingNodes']),
        'restrictionsWithMissingRefs': sum(1 for r in restrictions if r['missingRefs'])}
    return {'meta': nav_meta, 'nodes': nodes, 'ways': ways, 'restrictions': restrictions}


def write_nav(path, nav, force=False):
    """Write nav JSON. Refuses to replace an existing file unless force=True."""
    if os.path.exists(path) and not force:
        raise FileExistsError(path + ' exists; pass --nav-force to replace it')
    with open(path, 'w' if force else 'x', encoding='utf-8') as f:
        json.dump(nav, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    return path


def render_road_record(way, points):
    """Legacy render contract, unchanged: [id, name, highway, bridge, points].

    Filtering (tunnel, construction, area) stays in the caller, so this stays
    byte-identical to what peninsula.js destructures.
    """
    tags = way.get('tags', {})
    return [way['id'], tags.get('name', ''), tags['highway'], tags.get('bridge', ''),
        [[round(x, 2), round(z, 2)] for x, z in points]]
