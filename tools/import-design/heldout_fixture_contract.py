#!/usr/bin/env python3
"""Deterministic contract checks for sealed, token-less held-out imports."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("literal_token_candidates.py")
SPEC = importlib.util.spec_from_file_location("literal_token_candidates", MODULE_PATH)
TOKENS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(TOKENS)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(root: Path) -> list[str]:
    fixture = root / "tools/import-design/fixtures/heldout-tokenless-block"
    source_path = fixture / "source.html"
    manifest = json.loads((fixture / "manifest.json").read_text())
    source = source_path.read_text()
    errors: list[str] = []
    if manifest["sourceSha256"] != sha256(source_path):
        errors.append("sealed source hash mismatch")
    if "var(" in source or re.search(r"--[\w-]+\s*:", source):
        errors.append("held-out source must not contain CSS custom properties")
    displays = [value for _, prop, value in TOKENS.declarations(source) if prop == "display"]
    for required in manifest["requiredDisplayValues"]:
        if required not in displays:
            errors.append(f"required display value not observed: {required}")
    props = {prop for _, prop, _ in TOKENS.declarations(source)}
    for required in manifest["requiredProperties"]:
        if required not in props:
            errors.append(f"required property not observed: {required}")
    candidates = TOKENS.token_candidates(source)
    if len(candidates) < manifest["minimumExactTokenCandidates"]:
        errors.append("insufficient exact token candidate clusters")
    if not TOKENS.reviewed_promotion_round_trip(source, candidates):
        errors.append("reviewed token promotion is not render/source neutral")
    return errors


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    failures = validate(repo)
    if failures:
        raise SystemExit("\n".join(failures))
    print("held-out fixture contract: PASS")
