#!/usr/bin/env python3
"""Fail when private planning or consumer-product material enters Burl."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-s"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()


def main() -> int:
    errors: list[str] = []
    tracked = tracked_files()
    paths = [line.split("\t", 1)[1] for line in tracked]

    if ".gitmodules" in paths:
        errors.append(".gitmodules must not be tracked in the public Burl tree")
    if any(path == "planning" or path.startswith("planning/") for path in paths):
        errors.append("private planning content must not be tracked")
    if any(line.startswith("160000 ") for line in tracked):
        errors.append("gitlinks/submodules are not allowed in the public Burl tree")
    if any(path == "palot" or path.startswith("palot/") for path in paths):
        errors.append("Palot product code belongs in its consumer repository")

    forbidden_text = {
        "pulp-planning": "private planning repository name",
        "private submodule": "private submodule topology",
        "planning/production-readiness": "private production-readiness path",
        "/Users/danielraffel": "personal absolute path",
        "/Volumes/Workshop": "personal volume path",
        "~/.config/pulp/secrets": "personal secret-store path",
        "macstudio": "personal runner hostname",
        "Daniels-MacBook-Pro": "personal runner hostname",
    }
    for path in paths:
        if Path(path).suffix.lower() not in {".md", ".yaml", ".yml"}:
            continue
        file_path = ROOT / path
        if not file_path.is_file():
            continue
        try:
            content = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for marker, description in forbidden_text.items():
            if marker in content:
                errors.append(f"{path} contains {description}: {marker}")

    required = {
        "README.md": "# Burl",
        "VISION.md": "# Burl vision",
        "UPSTREAM.md": "df3d0b8b53f7b84e3330ede1acb557ed1fa75e51",
        "LICENSE.md": "MIT License",
        "NOTICE.md": "# Third-Party Notices",
        "DEPENDENCIES.md": "# Dependencies",
    }
    for path, marker in required.items():
        file_path = ROOT / path
        if not file_path.is_file():
            errors.append(f"required public file is missing: {path}")
        elif marker not in file_path.read_text(encoding="utf-8"):
            errors.append(f"{path} is missing required marker: {marker}")

    if errors:
        print("public hygiene check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("public hygiene check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
