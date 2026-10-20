import argparse
import base64
import concurrent.futures
import datetime
import json
import urllib.request
import zlib

from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union

from nav_extract import build_nav, render_road_record, write_nav

ORIGIN = [106.5888, 29.5715]

def parse_args():
    parser = argparse.ArgumentParser(description='Collect the Yuzhong peninsula OSM snapshot.')
    parser.add_argument('--nav-out', metavar='PATH',
        help='also write raw road-graph JSON (ordered node ids, node lon/lat, way tags, '
            'turn restrictions; tunnels kept) to PATH')
    parser.add_argument('--nav-force', action='store_true',
        help='allow --nav-out to replace an existing file')
    return parser.parse_args()

args = parse_args()

def fetch(path):
    request = urllib.request.Request('https://www.openstreetmap.org/api/0.6/' + path,
        headers={'User-Agent': 'Yuzhong3DResearch/1.0'})
    with urllib.request.urlopen(request, timeout=50) as response:
        return json.load(response)['elements']

def project(lon, lat):
    return [(lon - ORIGIN[0]) * 96800 / 12, -(lat - ORIGIN[1]) * 111320 / 12]

def rings(relation, elements):
    nodes = {e['id']: e for e in elements if e['type'] == 'node'}
    ways = {e['id']: e for e in elements if e['type'] == 'way'}
    result = {'outer': [], 'inner': []}
    for role in result:
        chains = [ways[m['ref']]['nodes'][:] for m in relation['members']
            if m['type'] == 'way' and m.get('role', 'outer') == role and m['ref'] in ways]
        while chains:
            chain = chains.pop()
            while chain[0] != chain[-1]:
                found = False
                for i, other in enumerate(chains):
                    if chain[-1] == other[0]: chain += other[1:]
                    elif chain[-1] == other[-1]: chain += other[-2::-1]
                    elif chain[0] == other[-1]: chain = other[:-1] + chain
                    elif chain[0] == other[0]: chain = other[:0:-1] + chain
                    else: continue
                    chains.pop(i)
                    found = True
                    break
                if not found: break
            if len(chain) > 3 and chain[0] == chain[-1] and all(n in nodes for n in chain):
                result[role].append([project(nodes[n]['lon'], nodes[n]['lat']) for n in chain])
    return result

def relation_polygon(elements, relation_id):
    relation = next(e for e in elements if e['type'] == 'relation' and e['id'] == relation_id)
    r = rings(relation, elements)
    shape = unary_union([Polygon(ring).buffer(0) for ring in r['outer']])
    if r['inner']: shape = shape.difference(unary_union([Polygon(ring).buffer(0) for ring in r['inner']]))
    return shape

xs = [106.476, 106.505, 106.534, 106.563, 106.594]
ys = [29.532, 29.555, 29.581]
paths = ['map.json?bbox=' + ','.join(map(str, (xs[i], ys[j], xs[i+1], ys[j+1])))
    for i in range(4) for j in range(2)]
elements = {}
failed = []
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures = {pool.submit(fetch, path): path for path in paths}
    for future in concurrent.futures.as_completed(futures):
        try:
            for e in future.result(): elements[(e['type'], e['id'])] = e
        except Exception as error: failed.append([futures[future], str(error)])

district_elements = fetch('relation/4738525/full.json')
district = relation_polygon(district_elements, 4738525)
water_ids = [e['id'] for e in elements.values() if e['type'] == 'relation'
    and e.get('tags', {}).get('natural') == 'water' and e.get('tags', {}).get('water') == 'river']
water_shapes = []
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures = {pool.submit(fetch, f'relation/{rid}/full.json'): rid for rid in water_ids}
    for future in concurrent.futures.as_completed(futures):
        rid = futures[future]
        try:
            data = future.result()
            water_shapes.append(relation_polygon(data, rid))
        except Exception as error: failed.append([f'water/{rid}', str(error)])
if failed:
    raise RuntimeError('Source coverage incomplete: ' + json.dumps(failed, ensure_ascii=False))
land = district.difference(unary_union(water_shapes)).buffer(0)
land = max(land.geoms, key=lambda p: p.area) if land.geom_type == 'MultiPolygon' else land
land = land.simplify(0.5, preserve_topology=True)

nodes = {e['id']: e for e in elements.values() if e['type'] == 'node'}
buildings = []
roads = []
landmarks = []
for e in nodes.values():
    t = e.get('tags', {})
    if t.get('historic') in ['memorial', 'monument'] or t.get('aerialway') or t.get('name') in ['解放碑', '鹅岭公园', '鹅岭']:
        landmarks.append([e['id'], t.get('name',''), [[round(v,2) for v in project(e['lon'],e['lat'])]]])
for e in elements.values():
    t = e.get('tags', {})
    if e['type'] != 'way': continue
    if any(n not in nodes for n in e.get('nodes', [])): continue
    points = [project(nodes[n]['lon'], nodes[n]['lat']) for n in e.get('nodes', [])]
    if len(points) < 2: continue
    center = LineString(points).centroid
    if not district.buffer(30).contains(center): continue
    if t.get('building') and len(points) > 3 and e['nodes'][0] == e['nodes'][-1]:
        polygon = Polygon(points).buffer(0)
        if polygon.is_empty or not land.buffer(1).contains(polygon.representative_point()): continue
        if polygon.geom_type != 'Polygon': continue
        polygon = polygon.simplify(0.08, preserve_topology=True)
        height = t.get('height')
        levels = t.get('building:levels')
        try: height = float(str(height).replace('m', '').strip()) if height else None
        except ValueError: height = None
        try: levels = float(levels) if levels else None
        except ValueError: levels = None
        buildings.append([e['id'], t.get('name', ''), height, levels,
            [[round(x, 2), round(z, 2)] for x,z in polygon.exterior.coords], t.get('building')])
    elif t.get('highway') and t.get('tunnel') != 'yes':
        if t['highway'] in ['construction', 'proposed']: continue
        line = LineString(points).simplify(0.15)
        roads.append(render_road_record(e, line.coords))
    if t.get('aerialway') == 'cable_car' or t.get('tourism') in ['attraction', 'museum'] or t.get('historic') == 'memorial':
        landmarks.append([e['id'], t.get('name',''), [[round(x,2),round(z,2)] for x,z in points]])

data = {'meta': {'origin': ORIGIN, 'metersPerUnit': 12, 'projection': 'local equirectangular east-x north-minus-z',
    'retrieved': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'source': 'https://www.openstreetmap.org/copyright', 'districtRelation': 4738525,
    'waterRelations': water_ids, 'failedRequests': failed,
    'terrain': 'Elevation is loaded separately from peninsula-elevation.json; not a contemporary ground survey',
    'heightRule': 'OSM height; otherwise levels times 3.2m; otherwise estimated 18m'},
    'land': [[round(x,2),round(z,2)] for x,z in land.exterior.coords],
    'buildings': buildings, 'roads': roads, 'landmarks': landmarks}

if args.nav_out:
    nav = build_nav(elements, {'origin': ORIGIN, 'districtRelation': 4738525,
        'retrieved': data['meta']['retrieved'], 'failedRequests': failed})
    write_nav(args.nav_out, nav, args.nav_force)
    print('NAV:' + json.dumps({'path': args.nav_out, **nav['meta']['counts']}, ensure_ascii=False))

encoded = base64.b64encode(zlib.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode())).decode()
print('SUMMARY:' + json.dumps({'buildings':len(buildings),'roads':len(roads),'landPoints':len(data['land']),
    'landAreaSqKm':round(land.area*144/1e6,3),'waterRelations':water_ids,'failed':failed,
    'compressedLength':len(encoded),'knownHeights':sum(b[2] is not None for b in buildings),
    'knownLevels':sum(b[3] is not None for b in buildings)},ensure_ascii=False))
print('PAYLOAD:' + encoded)
