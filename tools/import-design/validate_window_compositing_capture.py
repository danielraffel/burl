#!/usr/bin/env python3
"""Reject source-window captures whose root occludes an intended backdrop.

This is deliberately separate from capture and lowering. It compares a source
window contract with the observed Design IR root and an optional, provenance-
bearing capture-state receipt. It never rewrites paint or assumes product-
specific host APIs, selectors, colors, or preference names.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "import-validation"))
from host_environment_receipt import validate_host_environment

CONTRACT_SCHEMA = "burl-source-window-contract-v1"
STATE_SCHEMA = "burl-capture-environment-state-v1"
OPAQUE_STATE = "opaque-preference"
TRANSPARENT_STATE = "transparent-preference"


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: root must be an object")
    return value


def backdrop_requested(contract: dict[str, Any]) -> bool:
    projection = contract.get("projection")
    observations = contract.get("observations")
    if not isinstance(projection, dict) or not isinstance(observations, dict):
        return False
    effect = projection.get("backdropEffect")
    return (
        projection.get("transparent") is True
        or observations.get("transparent") is True
        or (isinstance(effect, str) and effect not in {"", "none"})
    )


def _parse_alpha(color: Any) -> float | None:
    if not isinstance(color, str):
        return 0.0 if color is None else None
    value = color.strip().lower()
    if value == "transparent":
        return 0.0
    if re.fullmatch(r"#[0-9a-f]{3}", value) or re.fullmatch(r"#[0-9a-f]{6}", value):
        return 1.0
    if re.fullmatch(r"#[0-9a-f]{4}", value):
        return int(value[-1] * 2, 16) / 255.0
    if re.fullmatch(r"#[0-9a-f]{8}", value):
        return int(value[-2:], 16) / 255.0
    match = re.fullmatch(r"rgba?\((.*)\)", value)
    if match:
        body = match.group(1)
        alpha: str | None = None
        if "/" in body:
            _channels, alpha = body.rsplit("/", 1)
            alpha = alpha.strip()
        else:
            parts = [part.strip() for part in body.split(",")]
            if len(parts) == 4:
                alpha = parts[-1]
            elif value.startswith("rgb(") and len(parts) == 3:
                return 1.0
        if alpha is not None:
            try:
                parsed = float(alpha[:-1]) / 100.0 if alpha.endswith("%") else float(alpha)
            except ValueError:
                return None
            return parsed if math.isfinite(parsed) and 0.0 <= parsed <= 1.0 else None
    return None


def _root_fills_window(root: dict[str, Any]) -> bool | None:
    layout = root.get("layout")
    if not isinstance(layout, dict):
        return None
    width_fill = layout.get("widthMode") == "fill"
    height_fill = layout.get("heightMode") == "fill"
    responsive = root.get("responsive")
    if isinstance(responsive, dict):
        horizontal = responsive.get("horizontal")
        vertical = responsive.get("vertical")
        width_fill = width_fill or isinstance(horizontal, dict) and horizontal.get("kind") == "fill"
        height_fill = height_fill or isinstance(vertical, dict) and vertical.get("kind") == "fill"
    return width_fill and height_fill


def _validate_opaque_preference_receipt(receipt: Any) -> list[str]:
    if not isinstance(receipt, dict):
        return ["opaque covering root requires a capture-environment state receipt"]
    errors: list[str] = []
    if receipt.get("schema") != STATE_SCHEMA:
        errors.append(f"capture state schema must be {STATE_SCHEMA}")
    if receipt.get("surfaceState") != OPAQUE_STATE:
        errors.append(f"opaque covering root requires surfaceState={OPAQUE_STATE}")
    host = receipt.get("hostEnvironment")
    errors.extend(validate_host_environment(host))
    predicate = receipt.get("rootStatePredicate")
    if not isinstance(predicate, dict) or predicate.get("status") != "passed":
        errors.append("opaque preference requires a passed source-owned root-state predicate")
    elif not isinstance(predicate.get("declaration"), str) or not predicate["declaration"].strip():
        errors.append("root-state predicate requires a non-empty manifest declaration")
    return errors


def validate(
    contract: dict[str, Any],
    observed_ir: dict[str, Any],
    capture_state: dict[str, Any] | None = None,
) -> list[str]:
    errors: list[str] = []
    if contract.get("schema") != CONTRACT_SCHEMA:
        return [f"source window contract schema must be {CONTRACT_SCHEMA}"]
    if not backdrop_requested(contract):
        return []

    root = observed_ir.get("root")
    if not isinstance(root, dict):
        return ["observed Design IR requires an object root"]
    style = root.get("style")
    if not isinstance(style, dict):
        return ["observed Design IR root requires a style object"]
    alpha = _parse_alpha(style.get("backgroundColor"))
    if alpha is None:
        errors.append("transparent/backdrop window root background alpha is unparseable")
        return errors

    layers = style.get("backgroundLayers", [])
    if not isinstance(layers, list):
        errors.append("root backgroundLayers must be an array")
        return errors
    fills = _root_fills_window(root)
    if alpha >= 0.999 or layers:
        if fills is None:
            errors.append("cannot prove an opaque/layered root does not cover the transparent window")
            return errors
        if fills:
            errors.extend(_validate_opaque_preference_receipt(capture_state))
    elif capture_state is not None:
        if capture_state.get("schema") != STATE_SCHEMA:
            errors.append(f"capture state schema must be {STATE_SCHEMA}")
        if capture_state.get("surfaceState") not in {TRANSPARENT_STATE, OPAQUE_STATE}:
            errors.append("capture state surfaceState is unsupported")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate imported root compositing against a source window contract",
    )
    parser.add_argument("source_window", type=Path)
    parser.add_argument("observed_ir", type=Path)
    parser.add_argument("--capture-state", type=Path)
    args = parser.parse_args()
    try:
        errors = validate(
            load(args.source_window),
            load(args.observed_ir),
            load(args.capture_state) if args.capture_state else None,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"window-compositing-capture: invalid input: {exc}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"window-compositing-capture: {error}", file=sys.stderr)
        return 1
    print(f"window-compositing-capture: PASS {args.observed_ir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
