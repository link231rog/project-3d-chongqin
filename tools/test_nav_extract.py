"""Offline tests for tools/nav_extract.py and the legacy render contract.

Run: python3 -m unittest tools/test_nav_extract.py -v
No network, no shapely, no project dependencies.
"""

import copy
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav_extract

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
    'fixtures', 'osm-nav-elements.json')
META = {'origin': [106.5888, 29.5715], 'districtRelation': 4738525,
    'retrieved': '2026-10-18T00:00:00+00:00'}


def fixture():
    with open(FIXTURE, encoding='utf-8') as f:
        return json.load(f)


def way(nav, way_id):
    return next(w for w in nav['ways'] if w['id'] == way_id)


def restriction(nav, rel_id):
    return next(r for r in nav['restrictions'] if r['id'] == rel_id)


class NavExtractTest(unittest.TestCase):
    def setUp(self):
        self.elements = fixture()
        self.nav = nav_extract.build_nav(self.elements, META)

    def test_oneway_minus_one_kept_with_osm_order(self):
        # oneway=-1 means travel 1->2->3 while OSM stores 3,2,1; keep both verbatim.
        tunnel = way(self.nav, 100)
        self.assertEqual(tunnel['tags']['oneway'], '-1')
        self.assertEqual(tunnel['nodes'], ['3', '2', '1'])

    def test_tunnel_kept_in_nav(self):
        tunnel = way(self.nav, 100)
        self.assertEqual(tunnel['tags']['tunnel'], 'yes')
        self.assertEqual(tunnel['tags']['layer'], '-1')

    def test_way_tags_kept_raw(self):
        road = way(self.nav, 101)
        for key in ['lanes', 'width', 'surface', 'maxspeed', 'junction', 'sidewalk']:
            self.assertIn(key, road['tags'])
        self.assertEqual(way(self.nav, 102)['tags']['bridge'], 'yes')
        self.assertEqual(way(self.nav, 102)['tags']['access'], 'destination')

    def test_node_ids_are_strings_way_ids_are_numbers(self):
        self.assertEqual(sorted(self.nav['nodes']), ['1', '2', '3', '4', '5'])
        self.assertTrue(all(isinstance(i, str) for i in self.nav['nodes']))
        self.assertTrue(all(isinstance(w['id'], int) for w in self.nav['ways']))
        self.assertTrue(all(isinstance(n, str) for w in self.nav['ways'] for n in w['nodes']))
        self.assertIn('decimal strings', self.nav['meta']['idEncoding'])

    def test_shared_nodes_stored_once_with_original_coords(self):
        nodes = self.nav['nodes']
        self.assertEqual(way(self.nav, 100)['nodes'], ['3', '2', '1'])
        self.assertEqual(way(self.nav, 101)['nodes'], ['1', '4'])
        self.assertEqual(way(self.nav, 102)['nodes'], ['2', '4', '5'])
        self.assertEqual(nodes['2'], [106.5889, 29.5716])
        self.assertEqual(self.nav['meta']['counts']['nodes'], 5)

    def test_missing_node_reported_not_dropped(self):
        clipped = way(self.nav, 103)
        self.assertEqual(clipped['nodes'], ['1', '9'])
        self.assertEqual(clipped['missingNodes'], ['9'])
        self.assertNotIn('9', self.nav['nodes'])
        self.assertEqual(self.nav['meta']['counts']['incompleteWays'], 1)

    def test_turn_restriction_kept(self):
        found = restriction(self.nav, 900)
        self.assertEqual(found['tags']['restriction'], 'no_left_turn')
        self.assertEqual([(m['type'], m['ref'], m['role']) for m in found['members']],
            [('way', 100, 'from'), ('node', '2', 'via'), ('way', 101, 'to')])
        self.assertEqual(found['missingRefs'], [])
        # non-restriction relations stay out of the nav file
        self.assertNotIn(901, [r['id'] for r in self.nav['restrictions']])

    def test_restriction_variants_kept(self):
        # type=restriction:<mode> is accepted; conditional variants live in tags.
        self.assertEqual(restriction(self.nav, 903)['tags']['restriction:hgv'], 'no_straight_on')
        self.assertIn('restriction:conditional', restriction(self.nav, 904)['tags'])
        self.assertEqual(len(self.nav['restrictions']), 4)

    def test_restriction_missing_refs_reported(self):
        dangling = restriction(self.nav, 902)
        self.assertEqual(dangling['missingRefs'],
            [{'type': 'way', 'ref': 999}, {'type': 'node', 'ref': '8'}])
        self.assertEqual(self.nav['meta']['counts']['restrictionsWithMissingRefs'], 1)

    def test_build_nav_does_not_mutate_input(self):
        before = copy.deepcopy(self.elements)
        nav_extract.build_nav(self.elements, META)
        self.assertEqual(self.elements, before)

    def test_output_is_deterministic(self):
        again = nav_extract.build_nav(list(reversed(self.elements)), META)
        self.assertEqual(json.dumps(again, sort_keys=True), json.dumps(self.nav, sort_keys=True))

    def test_units_do_not_look_projected(self):
        meta = self.nav['meta']
        self.assertNotIn('metersPerUnit', meta)
        self.assertIn('WGS84 lon/lat degrees', meta['coordinateUnits'])
        self.assertIn('scene coordinates only', meta['sceneConversion'])
        self.assertEqual(self.nav['nodes']['1'], [106.5888, 29.5715])

    def test_json_roundtrip_refs_resolve(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'nav.json')
            nav_extract.write_nav(path, self.nav)
            with open(path, encoding='utf-8') as f:
                loaded = json.load(f)
        nodes = loaded['nodes']
        way_ids = {w['id'] for w in loaded['ways']}
        self.assertTrue(all(isinstance(k, str) for k in nodes))
        for w in loaded['ways']:
            self.assertTrue(all(isinstance(n, str) for n in w['nodes']))
            for ref in w['nodes']:
                if ref in w['missingNodes']:
                    self.assertNotIn(ref, nodes)
                else:
                    self.assertIn(ref, nodes)
        for r in loaded['restrictions']:
            dangling = {(m['type'], m['ref']) for m in r['missingRefs']}
            for m in r['members']:
                present = nodes if m['type'] == 'node' else way_ids
                if (m['type'], m['ref']) in dangling:
                    self.assertNotIn(m['ref'], present)
                else:
                    self.assertIn(m['ref'], present)

    def test_write_nav_refuses_to_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'nav.json')
            nav_extract.write_nav(path, self.nav)
            with self.assertRaises(FileExistsError):
                nav_extract.write_nav(path, self.nav)
            nav_extract.write_nav(path, self.nav, force=True)
            with open(path, encoding='utf-8') as f:
                self.assertEqual(json.load(f)['meta']['format'], 'osm-nav-raw/1')


class LegacyRenderContractTest(unittest.TestCase):
    def setUp(self):
        self.elements = fixture()

    def test_record_shape_matches_peninsula_snapshot(self):
        # peninsula.js destructures [, , kind, bridge, points] from each roads entry.
        record = nav_extract.render_road_record(
            next(e for e in self.elements if e.get('id') == 101),
            [(1.2345, -2.3456), (3.0, -4.0)])
        self.assertEqual(record, [101, '', 'secondary', '', [[1.23, -2.35], [3.0, -4.0]]])
        self.assertEqual(len(record), 5)

    def test_record_has_no_nav_fields_or_filtering(self):
        # Render filtering (tunnel, construction, area) stays in the collector; the
        # record builder only formats, so old output is unchanged by nav support.
        tunnel = next(e for e in self.elements if e.get('id') == 100)
        record = nav_extract.render_road_record(tunnel, [(0.0, 0.0)])
        self.assertEqual(record, [100, '测试隧道', 'primary', '', [[0.0, 0.0]]])
        self.assertIsInstance(record, list)
        self.assertNotIsInstance(record[4][0], dict)


if __name__ == '__main__':
    unittest.main()
