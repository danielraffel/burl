#!/usr/bin/env python3
"""Fail-closed validator for the CSS-to-Burl native migration intersection."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

OUTCOMES = {"exact", "equivalent", "approximate", "unsupported"}
INVARIANTS = {"semantic-tree", "focus-order", "hit-targets", "ax-order"}


def load(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: root must be an object")
    return value


def validate(capabilities: dict, fixture: dict) -> list[str]:
    errors: list[str] = []
    if capabilities.get("schema") != "pulp.css-native-capabilities" or capabilities.get("version") != 1:
        errors.append("capability schema/version is not supported")
    if fixture.get("schema") != "pulp.native-migration-fixture" or fixture.get("version") != 1:
        errors.append("fixture schema/version is not supported")
    if fixture.get("heldOut") is not True:
        errors.append("fixture must be marked heldOut")
    fixture_id = fixture.get("id")
    features = capabilities.get("features")
    if not isinstance(features, dict):
        return errors + ["capabilities.features must be an object"]

    required_invariants: set[str] = set()
    geometry_limit = float("inf")
    paint_limit = float("inf")
    for semantic in fixture.get("reachableSemantics", []):
        feature = features.get(semantic)
        if not isinstance(feature, dict):
            errors.append(f"reachable semantic has no capability row: {semantic}")
            continue
        outcome = feature.get("outcome")
        if outcome not in OUTCOMES:
            errors.append(f"invalid outcome for {semantic}: {outcome!r}")
            continue
        if outcome == "unsupported":
            errors.append(f"reachable semantic is unsupported: {semantic}")
            continue
        if not feature.get("realization"):
            errors.append(f"allowed semantic has no realization: {semantic}")
        if fixture_id not in feature.get("fixtures", []):
            errors.append(f"capability row does not cite fixture {fixture_id}: {semantic}")
        tolerance = feature.get("tolerance")
        if not isinstance(tolerance, dict):
            errors.append(f"allowed semantic has no tolerance: {semantic}")
        else:
            geometry_limit = min(geometry_limit, float(tolerance.get("geometryPx", -1)))
            paint_limit = min(paint_limit, float(tolerance.get("paintDelta", -1)))
        invariants = set(feature.get("invariants", []))
        unknown = invariants - INVARIANTS
        if unknown:
            errors.append(f"unknown invariants for {semantic}: {sorted(unknown)}")
        required_invariants.update(invariants)

    results = fixture.get("invariantResults", {})
    observed = {name for name, passed in results.items() if passed is True} if isinstance(results, dict) else set()
    missing = required_invariants - observed
    if missing:
        errors.append(f"fixture misses required invariants: {sorted(missing)}")
    for index, sample in enumerate(fixture.get("samples", [])):
        if float(sample.get("maxGeometryDeltaPx", float("inf"))) > geometry_limit:
            errors.append(f"sample {index} exceeds geometry tolerance {geometry_limit}")
        if float(sample.get("paintDelta", float("inf"))) > paint_limit:
            errors.append(f"sample {index} exceeds paint tolerance {paint_limit}")
        for key in ("width", "dpr", "zoom", "locale", "fontMetrics", "projection"):
            if key not in sample:
                errors.append(f"sample {index} misses probe dimension: {key}")
    source_contract = fixture.get("sourceContract", {})
    for breakpoint in source_contract.get("breakpoints", []) if isinstance(source_contract, dict) else []:
        if breakpoint.get("feature") != "min-width":
            errors.append(f"unsupported breakpoint probe: {breakpoint.get('feature')!r}")
            continue
        threshold = breakpoint.get("valuePx")
        if not isinstance(threshold, (int, float)):
            errors.append("min-width breakpoint must provide numeric valuePx")
            continue
        for index, sample in enumerate(fixture.get("samples", [])):
            expected = breakpoint.get("wide") if sample.get("width", -1) >= threshold else breakpoint.get("narrow")
            if sample.get("projection") != expected:
                errors.append(f"sample {index} has wrong breakpoint projection: expected {expected}")
    return errors


def validate_catalog_references(capabilities: dict, catalog: dict) -> list[str]:
    errors: list[str] = []
    rows = catalog.get("yoga", {})
    for semantic, feature in capabilities.get("features", {}).items():
        catalog_id = feature.get("catalogId")
        if catalog_id is not None and catalog_id not in rows:
            errors.append(f"unknown Yoga catalog row for {semantic}: {catalog_id}")
        if feature.get("outcome") not in OUTCOMES:
            errors.append(f"invalid outcome for {semantic}: {feature.get('outcome')!r}")
        platform = feature.get("platform", capabilities.get("platform"))
        if not isinstance(platform, dict) or not platform.get("os") or not platform.get("minimum"):
            errors.append(f"missing platform/version constraint: {semantic}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--capabilities", type=Path, default=Path("compat/yoga-native-migration-v1.json"))
    args = parser.parse_args()
    try:
        capabilities = load(args.capabilities)
        catalog_path = args.capabilities.parent.parent / capabilities.get("catalog", "")
        errors = validate_catalog_references(capabilities, load(catalog_path))
        errors.extend(validate(capabilities, load(args.fixture)))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"native-migration: invalid input: {exc}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"native-migration: {error}", file=sys.stderr)
        return 1
    print(f"native-migration: PASS {args.fixture}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
