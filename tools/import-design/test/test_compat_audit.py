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
            ROOT / "tools/import-design/catalogs", self.fixture / "compat.json")

    def test_inventories_renderer_and_platform_separately(self):
        report = self.report()
        by_key = {(item["domain"], item["feature"]): item for item in report["items"]}
        self.assertEqual(by_key[("css", "color")]["status"], "supported")
        self.assertEqual(by_key[("css", "display")]["status"], "lowered")
        self.assertIn(("pseudo-state", "hover"), by_key)
        self.assertIn(("aria", "role:switch"), by_key)
        self.assertIn(("electron-platform", "api:ipcRenderer"), by_key)
        self.assertIn(("electron-platform", "ipc:ipcRenderer.invoke:neutral:read"), by_key)
        self.assertNotEqual(by_key[("electron-platform", "api:ipcRenderer")]["domain"], "css")
        self.assertEqual(by_key[("css", "color")]["provenance"]["authority"], "W3C CSS")

    def test_ci_gate_reports_uncataloged_observations(self):
        report = self.report()
        self.assertFalse(report["ok"])
        self.assertIn(
            {"code": "observed-uncataloged", "domain": "css", "feature": "mystery-prop"},
            report["failures"],
        )
        self.assertFalse(any(failure["code"] == "supported-without-test" and
                             failure["feature"] == "color" for failure in report["failures"]))
        self.assertIn(
            {"code": "supported-without-test", "domain": "css", "feature": "opacity"},
            report["failures"],
        )


if __name__ == "__main__":
    unittest.main()
