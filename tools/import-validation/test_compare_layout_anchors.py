#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import copy
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("compare_layout_anchors.py")
SPEC = importlib.util.spec_from_file_location("compare_layout_anchors", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
anchors = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = anchors
SPEC.loader.exec_module(anchors)


def source() -> dict:
    return {
        "policy": {"viewport": {"width": 100, "height": 80}},
        "observedDom": {
            "sourceId": "dom/html-shape-a:0", "tagName": "div",
            "attributes": {}, "computedStyle": {"display": "block"},
            "rect": {"x": 0, "y": 0, "width": 100, "height": 80},
            "children": [{
                "sourceId": "dom/html-shape-a:0/body-shape-b:0/button-data-slot-save:0",
                "tagName": "button", "attributes": {},
                "computedStyle": {"display": "block"},
                "rect": {"x": 10, "y": 12, "width": 30, "height": 20},
                "children": [],
            }],
        },
    }


def native() -> dict:
    return {
        "viewport": {"w": 100, "h": 80},
        "nodes": [
            {"id": "observed-dom:dom/html-shape-a:0", "kind": "View", "visible": True,
             "rect": {"x": 0, "y": 0, "w": 100, "h": 80},
             "clipping": {"rect": {"x": 0, "y": 0, "w": 100, "h": 80}},
             "hit_regions": [{"rect": {"x": 0, "y": 0, "w": 100, "h": 80}}]},
            {"id": "observed-dom:dom/html-shape-a:0/body-shape-b:0/button-data-slot-save:0",
             "kind": "TextButton", "visible": True,
             "rect": {"x": 10, "y": 12, "w": 30, "h": 20},
             "clipping": {"rect": {"x": 0, "y": 0, "w": 100, "h": 80}},
             "hit_regions": [{"rect": {"x": 10, "y": 12, "w": 30, "h": 20}}]},
        ],
    }


class CompareLayoutAnchorsTest(unittest.TestCase):
    def test_identical_source_id_geometry_and_hit_regions_pass(self) -> None:
        report = anchors.compare(source(), native(), 0.0)
        self.assertTrue(report["passed"])
        self.assertEqual(report["summary"]["matchedAnchors"], 2)

    def test_probe_detects_geometry_and_hit_region_regressions(self) -> None:
        candidate = native()
        candidate["nodes"][1]["rect"]["x"] = 16
        candidate["nodes"][1]["hit_regions"] = []
        report = anchors.compare(source(), candidate, 1.0)
        self.assertFalse(report["passed"])
        self.assertEqual(report["summary"]["geometryFailures"], 1)
        self.assertEqual(report["summary"]["hitRegionFailures"], 1)
        self.assertEqual(report["geometryFailures"][0]["deltas"]["x"], 6)

    def test_duplicate_native_ids_are_identity_failures_not_false_geometry(self) -> None:
        candidate = native()
        shifted = copy.deepcopy(candidate["nodes"][1])
        shifted["rect"]["y"] = 70
        shifted["hit_regions"][0]["rect"]["y"] = 70
        candidate["nodes"] = [candidate["nodes"][0], shifted, candidate["nodes"][1]]

        report = anchors.compare(source(), candidate, 0.0)
        self.assertFalse(report["passed"])
        self.assertEqual(report["summary"]["identityFailures"], 1)
        self.assertEqual(report["summary"]["duplicateNativeIds"], 1)
        self.assertEqual(report["summary"]["geometryFailures"], 0)
        self.assertEqual(report["identityFailures"][0]["selectedNativeRect"]["y"], 12)
        self.assertEqual(len(anchors.regions_for_failures(report, 2, .95)), 1)

        candidate["nodes"][1:] = reversed(candidate["nodes"][1:])
        reordered = anchors.compare(source(), candidate, 0.0)
        self.assertEqual(reordered["identityFailures"], report["identityFailures"])
        self.assertEqual(reordered["geometryFailures"], report["geometryFailures"])

    def test_duplicate_source_ids_are_preserved_as_identity_evidence(self) -> None:
        observed = source()
        duplicate = copy.deepcopy(observed["observedDom"]["children"][0])
        duplicate["rect"]["y"] = 60
        observed["observedDom"]["children"].insert(0, duplicate)

        report = anchors.compare(observed, native(), 0.0)
        self.assertFalse(report["passed"])
        self.assertEqual(report["summary"]["duplicateSourceIds"], 1)
        self.assertEqual(report["summary"]["identityFailures"], 1)
        self.assertEqual(report["summary"]["geometryFailures"], 0)
        self.assertEqual(len(report["duplicateSourceDetails"][0]["sourceRects"]), 2)

    def test_hit_region_must_intersect_effective_clip_and_node(self) -> None:
        candidate = native()
        button = candidate["nodes"][1]
        button["hit_regions"] = [{"rect": {"x": 110, "y": 12, "w": 30, "h": 20}}]
        report = anchors.compare(source(), candidate, 0.0)
        self.assertEqual(report["summary"]["hitRegionFailures"], 1)

        button["clipping"]["rect"] = {"x": 0, "y": 0, "w": 100, "h": 25}
        button["hit_regions"] = [{"rect": {"x": 10, "y": 30, "w": 30, "h": 10}}]
        report = anchors.compare(source(), candidate, 0.0)
        self.assertEqual(report["summary"]["hitRegionFailures"], 1)
        self.assertIn("effective clip", report["hitRegionFailures"][0]["reason"])

        button["hit_regions"] = [{"rect": {"x": 10, "y": 20, "w": 30, "h": 10}}]
        report = anchors.compare(source(), candidate, 0.0)
        self.assertEqual(report["summary"]["hitRegionFailures"], 0)

    def test_renderer_folded_text_and_svg_leaves_remain_optional(self) -> None:
        observed = source()
        observed["observedDom"]["children"].extend([
            {
                "sourceId": "folded-text", "tagName": "span", "attributes": {},
                "computedStyle": {"display": "inline"},
                "rect": {"x": 1, "y": 1, "width": 8, "height": 8}, "children": [],
            },
            {
                "sourceId": "folded-svg-leaf", "tagName": "path", "attributes": {},
                "computedStyle": {"display": "inline"},
                "rect": {"x": 2, "y": 2, "width": 6, "height": 6}, "children": [],
            },
        ])
        report = anchors.compare(observed, native(), 0.0)
        self.assertTrue(report["passed"])
        self.assertEqual(report["summary"]["missingAnchors"], 0)

    def test_probe_detects_missing_materialization(self) -> None:
        candidate = native()
        candidate["nodes"].pop()
        report = anchors.compare(source(), candidate, 0.0)
        self.assertEqual(report["summary"]["missingAnchors"], 1)

    def test_viewport_mismatch_is_not_comparable(self) -> None:
        candidate = native()
        candidate["viewport"]["w"] = 99
        with self.assertRaisesRegex(anchors.AnchorError, "viewport mismatch"):
            anchors.compare(source(), candidate, 0.0)

    def test_failure_regions_are_source_derived(self) -> None:
        candidate = native()
        candidate["nodes"][1]["rect"]["x"] = 16
        report = anchors.compare(source(), candidate, 1.0)
        regions = anchors.regions_for_failures(report, padding=2, threshold=.95)
        self.assertEqual(len(regions), 1)
        region = next(iter(regions.values()))
        self.assertAlmostEqual(region["x"], .08)
        self.assertEqual(region["threshold"], .95)


if __name__ == "__main__":
    unittest.main()
