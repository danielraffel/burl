from __future__ import annotations

import copy
import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("visual_parity_gate.py")
SPEC = importlib.util.spec_from_file_location("visual_parity_gate", SCRIPT)
gate = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(gate)

NOW = dt.datetime(2026, 7, 11, 12, 0, tzinfo=dt.timezone.utc)


class VisualParityGateTests(unittest.TestCase):
    def setUp(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow required")
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.Image = Image
        self._image("source.png", (40, 80, 120))
        self._image("candidate.png", (40, 80, 120))
        for name in ("source-repeat-1.png", "source-repeat-2.png",
                     "candidate-repeat-1.png", "candidate-repeat-2.png"):
            self._image(name, (40, 80, 120))
        (self.root / "Inter.ttf").write_bytes(b"pinned-neutral-font")
        self.manifest = self._manifest()

    def tearDown(self):
        self.temp.cleanup()

    def _image(self, name: str, color: tuple[int, int, int], size=(16, 16)) -> None:
        self.Image.new("RGB", size, color).save(self.root / name)

    def _artifact(self, name: str, backend: str) -> dict:
        path = self.root / name
        font = self.root / "Inter.ttf"
        return {
            "path": name, "sha256": gate.file_hash(path), "width": 16, "height": 16,
            "dpr": 2, "backend": backend, "captured_at": "2026-07-11T11:00:00Z",
            "revision": "0123456789abcdef",
            "fonts": [{"family": "Inter", "path": "Inter.ttf", "sha256": gate.file_hash(font)}],
        }

    def _manifest(self) -> dict:
        manifest = {
            "schema": gate.SCHEMA,
            "source": self._artifact("source.png", "chromium-128"),
            "candidate": self._artifact("candidate.png", "skia-dawn-metal"),
            "freshness": {"max_age_seconds": 7200},
            "baseline_provenance": {
                "captured_by": "independent-source-capture", "source_revision": "0123456789abcdef",
                "renderer_version": "chromium-128", "regeneration_reason": "initial reviewed baseline",
                "reviewed_by": "reviewer", "review_commit": "abcdef123456",
            },
            "backdrop": {"policy": "opaque-tier", "tier": "opaque-test-tier"},
            "masks": [],
            "thresholds": {"metric": "normalized-rgb-l2-v1"},
            "critical_regions": [{
                "name": "composer", "rect": {"x": 0, "y": 0, "width": 16, "height": 16},
                "minimum_pixel_similarity": 0.99,
            }],
            "threshold_approval": {
                "policy_sha256": "", "reviewed_by": "reviewer",
                "review_commit": "abcdef123456", "rationale": "calibrated identical fixture",
            },
            "calibration": {
                "source_repeats": [self._artifact("source-repeat-1.png", "chromium-128"),
                                   self._artifact("source-repeat-2.png", "chromium-128")],
                "candidate_repeats": [self._artifact("candidate-repeat-1.png", "skia-dawn-metal"),
                                      self._artifact("candidate-repeat-2.png", "skia-dawn-metal")],
                "source_minimum_pixel_similarity": 1.0,
                "candidate_minimum_pixel_similarity": 1.0,
            },
        }
        self._lock(manifest)
        return manifest

    def _lock(self, manifest: dict) -> None:
        manifest["threshold_approval"]["policy_sha256"] = gate.canonical_hash({
            "thresholds": manifest["thresholds"],
            "critical_regions": manifest["critical_regions"],
            "masks": manifest["masks"],
        })

    def _run(self, mutation=None) -> dict:
        manifest = copy.deepcopy(self.manifest)
        if mutation:
            mutation(manifest)
        path = self.root / "manifest.json"
        path.write_text(json.dumps(manifest))
        return gate.validate_manifest(path, NOW)

    def test_valid_calibrated_manifest_passes(self):
        result = self._run()
        self.assertTrue(result["ok"], result["errors"])
        self.assertTrue(result["regions"]["composer"]["passed"])

    def test_geometry_mutation_fails(self):
        result = self._run(lambda m: m["candidate"].update(width=15))
        self.assertFalse(result["ok"])
        self.assertTrue(any("geometry" in error or "dimensions" in error for error in result["errors"]))

    def test_stale_hash_mutation_fails(self):
        result = self._run(lambda m: m["source"].update(sha256="0" * 64))
        self.assertFalse(result["ok"])
        self.assertIn("source: stale hash", result["errors"])

    def test_font_substitution_mutation_fails(self):
        result = self._run(lambda m: m["candidate"]["fonts"][0].update(sha256="0" * 64))
        self.assertFalse(result["ok"])
        self.assertTrue(any("font substitution" in error for error in result["errors"]))

    def test_critical_region_failure_cannot_be_waived_by_other_pixels(self):
        def mutate(manifest):
            image = self.Image.open(self.root / "candidate.png")
            for y in range(4):
                for x in range(4):
                    image.putpixel((x, y), (255, 0, 0))
            image.save(self.root / "candidate.png")
            manifest["candidate"]["sha256"] = gate.file_hash(self.root / "candidate.png")
            manifest["critical_regions"] = [{
                "name": "icon", "rect": {"x": 0, "y": 0, "width": 4, "height": 4},
                "minimum_pixel_similarity": 0.99,
            }]
            self._lock(manifest)
        result = self._run(mutate)
        self.assertFalse(result["ok"])
        self.assertIn("critical region failed: icon", result["errors"])

    def test_unjustified_mask_fails(self):
        def mutate(manifest):
            manifest["backdrop"] = {"policy": "reviewed-mask", "tier": "opaque-test-tier"}
            manifest["masks"] = [{"rect": {"x": 0, "y": 0, "width": 1, "height": 1}}]
            self._lock(manifest)
        result = self._run(mutate)
        self.assertFalse(result["ok"])
        self.assertIn("mask 0: explicit justification and review required", result["errors"])

    def test_uncalibrated_threshold_fails(self):
        result = self._run(lambda m: m["calibration"].update(source_repeats=[]))
        self.assertFalse(result["ok"])
        self.assertTrue(any("uncalibrated threshold" in error for error in result["errors"]))

    def test_silently_loosened_threshold_fails_policy_lock(self):
        result = self._run(lambda m: m["critical_regions"][0].update(
            minimum_pixel_similarity=0.1))
        self.assertFalse(result["ok"])
        self.assertIn("threshold policy is unlocked or lacks review provenance", result["errors"])


if __name__ == "__main__":
    unittest.main()
