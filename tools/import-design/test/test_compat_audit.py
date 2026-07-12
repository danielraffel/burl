import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "tools/import-design/compat_audit.py"
SPEC = importlib.util.spec_from_file_location("compat_audit", MODULE_PATH)
audit = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(audit)


class CompatAuditTests(unittest.TestCase):
    def setUp(self):
        self.fixture = ROOT / "tools/import-design/test/fixtures/compat-audit"

    def report(self):
        return audit.build_report(
            self.fixture / "source", self.fixture / "observed.json", self.fixture,
            ROOT / "tools/import-design/catalogs", self.fixture / "compat.json",
            self.fixture / "evidence-index.json")

    def test_inventories_renderer_and_platform_separately(self):
        report = self.report()
        by_key = {(item["domain"], item["feature"]): item for item in report["items"]}
        self.assertTrue(by_key[("css", "color")]["catalog"]["cataloged"])
        self.assertEqual(by_key[("css", "color")]["implementation"]["conformance"], "supported")
        self.assertEqual(by_key[("css", "color")]["implementation"]["strategy"], "direct")
        self.assertEqual(by_key[("css", "display")]["implementation"]["conformance"], "partial")
        self.assertEqual(by_key[("css", "display")]["implementation"]["strategy"], "direct")
        self.assertTrue(by_key[("css", "display")]["observation"]["seen"])
        self.assertIn(("pseudo-state", "hover"), by_key)
        self.assertIn(("aria", "role:switch"), by_key)
        self.assertIn(("electron-platform", "api:ipcRenderer"), by_key)
        self.assertIn(("electron-platform", "ipc:ipcRenderer.invoke:neutral:read"), by_key)
        self.assertNotEqual(by_key[("electron-platform", "api:ipcRenderer")]["domain"], "css")
        self.assertEqual(by_key[("css", "color")]["catalog"]["provenance"]["authority"], "W3C CSS")
        self.assertEqual(by_key[("css", "color")]["evidence"]["resolved"][0]["id"],
                         "unit:neutral-color-route")
        self.assertEqual(by_key[("css", "color")]["evidence"]["resolved"][0]["route"],
                         by_key[("css", "color")]["implementation"]["route"])

    def test_ci_gate_reports_uncataloged_observations(self):
        report = self.report()
        self.assertFalse(report["ok"])
        self.assertIn(
            {"code": "observed-uncataloged", "domain": "css", "feature": "mystery-prop"},
            report["failures"],
        )
        self.assertFalse(any(failure["code"] == "supported-without-resolved-evidence" and
                             failure["feature"] == "color" for failure in report["failures"]))
        self.assertIn(
            {"code": "supported-without-resolved-evidence", "domain": "css", "feature": "opacity"},
            report["failures"],
        )

    def test_typed_prefix_and_cannot_validate_do_not_count_as_evidence(self):
        index = audit.load_evidence_index(self.fixture / "evidence-index.json")
        self.assertEqual(audit.resolve_evidence(self.fixture, "unit:not-registered", index),
                         (None, "unknown-evidence-id"))
        self.assertEqual(audit.resolve_evidence(
            self.fixture, "cannot-validate:later", index),
            (None, "cannot-validate-is-not-evidence"))

    def test_legacy_paths_fail_closed(self):
        index = audit.load_evidence_index(self.fixture / "evidence-index.json")
        self.assertEqual(audit.resolve_evidence(self.fixture, "evidence.txt", index),
                         (None, "legacy-reference-not-indexed"))

    def test_evidence_for_another_route_fails_closed(self):
        index = audit.load_evidence_index(self.fixture / "evidence-index.json")
        self.assertEqual(audit.resolve_evidence(
            self.fixture, "unit:neutral-color-route", index, "different route"),
            (None, "route-mismatch"))

    def test_registered_evidence_needs_an_implementation_route(self):
        index = audit.load_evidence_index(self.fixture / "evidence-index.json")
        self.assertEqual(audit.resolve_evidence(
            self.fixture, "unit:neutral-color-route", index),
            (None, "missing-implementation-route"))

    def test_registered_path_cannot_escape_repository(self):
        index = audit.load_evidence_index(self.fixture / "evidence-index.json")
        index["unit:neutral-color-route"]["path"] = "../outside.txt"
        self.assertEqual(audit.resolve_evidence(
            self.fixture, "unit:neutral-color-route", index, "neutral painter"),
            (None, "unsafe-evidence-path"))


if __name__ == "__main__":
    unittest.main()
