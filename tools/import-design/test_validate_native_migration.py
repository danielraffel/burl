#!/usr/bin/env python3

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_native_migration import validate, validate_catalog_references

ROOT = Path(__file__).resolve().parents[2]
CAPS = json.loads((ROOT / "compat/yoga-native-migration-v1.json").read_text())
YOGA = json.loads((ROOT / "compat/yoga.json").read_text())
FIXTURES = ROOT / "test/fixtures/native-migration"


class NativeMigrationCapabilityTest(unittest.TestCase):
    def fixture(self, name: str) -> dict:
        return json.loads((FIXTURES / name).read_text())

    def test_supported_held_out_probe_passes(self) -> None:
        self.assertEqual(validate_catalog_references(CAPS, YOGA), [])
        self.assertEqual(validate(CAPS, self.fixture("responsive-sidebar-chat-v1.json")), [])

    def test_reachable_unsupported_semantic_fails(self) -> None:
        errors = validate(CAPS, self.fixture("unsupported-container-query-v1.json"))
        self.assertIn("reachable semantic is unsupported: css/container-query", errors)

    def test_missing_row_fails_closed(self) -> None:
        fixture = self.fixture("responsive-sidebar-chat-v1.json")
        fixture["reachableSemantics"].append("css/unknown-future-value")
        self.assertTrue(any("no capability row" in e for e in validate(CAPS, fixture)))

    def test_quantitative_and_behavioral_regressions_fail(self) -> None:
        fixture = copy.deepcopy(self.fixture("responsive-sidebar-chat-v1.json"))
        fixture["samples"][0]["maxGeometryDeltaPx"] = 0.75
        fixture["invariantResults"]["focus-order"] = False
        errors = validate(CAPS, fixture)
        self.assertTrue(any("geometry tolerance" in e for e in errors))
        self.assertTrue(any("required invariants" in e for e in errors))

    def test_breakpoint_projection_regression_fails(self) -> None:
        fixture = copy.deepcopy(self.fixture("responsive-sidebar-chat-v1.json"))
        fixture["samples"][2]["projection"] = "sidebar-collapsed"
        self.assertTrue(any("wrong breakpoint projection" in e for e in validate(CAPS, fixture)))


if __name__ == "__main__":
    unittest.main()
