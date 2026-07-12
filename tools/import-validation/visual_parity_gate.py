#!/usr/bin/env python3
"""Fail-closed manifest gate for source-versus-native visual parity evidence."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
from typing import Any

SCHEMA = "pulp-visual-parity-manifest-v1"
BACKDROP_POLICIES = {"opaque-tier", "pinned-backdrop", "reviewed-mask"}


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_time(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    return parsed


def load_image(path: Path):
    from PIL import Image
    return Image.open(path).convert("RGB")


def resolve_owned(base: Path, relative: str) -> Path:
    root = base.resolve()
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"artifact escapes manifest directory: {relative}") from exc
    return target


def artifact_errors(base: Path, artifact: dict, label: str,
                    now: dt.datetime, max_age: int) -> tuple[list[str], Path | None]:
    errors: list[str] = []
    if not isinstance(artifact, dict):
        return [f"{label}: artifact must be an object"], None
    required = {"path", "sha256", "width", "height", "dpr", "backend",
                "fonts", "captured_at", "revision"}
    missing = sorted(required - artifact.keys())
    if missing:
        return [f"{label}: missing {', '.join(missing)}"], None
    try:
        path = resolve_owned(base, artifact["path"])
    except (TypeError, ValueError) as exc:
        return [f"{label}: {exc}"], None
    if not path.is_file():
        return [f"{label}: missing artifact {path}"], None
    if file_hash(path) != artifact["sha256"]:
        errors.append(f"{label}: stale hash")
    if (not isinstance(artifact["width"], int) or isinstance(artifact["width"], bool)
            or artifact["width"] <= 0 or not isinstance(artifact["height"], int)
            or isinstance(artifact["height"], bool) or artifact["height"] <= 0):
        errors.append(f"{label}: dimensions must be positive integers")
    try:
        image = load_image(path)
        if image.size != (artifact["width"], artifact["height"]):
            errors.append(f"{label}: declared dimensions do not match PNG")
    except Exception as exc:
        errors.append(f"{label}: cannot decode PNG: {exc}")
    try:
        age = (now - parse_time(artifact["captured_at"])).total_seconds()
        if age < 0 or age > max_age:
            errors.append(f"{label}: stale capture age")
    except (TypeError, ValueError) as exc:
        errors.append(f"{label}: invalid captured_at: {exc}")
    if not isinstance(artifact["backend"], str) or not artifact["backend"]:
        errors.append(f"{label}: backend must be pinned")
    if not isinstance(artifact["revision"], str) or not artifact["revision"]:
        errors.append(f"{label}: revision must be pinned")
    if (not isinstance(artifact["dpr"], (int, float))
            or isinstance(artifact["dpr"], bool) or artifact["dpr"] <= 0):
        errors.append(f"{label}: DPR must be positive")
    if not isinstance(artifact["fonts"], list) or not artifact["fonts"]:
        errors.append(f"{label}: fonts must be pinned")
    else:
        for font in artifact["fonts"]:
            if not isinstance(font, dict) or not {"family", "path", "sha256"}.issubset(font):
                errors.append(f"{label}: malformed font pin")
                continue
            try:
                font_path = resolve_owned(base, font["path"])
                if not font_path.is_file() or file_hash(font_path) != font["sha256"]:
                    errors.append(f"{label}: font substitution or stale font {font['family']}")
            except (TypeError, ValueError):
                errors.append(f"{label}: invalid font path")
    return errors, path


def font_identity(base: Path, artifact: dict) -> list[tuple[str, str]]:
    fonts = artifact.get("fonts", [])
    if not isinstance(fonts, list):
        return []
    selected: set[str] = set()
    canonical = lambda family: (".SF NS" if family in {".AppleSystemUIFont", ".SF NS", "SFNS"}
                                else "Menlo" if family.startswith("Menlo") else family)
    for font in fonts:
        if not isinstance(font, dict):
            continue
        try:
            receipt = json.loads(resolve_owned(base, font.get("path", "")).read_text())
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            continue
        if isinstance(receipt.get("usedFaces"), list):
            selected.update(canonical(face.get("family", "")) for face in receipt["usedFaces"]
                            if isinstance(face, dict) and face.get("family"))
        if isinstance(receipt.get("records"), list):
            selected.update(canonical(record.get("selected_family", "")) for record in receipt["records"]
                            if isinstance(record, dict) and record.get("selected_family"))
    if selected:
        return sorted((family, "runtime-selected") for family in selected)
    return sorted((font.get("family", ""), font.get("sha256", ""))
                  for font in fonts if isinstance(font, dict))


def rect_valid(rect: dict, width: int, height: int) -> bool:
    return (isinstance(rect, dict) and all(isinstance(rect.get(k), int)
            and not isinstance(rect.get(k), bool) for k in ("x", "y", "width", "height"))
            and rect["x"] >= 0 and rect["y"] >= 0 and rect["width"] > 0
            and rect["height"] > 0 and rect["x"] + rect["width"] <= width
            and rect["y"] + rect["height"] <= height)


def similarity(reference, candidate, rect: dict, masks: list[dict]) -> tuple[float, int]:
    ref = reference.load()
    cand = candidate.load()
    total = 0.0
    count = 0
    for y in range(rect["y"], rect["y"] + rect["height"]):
        for x in range(rect["x"], rect["x"] + rect["width"]):
            if any(mask["rect"]["x"] <= x < mask["rect"]["x"] + mask["rect"]["width"]
                   and mask["rect"]["y"] <= y < mask["rect"]["y"] + mask["rect"]["height"]
                   for mask in masks):
                continue
            a, b = ref[x, y], cand[x, y]
            total += math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))
            count += 1
    if count == 0:
        return 0.0, 0
    return 1.0 - total / (count * math.sqrt(3 * 255 * 255)), count


def validate_manifest(path: Path, now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    manifest = json.loads(path.read_text())
    errors: list[str] = []
    if manifest.get("schema") != SCHEMA:
        return {"ok": False, "errors": ["unsupported manifest schema"], "regions": {}}
    base = path.parent
    max_age = manifest.get("freshness", {}).get("max_age_seconds")
    if not isinstance(max_age, int) or isinstance(max_age, bool) or max_age <= 0:
        return {"ok": False, "errors": ["freshness.max_age_seconds must be positive"], "regions": {}}
    source = manifest.get("source", {})
    candidate = manifest.get("candidate", {})
    source_errors, source_path = artifact_errors(base, source, "source", now, max_age)
    candidate_errors, candidate_path = artifact_errors(base, candidate, "candidate", now, max_age)
    errors.extend(source_errors + candidate_errors)
    if not isinstance(source, dict):
        source = {}
    if not isinstance(candidate, dict):
        candidate = {}
    if source.get("width") != candidate.get("width") or source.get("height") != candidate.get("height"):
        errors.append("exact geometry mismatch")
    if source.get("dpr") != candidate.get("dpr"):
        errors.append("DPR mismatch")
    if font_identity(base, source) != font_identity(base, candidate):
        errors.append("font substitution: source and candidate font pins differ")
    if candidate.get("backend") not in {"skia-dawn-metal", "skia-dawn-d3d", "skia-dawn-vulkan"}:
        errors.append("candidate backend is not an approved Skia/Dawn backend")

    provenance = manifest.get("baseline_provenance", {})
    if not all(isinstance(provenance.get(k), str) and provenance[k]
               for k in ("captured_by", "source_revision", "renderer_version",
                         "regeneration_reason", "reviewed_by", "review_commit")):
        errors.append("baseline regeneration provenance is incomplete")
    if provenance.get("source_revision") != source.get("revision"):
        errors.append("baseline provenance source revision mismatch")
    if provenance.get("renderer_version") != source.get("backend"):
        errors.append("baseline provenance renderer mismatch")

    backdrop = manifest.get("backdrop", {})
    if backdrop.get("policy") not in BACKDROP_POLICIES:
        errors.append("invalid backdrop policy")
    if not isinstance(backdrop.get("tier"), str) or not backdrop["tier"]:
        errors.append("backdrop tier must be pinned")
    if backdrop.get("policy") == "pinned-backdrop":
        try:
            backdrop_path = resolve_owned(base, backdrop["path"])
            if file_hash(backdrop_path) != backdrop.get("sha256"):
                errors.append("stale pinned backdrop hash")
        except (KeyError, OSError, TypeError, ValueError):
            errors.append("pinned backdrop is incomplete")

    width = source.get("width", 0)
    height = source.get("height", 0)
    if not isinstance(width, int) or isinstance(width, bool):
        width = 0
    if not isinstance(height, int) or isinstance(height, bool):
        height = 0
    masks = manifest.get("masks", [])
    if not isinstance(masks, list):
        errors.append("masks must be an array")
        masks = []
    for index, mask in enumerate(masks):
        if not isinstance(mask, dict) or not rect_valid(mask.get("rect"), width, height):
            errors.append(f"mask {index}: invalid rectangle")
            continue
        if not all(isinstance(mask.get(k), str) and mask[k]
                   for k in ("reason", "reviewed_by", "review_commit")):
            errors.append(f"mask {index}: explicit justification and review required")
    if masks and backdrop.get("policy") != "reviewed-mask":
        errors.append("masks require reviewed-mask backdrop policy")

    thresholds = manifest.get("thresholds", {})
    if thresholds != {"metric": "normalized-rgb-l2-v1"}:
        errors.append("unsupported or mutable metric definition")
    regions = manifest.get("critical_regions", [])
    policy_value = {"thresholds": thresholds, "critical_regions": regions, "masks": masks}
    approval = manifest.get("threshold_approval", {})
    if approval.get("policy_sha256") != canonical_hash(policy_value) or not all(
            isinstance(approval.get(k), str) and approval[k]
            for k in ("reviewed_by", "review_commit", "rationale")):
        errors.append("threshold policy is unlocked or lacks review provenance")

    calibration = manifest.get("calibration", {})
    repeat_paths: dict[str, list[Path]] = {"source": [], "candidate": []}
    measured_noise: dict[str, float] = {}
    for renderer in ("source", "candidate"):
        repeats = calibration.get(f"{renderer}_repeats", [])
        if not isinstance(repeats, list) or len(repeats) < 2:
            errors.append(f"uncalibrated threshold: {renderer} requires two repeats")
            continue
        repeat_names = [item.get("path") for item in repeats if isinstance(item, dict)]
        if len(set(repeat_names)) != len(repeats):
            errors.append(f"uncalibrated threshold: {renderer} repeats must be distinct captures")
        primary = source if renderer == "source" else candidate
        for index, artifact in enumerate(repeats):
            artifact_issue, repeat_path = artifact_errors(
                base, artifact, f"calibration.{renderer}[{index}]", now, max_age)
            errors.extend(artifact_issue)
            if (artifact.get("width"), artifact.get("height"), artifact.get("dpr"),
                    artifact.get("backend"), font_identity(base, artifact)) != (
                    primary.get("width"), primary.get("height"), primary.get("dpr"),
                    primary.get("backend"), font_identity(base, primary)):
                errors.append(f"calibration.{renderer}[{index}]: capture contract mismatch")
            if repeat_path:
                repeat_paths[renderer].append(repeat_path)
        if len(repeat_paths[renderer]) >= 2 and width > 0 and height > 0:
            first = load_image(repeat_paths[renderer][0])
            second = load_image(repeat_paths[renderer][1])
            score, _ = similarity(first, second, {
                "x": 0, "y": 0, "width": width, "height": height}, [])
            measured_noise[renderer] = score
            declared = calibration.get(f"{renderer}_minimum_pixel_similarity")
            if not isinstance(declared, (int, float)) or abs(declared - score) > 1e-8:
                errors.append(f"uncalibrated threshold: {renderer} measured noise is not pinned")

    result_regions: dict[str, dict] = {}
    if source_path and candidate_path and not source_errors and not candidate_errors:
        reference_image = load_image(source_path)
        candidate_image = load_image(candidate_path)
        if not isinstance(regions, list) or not regions:
            errors.append("at least one named critical region is required")
        else:
            seen: set[str] = set()
            for region in regions:
                name = region.get("name") if isinstance(region, dict) else None
                if not isinstance(name, str) or not name or name in seen:
                    errors.append("critical regions require unique names")
                    continue
                seen.add(name)
                if not rect_valid(region.get("rect"), width, height):
                    errors.append(f"region {name}: invalid rectangle")
                    continue
                minimum = region.get("minimum_pixel_similarity")
                if not isinstance(minimum, (int, float)) or isinstance(minimum, bool) or not 0 <= minimum <= 1:
                    errors.append(f"region {name}: invalid threshold")
                    continue
                if measured_noise and minimum > min(measured_noise.values()):
                    errors.append(f"region {name}: threshold exceeds calibrated repeatability")
                score, compared = similarity(reference_image, candidate_image, region["rect"], masks)
                region_pixels = region["rect"]["width"] * region["rect"]["height"]
                if compared < math.ceil(region_pixels * 0.9):
                    errors.append(f"region {name}: masks waive more than 10 percent")
                passed = compared > 0 and score >= minimum
                result_regions[name] = {"pixel_similarity": round(score, 8),
                                        "minimum": minimum, "pixels": compared,
                                        "passed": passed}
                if not passed:
                    errors.append(f"critical region failed: {name}")
    return {"ok": not errors, "errors": errors, "regions": result_regions,
            "measured_noise": {key: round(value, 8) for key, value in measured_noise.items()}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = validate_manifest(args.manifest)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        result = {"ok": False, "errors": [str(exc)], "regions": {}}
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
