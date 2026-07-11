import importlib.util
import json
import pathlib
import unittest

HERE = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("validate_manifest", HERE / "validate_manifest.py")
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class EvidenceManifestTest(unittest.TestCase):
    def load(self, name):
        path = HERE / "fixtures" / name
        return json.loads(path.read_text()), path

    def test_representative_manifest_is_valid(self):
        data, path = self.load("valid.json")
        self.assertEqual([], VALIDATOR.validate(data, path))

    def test_invalid_manifest_reports_structural_and_gate_errors(self):
        data, path = self.load("invalid.json")
        errors = VALIDATOR.validate(data, path)
        self.assertGreaterEqual(len(errors), 8)
        self.assertTrue(any("safe relative" in error for error in errors))
        self.assertTrue(any("missing required artifact kinds" in error for error in errors))

    def test_verify_files_checks_digest(self):
        data, path = self.load("valid.json")
        errors = VALIDATOR.validate(data, path, verify_files=True)
        self.assertTrue(any("does not exist" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
