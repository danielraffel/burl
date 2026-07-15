#!/usr/bin/env python3
"""Compare captured DOM element geometry and interactivity with native layout.

The comparison is keyed by the source identities preserved by the importer. It
therefore detects missing or misplaced controls that broad screenshot regions
can hide, without encoding any application-specific selectors or coordinates.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "pulp-layout-anchor-report-v1"
ACTIONABLE_TAGS = {"a", "button", "input", "select", "textarea", "summary"}
ACTIONABLE_ROLES = {
    "button", "checkbox", "combobox", "link", "listbox", "menuitem",
    "option", "radio", "slider", "switch", "tab", "textbox",
}
STRUCTURAL_TAGS = {
    "a", "aside", "button", "div", "footer", "form", "header", "input",
    "li", "main", "nav", "ol", "section", "select", "summary", "svg",
    "table", "tbody", "td", "textarea", "tfoot", "th", "thead", "tr", "ul",
}


class AnchorError(ValueError):
    pass


def _walk(node: dict[str, Any]) -> Iterable[dict[str, Any]]:
    yield node
    for child in node.get("children", []):
        if isinstance(child, dict):
            yield from _walk(child)


def _source_rect(node: dict[str, Any]) -> dict[str, float]:
    rect = node.get("rect") or {}
    try:
        return {key: float(rect[key]) for key in ("x", "y", "width", "height")}
    except (KeyError, TypeError, ValueError) as error:
        raise AnchorError(f"invalid source rect for {node.get('sourceId')!r}") from error


def _native_rect(node: dict[str, Any]) -> dict[str, float]:
    rect = node.get("rect") or {}
    try:
        return {
            "x": float(rect["x"]), "y": float(rect["y"]),
            "width": float(rect["w"]), "height": float(rect["h"]),
        }
    except (KeyError, TypeError, ValueError) as error:
        raise AnchorError(f"invalid native rect for {node.get('id')!r}") from error


def _native_source_id(identifier: Any) -> str | None:
    if not isinstance(identifier, str):
        return None
    marker = "observed-dom:"
    offset = identifier.rfind(marker)
    return identifier[offset + len(marker):] if offset >= 0 else None


def _visible_source(node: dict[str, Any], viewport: dict[str, Any]) -> bool:
    style = node.get("computedStyle") or {}
    rect = _source_rect(node)
    width = float(viewport["width"])
    height = float(viewport["height"])
    intersects_viewport = (
        rect["x"] < width and rect["y"] < height
        and rect["x"] + rect["width"] > 0
        and rect["y"] + rect["height"] > 0
    )
    return (
        style.get("display") != "none"
        and style.get("visibility") not in {"hidden", "collapse"}
        and rect["width"] > 0
        and rect["height"] > 0
        and intersects_viewport
    )


def _requires_native_anchor(node: dict[str, Any]) -> bool:
    """Whether the DOM box must survive as an independently addressable node.

    Inline text runs and SVG leaf geometry may be folded into a Label or vector
    resource. Structural boxes, vector roots, and controls may not be folded
    away because layout, clipping, painting, or interaction depends on them.
    """
    return str(node.get("tagName", "")).lower() in STRUCTURAL_TAGS or _actionable_source(node)


def _actionable_source(node: dict[str, Any]) -> bool:
    attributes = node.get("attributes") or {}
    role = str(attributes.get("role", "")).lower()
    tag = str(node.get("tagName", "")).lower()
    tabindex = attributes.get("tabindex")
    disabled = attributes.get("disabled") is not None or attributes.get("aria-disabled") == "true"
    return not disabled and (
        tag in ACTIONABLE_TAGS
        or role in ACTIONABLE_ROLES
        or (tabindex is not None and str(tabindex) != "-1")
    )


def _rect_error(source: dict[str, float], native: dict[str, float]) -> dict[str, float]:
    deltas = {key: native[key] - source[key] for key in source}
    max_abs = max(abs(value) for value in deltas.values())
    source_area = source["width"] * source["height"]
    native_area = native["width"] * native["height"]
    area_ratio = native_area / source_area if source_area else math.inf
    return {"deltas": deltas, "maxAbsDelta": max_abs, "areaRatio": area_ratio}


def _rect_sort_key(rect: dict[str, float]) -> tuple[float, float, float, float]:
    return tuple(rect[key] for key in ("x", "y", "width", "height"))


def _intersection(a: dict[str, float], b: dict[str, float]) -> dict[str, float]:
    left = max(a["x"], b["x"])
    top = max(a["y"], b["y"])
    right = min(a["x"] + a["width"], b["x"] + b["width"])
    bottom = min(a["y"] + a["height"], b["y"] + b["height"])
    return {
        "x": left, "y": top,
        "width": max(0.0, right - left),
        "height": max(0.0, bottom - top),
    }


def _has_area(rect: dict[str, float]) -> bool:
    return rect["width"] > 0.0 and rect["height"] > 0.0


def _native_aux_rect(value: Any) -> dict[str, float] | None:
    """Parse a native snapshot rect without turning malformed evidence into zeroes."""
    if not isinstance(value, dict):
        return None
    try:
        return {
            "x": float(value["x"]), "y": float(value["y"]),
            "width": float(value["w"]), "height": float(value["h"]),
        }
    except (KeyError, TypeError, ValueError):
        return None


def _effective_native_clip(node: dict[str, Any], viewport: dict[str, Any]) -> dict[str, float]:
    effective = {
        "x": 0.0, "y": 0.0,
        "width": float(viewport["w"]), "height": float(viewport["h"]),
    }
    clipping = node.get("clipping") or {}
    declared = _native_aux_rect(clipping.get("rect"))
    return _intersection(effective, declared) if declared is not None else effective


def _valid_hit_region(node: dict[str, Any], viewport: dict[str, Any]) -> bool:
    """Require a positive hit surface inside both node geometry and effective clip."""
    node_rect = _native_rect(node)
    effective = _intersection(node_rect, _effective_native_clip(node, viewport))
    if not _has_area(effective):
        return False
    for region in node.get("hit_regions") or []:
        hit = _native_aux_rect(region.get("rect") if isinstance(region, dict) else None)
        if hit is not None and _has_area(_intersection(hit, effective)):
            return True
    return False


def _pair_sort_key(source: dict[str, Any], native: dict[str, Any]) -> tuple[Any, ...]:
    """Choose geometry evidence deterministically, independent of capture ordering."""
    source_rect = _source_rect(source)
    native_rect = _native_rect(native)
    error = _rect_error(source_rect, native_rect)
    sum_abs = sum(abs(value) for value in error["deltas"].values())
    area_distance = abs(math.log(error["areaRatio"])) if error["areaRatio"] > 0.0 else math.inf
    return (
        error["maxAbsDelta"], sum_abs, area_distance,
        _rect_sort_key(source_rect), _rect_sort_key(native_rect),
        str(source.get("tagName", "")), str(native.get("kind", "")),
        json.dumps(source, sort_keys=True, separators=(",", ":")),
        json.dumps(native, sort_keys=True, separators=(",", ":")),
    )


def _select_pair(
    sources: list[dict[str, Any]], natives: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not sources or not natives:
        raise AnchorError("cannot select an anchor pair from an empty candidate set")
    return min(
        ((source, native) for source in sources for native in natives),
        key=lambda pair: _pair_sort_key(*pair),
    )


def compare(source_document: dict[str, Any], native_document: dict[str, Any], tolerance: float) -> dict[str, Any]:
    root = source_document.get("observedDom")
    if not isinstance(root, dict):
        raise AnchorError("source document is missing observedDom")
    viewport = native_document.get("viewport") or {}
    source_viewport = source_document.get("policy", {}).get("viewport") or {}
    if (source_viewport.get("width"), source_viewport.get("height")) != (viewport.get("w"), viewport.get("h")):
        raise AnchorError(
            "viewport mismatch: source "
            f"{source_viewport.get('width')}x{source_viewport.get('height')} vs native "
            f"{viewport.get('w')}x{viewport.get('h')}"
        )

    normalized_viewport = {"width": viewport.get("w"), "height": viewport.get("h")}
    sources: dict[str, list[dict[str, Any]]] = {}
    for node in _walk(root):
        identifier = node.get("sourceId")
        if not isinstance(identifier, str) or not _visible_source(node, normalized_viewport):
            continue
        sources.setdefault(identifier, []).append(node)

    duplicate_source_details = [
        {
            "sourceId": identifier,
            "count": len(candidates),
            "sourceRects": sorted((_source_rect(node) for node in candidates), key=_rect_sort_key),
        }
        for identifier, candidates in sources.items() if len(candidates) > 1
    ]
    duplicate_source_details.sort(key=lambda item: item["sourceId"])

    natives: dict[str, list[dict[str, Any]]] = {}
    for node in native_document.get("nodes", []):
        identifier = _native_source_id(node.get("id"))
        # Application-state variants coexist in the retained tree but are not
        # the active capture. Compare only the unprefixed materialization.
        if identifier and str(node.get("id", "")).startswith("observed-dom:") and node.get("visible", True):
            natives.setdefault(identifier, []).append(node)

    missing: list[dict[str, Any]] = []
    duplicate_native: list[dict[str, Any]] = []
    geometry: list[dict[str, Any]] = []
    hit_failures: list[dict[str, Any]] = []
    matched = 0
    identity_failures: list[dict[str, Any]] = []
    for identifier, source_candidates in sources.items():
        candidates = natives.get(identifier, [])
        required_sources = [source for source in source_candidates if _requires_native_anchor(source)]
        if not candidates and required_sources:
            source = min(required_sources, key=lambda node: (_rect_sort_key(_source_rect(node)), str(node.get("tagName", ""))))
            missing.append({"sourceId": identifier, "tagName": source.get("tagName"), "rect": _source_rect(source)})
            continue
        if not candidates:
            continue
        source, native = _select_pair(source_candidates, candidates)
        if len(candidates) > 1:
            duplicate_native.append({
                "sourceId": identifier,
                "count": len(candidates),
                "nativeRects": sorted((_native_rect(node) for node in candidates), key=_rect_sort_key),
                "selectedNativeRect": _native_rect(native),
            })
        if len(source_candidates) > 1 or len(candidates) > 1:
            identity_failures.append({
                "sourceId": identifier,
                "sourceCount": len(source_candidates),
                "nativeCount": len(candidates),
                "selectedSourceRect": _source_rect(source),
                "selectedNativeRect": _native_rect(native),
            })
        matched += 1
        source_rect = _source_rect(source)
        native_rect = _native_rect(native)
        error = _rect_error(source_rect, native_rect)
        if error["maxAbsDelta"] > tolerance:
            geometry.append({
                "sourceId": identifier, "tagName": source.get("tagName"),
                "nativeKind": native.get("kind"), "sourceRect": source_rect,
                "nativeRect": native_rect, **error,
            })
        if _actionable_source(source) and not _valid_hit_region(native, viewport):
            hit_failures.append({
                "sourceId": identifier, "tagName": source.get("tagName"),
                "role": (source.get("attributes") or {}).get("role"),
                "nativeKind": native.get("kind"), "rect": native_rect,
                "reason": "no hit region intersects node geometry and effective clip/viewport",
            })

    geometry.sort(key=lambda item: (-item["maxAbsDelta"], item["sourceId"]))
    missing.sort(key=lambda item: item["sourceId"])
    duplicate_native.sort(key=lambda item: item["sourceId"])
    identity_failures.sort(key=lambda item: item["sourceId"])
    hit_failures.sort(key=lambda item: item["sourceId"])
    passed = not (duplicate_source_details or missing or duplicate_native or geometry or hit_failures)
    return {
        "schema": SCHEMA,
        "passed": passed,
        "tolerancePx": tolerance,
        "viewport": {"width": viewport.get("w"), "height": viewport.get("h")},
        "summary": {
            "visibleSourceAnchors": len(sources), "matchedAnchors": matched,
            "missingAnchors": len(missing), "duplicateSourceIds": len(duplicate_source_details),
            "duplicateNativeIds": len(duplicate_native), "geometryFailures": len(geometry),
            "hitRegionFailures": len(hit_failures), "identityFailures": len(identity_failures),
        },
        "duplicateSourceIds": [item["sourceId"] for item in duplicate_source_details],
        "duplicateSourceDetails": duplicate_source_details,
        "missingAnchors": missing,
        "duplicateNativeIds": duplicate_native,
        "identityFailures": identity_failures,
        "geometryFailures": geometry,
        "hitRegionFailures": hit_failures,
    }


def regions_for_failures(report: dict[str, Any], padding: float, threshold: float) -> dict[str, Any]:
    width = float(report["viewport"]["width"])
    height = float(report["viewport"]["height"])
    regions: dict[str, Any] = {}
    failures = (
        report["missingAnchors"] + report["geometryFailures"]
        + report["hitRegionFailures"] + report.get("identityFailures", [])
    )
    seen: set[str] = set()
    for index, failure in enumerate(failures):
        identifier = failure["sourceId"]
        if identifier in seen:
            continue
        seen.add(identifier)
        rect = failure.get("sourceRect") or failure.get("rect") or failure.get("selectedSourceRect")
        if not rect:
            continue
        left = max(0.0, rect["x"] - padding)
        top = max(0.0, rect["y"] - padding)
        right = min(width, rect["x"] + rect["width"] + padding)
        bottom = min(height, rect["y"] + rect["height"] + padding)
        regions[f"anchor_{index:04d}"] = {
            "x": left / width, "y": top / height,
            "w": max(1.0, right - left) / width,
            "h": max(1.0, bottom - top) / height,
            "threshold": threshold, "notes": identifier,
        }
    return regions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--native-layout", type=Path, required=True)
    parser.add_argument("--tolerance", type=float, default=1.0)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--regions", type=Path)
    parser.add_argument("--region-padding", type=float, default=3.0)
    parser.add_argument("--region-threshold", type=float, default=0.90)
    args = parser.parse_args()
    try:
        report = compare(json.loads(args.source.read_text()), json.loads(args.native_layout.read_text()), args.tolerance)
    except (OSError, json.JSONDecodeError, AnchorError) as error:
        report = {"schema": SCHEMA, "passed": False, "errors": [str(error)]}
        code = 2
    else:
        code = 0 if report["passed"] else 1
        if args.regions:
            args.regions.parent.mkdir(parents=True, exist_ok=True)
            args.regions.write_text(json.dumps(regions_for_failures(report, args.region_padding, args.region_threshold), indent=2, sort_keys=True) + "\n")
    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(payload)
    sys.stdout.write(payload)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
