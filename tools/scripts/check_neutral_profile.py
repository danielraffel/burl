#!/usr/bin/env python3
"""Reject audio/plugin leakage from a BURL_BUILD_AUDIO=OFF build."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Any

TARGET_FORBIDDEN = re.compile(
    r"(?:^|[-_/.:])(audio|midi|signal|format|osc|gpu[-_]?audio|"
    r"standalone|dsl|vst3|clap|lv2|aax|auv3|audio[-_]?unit|plugin)(?:$|[-_/.:])|"
    r"pulp(?:[-_:]?host|plugin|midi|aax|auv3|audio)",
    re.IGNORECASE,
)
INSTALL_FORBIDDEN = re.compile(
    r"/pulp/(?:audio|midi|signal|format|osc|gpu_audio|host|dsl)/|"
    r"/external/(?:clap|lv2|vst3sdk|AudioUnitSDK)/|/choc/audio/|"
    r"/SDL3/SDL_audio\.h$|"
    r"/(?:audio_inspector|audio_bridge|midi_binding|midi_keyboard|"
    r"plugin_manager_panel|plugin_view_host|host_param_surface|graph_editor_view|"
    r"plugin_main_thread|midi_parameter_map)[^/]*$|"
    r"PulpInfoPlist\.(?:aax|au|vst3)\.in$|"
    r"Pulp(?:Plugin|AAX|Auv3|Midi|Utils)[^/]*\.cmake$",
    re.IGNORECASE,
)
ROOT_CALLS = {
    "add_subdirectory(core/audio)", "add_subdirectory(core/midi)",
    "add_subdirectory(core/signal)", "add_subdirectory(core/graph)",
    "add_subdirectory(core/format)", "add_subdirectory(core/gpu_audio)",
    "add_subdirectory(core/osc)", "add_subdirectory(core/host)",
    "add_subdirectory(core/dsl)", "pulp_configure_aax_sdk()",
}
DEPENDENCY_CALLS = {
    "FetchContent_MakeAvailable(clap)", "FetchContent_MakeAvailable(lv2)",
    "add_library(vst3-sdk", "add_library(ausdk",
}


def check_static(source: pathlib.Path) -> list[str]:
    errors: list[str] = []
    _check_guarded_calls(source / "CMakeLists.txt", ROOT_CALLS, errors)
    _check_guarded_calls(source / "tools/cmake/PulpDependencies.cmake", DEPENDENCY_CALLS, errors)
    return errors


def _check_guarded_calls(path: pathlib.Path, calls: set[str], errors: list[str]) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        errors.append(f"cannot read {path}: {error}")
        return
    stack: list[str] = []
    for number, raw in enumerate(lines, 1):
        line = raw.split("#", 1)[0].strip()
        match = re.match(r"if\s*\((.*)\)\s*$", line, re.IGNORECASE)
        if match:
            stack.append(match.group(1))
        elif re.match(r"endif\s*\(", line, re.IGNORECASE) or line.lower() == "endif()":
            if stack:
                stack.pop()
        for call in calls:
            if call in line and not any(_positive_audio_guard(condition) for condition in stack):
                errors.append(f"{path}:{number}: neutral audio call is not guarded by BURL_BUILD_AUDIO: {call}")


def _positive_audio_guard(condition: str) -> bool:
    normalized = re.sub(r"\s+", " ", condition.upper())
    return "BURL_BUILD_AUDIO" in normalized and not re.search(r"NOT\s+BURL_BUILD_AUDIO", normalized)


def check_codemodel(path: pathlib.Path) -> list[str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"cannot read codemodel {path}: {error}"]
    names = _target_names(data, path.parent)
    return [f"forbidden neutral target: {name}" for name in sorted(names) if TARGET_FORBIDDEN.search(name)]


def _target_names(value: Any, base: pathlib.Path) -> set[str]:
    names: set[str] = set()
    if isinstance(value, dict):
        targets = value.get("targets")
        if isinstance(targets, list):
            for target in targets:
                if isinstance(target, dict) and isinstance(target.get("name"), str):
                    names.add(target["name"])
                if isinstance(target, dict) and isinstance(target.get("jsonFile"), str):
                    child = base / target["jsonFile"]
                    try:
                        names.update(_target_names(json.loads(child.read_text()), child.parent))
                    except (OSError, json.JSONDecodeError):
                        pass
        for child in value.values():
            names.update(_target_names(child, base))
    elif isinstance(value, list):
        for child in value:
            names.update(_target_names(child, base))
    return names


def check_install_manifest(path: pathlib.Path) -> list[str]:
    try:
        entries = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    except OSError as error:
        return [f"cannot read install manifest {path}: {error}"]
    return [f"forbidden installed path: {entry}" for entry in entries if INSTALL_FORBIDDEN.search(entry)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--codemodel", type=pathlib.Path, required=True)
    parser.add_argument("--install-manifest", type=pathlib.Path, required=True)
    args = parser.parse_args()
    errors = check_static(args.source) + check_codemodel(args.codemodel) + check_install_manifest(args.install_manifest)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
