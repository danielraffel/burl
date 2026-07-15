#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


THIS_DIR = Path(__file__).resolve().parent
SCRIPT = THIS_DIR / "capture_cohort_gate.py"
SPEC = importlib.util.spec_from_file_location("capture_cohort_gate", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evidence(artifact: Path) -> dict:
    return {
        "schema": "pulp-parity-capture-evidence-v1",
        "artifact": {"sha256": sha256(artifact)},
        "source": {"identity": "source-app", "revision": "revision-1"},
        "route": "/settings",
        "viewport": {"width": 1200, "height": 800, "deviceScaleFactor": 2},
        "applicationState": {"route": "/settings", "theme": "dark"},
        "window": {"transparent": True, "effect": "system-material"},
        "sourceCapture": {
            "sha256": "a" * 64,
            "hostEnvironment": {
                "mode": "live-existing",
                "provenanceSha256": "c" * 64,
            },
        },
    }


class CaptureCohortGateTest(unittest.TestCase):
    def test_same_cohort_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_artifact = root / "reference.png"
            candidate_artifact = root / "candidate.json"
            reference_artifact.write_bytes(b"reference")
            candidate_artifact.write_bytes(b"candidate")
            reference = evidence(reference_artifact)
            candidate = evidence(candidate_artifact)
            report = gate.compare_cohort(reference, candidate)
            self.assertTrue(report["comparable"])
            self.assertEqual(report["classification"], "same-capture-cohort")

    def test_each_cohort_dimension_rejects_the_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "artifact"
            artifact.write_bytes(b"artifact")
            reference = evidence(artifact)
            cases = {
                "source.identity": lambda value: value["source"].update(identity="other"),
                "source.revision": lambda value: value["source"].update(revision="revision-2"),
                "route": lambda value: value.update(route="/other"),
                "viewport.width": lambda value: value["viewport"].update(width=900),
                "viewport.height": lambda value: value["viewport"].update(height=700),
                "viewport.deviceScaleFactor": lambda value: value["viewport"].update(deviceScaleFactor=1),
                "applicationState": lambda value: value.update(applicationState={"route": "/settings", "theme": "light"}),
                "window.transparent": lambda value: value["window"].update(transparent=False),
                "window.effect": lambda value: value["window"].update(effect="none"),
                "sourceCapture.sha256": lambda value: value["sourceCapture"].update(sha256="b" * 64),
                "sourceCapture.hostEnvironment": lambda value: value["sourceCapture"].update(
                    hostEnvironment={"mode": "live-existing", "provenanceSha256": "d" * 64}
                ),
            }
            for expected, mutate in cases.items():
                with self.subTest(field=expected):
                    candidate = json.loads(json.dumps(reference))
                    mutate(candidate)
                    report = gate.compare_cohort(reference, candidate)
                    self.assertFalse(report["comparable"])
                    self.assertEqual(
                        [mismatch["field"] for mismatch in report["mismatches"]],
                        [expected],
                    )

    def test_stale_artifact_receipt_is_invalid_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "artifact"
            artifact.write_bytes(b"before")
            receipt = root / "evidence.json"
            receipt.write_text(json.dumps(evidence(artifact)))
            artifact.write_bytes(b"after")
            with self.assertRaisesRegex(gate.EvidenceError, "freshness mismatch"):
                gate.load_evidence(receipt, artifact)

    def test_malformed_capture_dimensions_are_invalid_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "artifact"
            artifact.write_bytes(b"artifact")
            malformed = evidence(artifact)
            malformed["viewport"]["width"] = "1200"
            receipt = root / "evidence.json"
            receipt.write_text(json.dumps(malformed))
            with self.assertRaisesRegex(gate.EvidenceError, "positive integer"):
                gate.load_evidence(receipt, artifact)

    def test_unvalidated_declarative_host_projection_is_invalid_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "artifact"
            artifact.write_bytes(b"artifact")
            malformed = evidence(artifact)
            malformed["sourceCapture"]["hostEnvironment"] = {
                "mode": "declarative-projection",
                "provenanceSha256": "c" * 64,
            }
            receipt = root / "evidence.json"
            receipt.write_text(json.dumps(malformed))
            with self.assertRaisesRegex(gate.EvidenceError, "validated projection receipt"):
                gate.load_evidence(receipt, artifact)

    def test_cli_persists_invalid_cohort_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_artifact = root / "reference"
            candidate_artifact = root / "candidate"
            reference_artifact.write_bytes(b"reference")
            candidate_artifact.write_bytes(b"candidate")
            reference = evidence(reference_artifact)
            candidate = evidence(candidate_artifact)
            candidate["route"] = "/other"
            reference_path = root / "reference.json"
            candidate_path = root / "candidate.json"
            report_path = root / "report.json"
            reference_path.write_text(json.dumps(reference))
            candidate_path.write_text(json.dumps(candidate))
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--reference-artifact", str(reference_artifact),
                    "--reference-evidence", str(reference_path),
                    "--candidate-artifact", str(candidate_artifact),
                    "--candidate-evidence", str(candidate_path),
                    "--report", str(report_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            persisted = json.loads(report_path.read_text())
            self.assertEqual(persisted["classification"], "invalid-capture-cohort")
            self.assertEqual(persisted["mismatches"][0]["field"], "route")

    def test_cli_accepts_different_render_artifacts_from_one_source_capture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference_artifact = root / "reference"
            candidate_artifact = root / "candidate"
            reference_artifact.write_bytes(b"reference")
            candidate_artifact.write_bytes(b"candidate")
            self.assertNotEqual(sha256(reference_artifact), sha256(candidate_artifact))
            reference_path = root / "reference.json"
            candidate_path = root / "candidate.json"
            reference_path.write_text(json.dumps(evidence(reference_artifact)))
            candidate_path.write_text(json.dumps(evidence(candidate_artifact)))
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--reference-artifact", str(reference_artifact),
                    "--reference-evidence", str(reference_path),
                    "--candidate-artifact", str(candidate_artifact),
                    "--candidate-evidence", str(candidate_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout)["classification"], "same-capture-cohort")


if __name__ == "__main__":
    unittest.main()
