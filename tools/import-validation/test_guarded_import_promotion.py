#!/usr/bin/env python3

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
SCRIPT = THIS_DIR / "guarded_import_promotion.py"
PROJECTION_SHA = "b" * 64
MANIFEST_SHA = "d" * 64


def sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def encoded(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True) + "\n").encode()


class Fixture:
    def __init__(self, root: Path, *, background: str = "#18181866", host_mode: str = "declarative-projection"):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.candidate = root / "candidate.json"
        self.canonical = root / "canonical.json"
        self.window = root / "window.json"
        self.capture = root / "source.json"
        self.meta = root / "meta.json"
        self.receipt = root / "promotion.json"
        self.report = root / "report.json"
        self.candidate_bytes = encoded({
            "version": 1,
            "root": {
                "layout": {"widthMode": "fill", "heightMode": "fill"},
                "style": {"backgroundColor": background, "backgroundLayers": []},
            },
        })
        self.window_bytes = encoded({
            "schema": "burl-source-window-contract-v1",
            "observations": {"transparent": True},
            "projection": {"transparent": True, "backdropEffect": "liquid_glass"},
        })
        projection = {
            "schema": "burl-host-capability-projection-v1",
            "mode": "declarative-projection",
            "provenanceSha256": PROJECTION_SHA,
            "entryCount": 1,
            "paths": [{"path": "desktopHost.surface", "kind": "property"}],
        }
        policy = {
            "hostServices": host_mode,
            "windowSurfaceState": "transparent-preference",
            "rootStatePredicate": {
                "schema": "burl-root-state-predicate-receipt-v1",
                "status": "passed",
                "declaration": {"selector": ":root", "requiredClasses": ["surface-state"]},
            },
        }
        predicate_declaration = policy["rootStatePredicate"]["declaration"]
        predicate_sha = hashlib.sha256(json.dumps(
            predicate_declaration, sort_keys=True, separators=(",", ":")
        ).encode()).hexdigest()
        policy["rootStatePredicate"]["provenanceSha256"] = predicate_sha
        if host_mode == "declarative-projection":
            policy["hostCapabilityProjection"] = projection
        self.capture_bytes = encoded({"schema": "pulp-runtime-source-capture-v1", "policy": policy})
        self.meta_bytes = encoded({
            "schema": "pulp-runtime-source-capture-v1",
            "evidenceSha256": sha(self.capture_bytes),
            "manifestSha256": MANIFEST_SHA,
        })
        self.receipt_value = {
            "schema": "burl-import-promotion-candidate-v1",
            "candidateSha256": sha(self.candidate_bytes),
            "sourceWindowSha256": sha(self.window_bytes),
            "sourceCaptureSha256": sha(self.capture_bytes),
            "sourceCaptureManifestSha256": MANIFEST_SHA,
            "rootStatePredicateSha256": predicate_sha,
            "surfaceState": "transparent-preference",
        }
        self.write()

    def write(self) -> None:
        self.candidate.write_bytes(self.candidate_bytes)
        self.window.write_bytes(self.window_bytes)
        self.capture.write_bytes(self.capture_bytes)
        self.meta.write_bytes(self.meta_bytes)
        self.receipt.write_bytes(encoded(self.receipt_value))

    def command(self, *extra: str) -> list[str]:
        return [
            sys.executable, str(SCRIPT),
            "--candidate", str(self.candidate),
            "--canonical", str(self.canonical),
            "--source-window", str(self.window),
            "--source-capture", str(self.capture),
            "--source-capture-meta", str(self.meta),
            "--promotion-receipt", str(self.receipt),
            "--report", str(self.report),
            *extra,
        ]

    def run(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(self.command(*extra), capture_output=True, text=True, check=False)


class GuardedImportPromotionTest(unittest.TestCase):
    def test_validated_projection_and_compositing_atomically_replace_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            fixture.canonical.write_bytes(b"old-canonical")
            result = fixture.run()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(fixture.canonical.read_bytes(), fixture.candidate_bytes)
            report = json.loads(fixture.report.read_text())
            self.assertEqual(report["status"], "promoted")
            self.assertEqual(report["hostEnvironment"]["projectionReceipt"]["provenanceSha256"], PROJECTION_SHA)

    def test_check_only_validates_without_replacing_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            fixture.canonical.write_bytes(b"old-canonical")
            result = fixture.run("--check-only")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(fixture.canonical.read_bytes(), b"old-canonical")
            self.assertEqual(json.loads(fixture.report.read_text())["status"], "validated-check-only")

    def test_stale_candidate_fails_before_touching_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            fixture.canonical.write_bytes(b"old-canonical")
            fixture.candidate.write_bytes(b'{}\n')
            result = fixture.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("freshness mismatch for candidateSha256", result.stderr)
            self.assertEqual(fixture.canonical.read_bytes(), b"old-canonical")
            self.assertFalse(fixture.report.exists())

    def test_transparent_window_rejects_recording_fake_and_unvalidated_projection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake = Fixture(Path(directory) / "fake", host_mode="recording-fake")
            result = fake.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("requires live or declaratively projected host state", result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            capture = json.loads(fixture.capture_bytes)
            del capture["policy"]["hostCapabilityProjection"]
            fixture.capture_bytes = encoded(capture)
            fixture.meta_bytes = encoded({
                "schema": "pulp-runtime-source-capture-v1",
                "evidenceSha256": sha(fixture.capture_bytes),
                "manifestSha256": MANIFEST_SHA,
            })
            fixture.receipt_value["sourceCaptureSha256"] = sha(fixture.capture_bytes)
            fixture.write()
            result = fixture.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("host provenance is invalid", result.stderr)

    def test_opaque_covering_root_requires_explicit_opaque_preference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory), background="#181818ff")
            rejected = fixture.run()
            self.assertEqual(rejected.returncode, 1)
            self.assertIn("surfaceState=opaque-preference", rejected.stderr)
            fixture.receipt_value["surfaceState"] = "opaque-preference"
            capture = json.loads(fixture.capture_bytes)
            capture["policy"]["windowSurfaceState"] = "opaque-preference"
            fixture.capture_bytes = encoded(capture)
            fixture.meta_bytes = encoded({
                "schema": "pulp-runtime-source-capture-v1",
                "evidenceSha256": sha(fixture.capture_bytes),
                "manifestSha256": MANIFEST_SHA,
            })
            fixture.receipt_value["sourceCaptureSha256"] = sha(fixture.capture_bytes)
            fixture.write()
            accepted = fixture.run()
            self.assertEqual(accepted.returncode, 0, accepted.stderr)

    def test_surface_state_must_come_from_source_capture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            fixture.receipt_value["surfaceState"] = "opaque-preference"
            fixture.write()
            result = fixture.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not match source capture", result.stderr)

    def test_missing_or_crossed_root_predicate_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            capture = json.loads(fixture.capture_bytes)
            del capture["policy"]["rootStatePredicate"]
            fixture.capture_bytes = encoded(capture)
            fixture.meta_bytes = encoded({
                "schema": "pulp-runtime-source-capture-v1",
                "evidenceSha256": sha(fixture.capture_bytes),
                "manifestSha256": MANIFEST_SHA,
            })
            fixture.receipt_value["sourceCaptureSha256"] = sha(fixture.capture_bytes)
            fixture.write()
            result = fixture.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("no passed root-state predicate", result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            fixture.receipt_value["rootStatePredicateSha256"] = "e" * 64
            fixture.write()
            result = fixture.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("crosses the source root-state predicate", result.stderr)

    def test_root_predicate_hash_must_cover_its_declaration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            capture = json.loads(fixture.capture_bytes)
            capture["policy"]["rootStatePredicate"]["declaration"]["requiredClasses"] = ["different-state"]
            fixture.capture_bytes = encoded(capture)
            fixture.meta_bytes = encoded({
                "schema": "pulp-runtime-source-capture-v1",
                "evidenceSha256": sha(fixture.capture_bytes),
                "manifestSha256": MANIFEST_SHA,
            })
            fixture.receipt_value["sourceCaptureSha256"] = sha(fixture.capture_bytes)
            fixture.write()
            result = fixture.run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not hash its declaration", result.stderr)

    def test_candidate_and_canonical_must_be_distinct_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(Path(directory))
            command = fixture.command()
            canonical_index = command.index("--canonical") + 1
            command[canonical_index] = str(fixture.candidate)
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("candidate must be a staging path", result.stderr)


if __name__ == "__main__":
    unittest.main()
