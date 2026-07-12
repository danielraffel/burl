import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "heldout_fixture_contract", ROOT / "tools/import-design/heldout_fixture_contract.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class HeldoutFixtureContractTests(unittest.TestCase):
    def test_sealed_tokenless_block_fixture_contract(self):
        self.assertEqual(MODULE.validate(ROOT), [])

    def test_real_external_heldout_contract(self):
        self.assertEqual(MODULE.validate_external_heldout(ROOT), [])

    def test_candidate_extraction_is_exact_deterministic_and_review_only(self):
        path = ROOT / "tools/import-design/fixtures/heldout-tokenless-block/source.html"
        source = path.read_text()
        first = MODULE.TOKENS.token_candidates(source)
        self.assertEqual(first, MODULE.TOKENS.token_candidates(source))
        self.assertTrue(all(len(item["uses"]) >= 2 for item in first))
        self.assertTrue(MODULE.TOKENS.reviewed_promotion_round_trip(source, first))
        self.assertEqual(source, path.read_text())

    def test_dynamic_tokens_and_glass_have_distinct_owners_and_fail_closed_oracles(self):
        contract = json.loads((ROOT / "tools/import-design/catalogs/native-compositing-contract.json").read_text())
        self.assertEqual(contract["dynamicCustomProperties"]["runtimeMutation"], "runtime-recompute-required")
        self.assertEqual(contract["dynamicCustomProperties"]["externalBinding"], "platform-or-application-binding-required")
        self.assertEqual(contract["dynamicCustomProperties"]["unresolved"], "fail-closed")
        effects = contract["effects"]
        self.assertEqual(effects["inWindowBackdropFilter"]["owner"], "skia-renderer")
        self.assertEqual(effects["behindWindowMaterial"]["owner"], "platform-window-host")
        self.assertNotEqual(effects["inWindowBackdropFilter"]["input"], effects["behindWindowMaterial"]["input"])
        oracle = contract["transparentWindowOracle"]
        self.assertEqual(oracle["missingMetadataResult"], "invalid-evidence")
        self.assertIn("wallpaperFixtureHash", oracle["requiredMetadata"])


if __name__ == "__main__":
    unittest.main()
