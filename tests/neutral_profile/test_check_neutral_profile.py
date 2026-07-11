import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("guard", ROOT / "tools/scripts/check_neutral_profile.py")
assert SPEC and SPEC.loader
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)
FIXTURES = pathlib.Path(__file__).parent / "fixtures"


class NeutralProfileGuardTest(unittest.TestCase):
    def test_clean_target_and_install_surfaces_pass(self):
        self.assertEqual([], GUARD.check_codemodel(FIXTURES / "good/codemodel.json"))
        self.assertEqual([], GUARD.check_install_manifest(FIXTURES / "good/install_manifest.txt"))

    def test_audio_and_plugin_leaks_fail(self):
        errors = GUARD.check_codemodel(FIXTURES / "bad/codemodel.json")
        errors += GUARD.check_install_manifest(FIXTURES / "bad/install_manifest.txt")
        self.assertEqual(4, len(errors))
        self.assertTrue(any("pulp-audio" in error for error in errors))
        self.assertTrue(any("PulpPluginFormats" in error for error in errors))

    def test_static_calls_require_positive_audio_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            deps = root / "tools/cmake"
            deps.mkdir(parents=True)
            (root / "CMakeLists.txt").write_text(
                "if(BURL_BUILD_AUDIO)\n  add_subdirectory(core/audio)\nendif()\n"
            )
            (deps / "PulpDependencies.cmake").write_text(
                "if(BURL_BUILD_AUDIO)\n  FetchContent_MakeAvailable(clap)\nendif()\n"
            )
            self.assertEqual([], GUARD.check_static(root))
            (root / "CMakeLists.txt").write_text("add_subdirectory(core/audio)\n")
            errors = GUARD.check_static(root)
            self.assertEqual(1, len(errors))
            self.assertIn("not guarded", errors[0])


if __name__ == "__main__":
    unittest.main()
