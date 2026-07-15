#!/usr/bin/env python3

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("validate_window_compositing_capture.py")
SPEC = importlib.util.spec_from_file_location("validate_window_compositing_capture", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
validate = MODULE.validate

CONTRACT = {
    "schema": "burl-source-window-contract-v1",
    "observations": {"transparent": True},
    "projection": {"transparent": True, "backdropEffect": "liquid_glass"},
}
ROOT = {
    "version": 1,
    "root": {
        "layout": {"widthMode": "fill", "heightMode": "fill"},
        "style": {"backgroundColor": "#181818ff", "backgroundLayers": []},
    },
}
PROVENANCE = "1" * 64
PROJECTION_RECEIPT = {
    "schema": "burl-host-capability-projection-v1",
    "mode": "declarative-projection",
    "provenanceSha256": PROVENANCE,
    "entryCount": 1,
    "paths": [{"path": "desktopHost.surface", "kind": "property"}],
}
OPAQUE_RECEIPT = {
    "schema": "burl-capture-environment-state-v1",
    "surfaceState": "opaque-preference",
    "hostEnvironment": {
        "mode": "declarative-projection",
        "provenanceSha256": PROVENANCE,
        "projectionReceipt": PROJECTION_RECEIPT,
    },
    "rootStatePredicate": {"status": "passed", "declaration": "manifest predicate id"},
}


class WindowCompositingCaptureTest(unittest.TestCase):
    def test_current_regression_fails_without_opaque_preference_receipt(self) -> None:
        errors = validate(CONTRACT, ROOT)
        self.assertIn("opaque covering root requires a capture-environment state receipt", errors)

    def test_transparent_root_passes_without_product_specific_values(self) -> None:
        for color in ("transparent", "#18181866", "rgba(24, 24, 24, 0.4)", "rgb(24 24 24 / 40%)"):
            observed = copy.deepcopy(ROOT)
            observed["root"]["style"]["backgroundColor"] = color
            self.assertEqual(validate(CONTRACT, observed), [], color)

    def test_explicit_provenance_bearing_opaque_preference_passes(self) -> None:
        self.assertEqual(validate(CONTRACT, ROOT, OPAQUE_RECEIPT), [])

    def test_opaque_preference_fails_closed_without_authoritative_provenance(self) -> None:
        for mutation in (
            {"schema": "wrong"},
            {"surfaceState": "transparent-preference"},
            {"hostEnvironment": {"mode": "recording-fake", "provenanceSha256": PROVENANCE}},
            {"hostEnvironment": {"mode": "live-existing", "provenanceSha256": "not-a-hash"}},
            {"hostEnvironment": {"mode": "declarative-projection", "provenanceSha256": PROVENANCE}},
            {"hostEnvironment": {"mode": "declarative-projection", "provenanceSha256": PROVENANCE,
                                 "projectionReceipt": {**PROJECTION_RECEIPT, "provenanceSha256": "2" * 64}}},
            {"rootStatePredicate": {"status": "failed", "declaration": "manifest predicate id"}},
            {"rootStatePredicate": {"status": "passed", "declaration": ""}},
        ):
            receipt = copy.deepcopy(OPAQUE_RECEIPT)
            receipt.update(mutation)
            self.assertTrue(validate(CONTRACT, ROOT, receipt), mutation)

    def test_layered_fill_and_unknown_coverage_fail_closed(self) -> None:
        layered = copy.deepcopy(ROOT)
        layered["root"]["style"] = {
            "backgroundColor": "#00000000",
            "backgroundLayers": [{"kind": "linear-gradient"}],
        }
        self.assertTrue(validate(CONTRACT, layered))
        del layered["root"]["layout"]
        self.assertIn(
            "cannot prove an opaque/layered root does not cover the transparent window",
            validate(CONTRACT, layered),
        )

    def test_nontransparent_window_does_not_impose_alpha_policy(self) -> None:
        contract = copy.deepcopy(CONTRACT)
        contract["observations"]["transparent"] = False
        contract["projection"] = {"transparent": False, "backdropEffect": "none"}
        self.assertEqual(validate(contract, ROOT), [])

    def test_unknown_color_and_malformed_ir_fail_closed(self) -> None:
        observed = copy.deepcopy(ROOT)
        observed["root"]["style"]["backgroundColor"] = "color(display-p3 1 0 0)"
        self.assertIn("root background alpha is unparseable", validate(CONTRACT, observed)[0])
        self.assertTrue(validate(CONTRACT, {"version": 1}))

    def test_cli_exit_status_distinguishes_rejection_and_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            contract = base / "window.json"
            observed = base / "observed.json"
            receipt = base / "state.json"
            contract.write_text(json.dumps(CONTRACT))
            observed.write_text(json.dumps(ROOT))
            receipt.write_text(json.dumps(OPAQUE_RECEIPT))
            rejected = subprocess.run(
                [sys.executable, str(MODULE_PATH), str(contract), str(observed)],
                check=False, capture_output=True, text=True,
            )
            self.assertEqual(rejected.returncode, 1)
            self.assertIn("opaque covering root", rejected.stderr)
            passed = subprocess.run(
                [sys.executable, str(MODULE_PATH), str(contract), str(observed),
                 "--capture-state", str(receipt)],
                check=False, capture_output=True, text=True,
            )
            self.assertEqual(passed.returncode, 0, passed.stderr)


if __name__ == "__main__":
    unittest.main()
