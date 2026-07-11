#!/usr/bin/env python3
"""Validate a Burl evidence manifest without third-party dependencies."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import sys
from typing import Any

KINDS = {
    "build", "launch", "screenshot", "trace", "benchmark", "accessibility",
    "security", "opencode_integration", "architecture_review", "adversarial_review",
}
REQUIRED_KINDS = KINDS - {"adversarial_review"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def validate(data: Any, manifest_path: pathlib.Path, verify_files: bool = False) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["manifest must be a JSON object"]
    allowed = {"schema_version", "run_id", "created_at", "source", "artifacts"}
    _unknown(data, allowed, "manifest", errors)
    if data.get("schema_version") != 1:
        errors.append("schema_version must equal 1")
    if not isinstance(data.get("run_id"), str) or not RUN_ID.fullmatch(data["run_id"]):
        errors.append("run_id has an invalid format")
    try:
        value = data["created_at"]
        if not isinstance(value, str) or dt.datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError
    except (KeyError, ValueError, TypeError):
        errors.append("created_at must be an RFC 3339 timestamp with timezone")

    source = data.get("source")
    if not isinstance(source, dict):
        errors.append("source must be an object")
    else:
        _unknown(source, {"repository", "commit", "dependency_lock"}, "source", errors)
        repository = source.get("repository")
        if not isinstance(repository, str) or not repository.startswith("https://"):
            errors.append("source.repository must be an https URL")
        if not isinstance(source.get("commit"), str) or not COMMIT.fullmatch(source["commit"]):
            errors.append("source.commit must be a 40-character lowercase hex commit")
        lock = source.get("dependency_lock")
        if lock is not None and (not isinstance(lock, str) or not COMMIT.fullmatch(lock)):
            errors.append("source.dependency_lock must be a 40-character lowercase hex commit")

    artifacts = data.get("artifacts")
    if not isinstance(artifacts, list):
        errors.append("artifacts must be an array")
        return errors
    seen: set[str] = set()
    for index, artifact in enumerate(artifacts):
        prefix = f"artifacts[{index}]"
        if not isinstance(artifact, dict):
            errors.append(f"{prefix} must be an object")
            continue
        _unknown(artifact, {"kind", "path", "sha256", "status", "media_type", "summary", "metrics"}, prefix, errors)
        kind = artifact.get("kind")
        if kind not in KINDS:
            errors.append(f"{prefix}.kind is invalid")
        else:
            seen.add(kind)
        raw_path = artifact.get("path")
        safe_path: pathlib.Path | None = None
        if not isinstance(raw_path, str) or not raw_path or pathlib.PurePosixPath(raw_path).is_absolute() or ".." in pathlib.PurePosixPath(raw_path).parts:
            errors.append(f"{prefix}.path must be a safe relative POSIX path")
        else:
            safe_path = manifest_path.parent / pathlib.PurePosixPath(raw_path)
        digest = artifact.get("sha256")
        if not isinstance(digest, str) or not SHA256.fullmatch(digest):
            errors.append(f"{prefix}.sha256 must be 64 lowercase hex characters")
        if artifact.get("status") not in {"pass", "fail"}:
            errors.append(f"{prefix}.status must be pass or fail")
        metrics = artifact.get("metrics")
        if metrics is not None and (not isinstance(metrics, dict) or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in metrics.values())):
            errors.append(f"{prefix}.metrics values must be numbers")
        if verify_files and safe_path is not None:
            if not safe_path.is_file():
                errors.append(f"{prefix}.path does not exist: {raw_path}")
            elif isinstance(digest, str) and SHA256.fullmatch(digest) and _digest(safe_path) != digest:
                errors.append(f"{prefix}.sha256 does not match {raw_path}")
    missing = sorted(REQUIRED_KINDS - seen)
    if missing:
        errors.append("missing required artifact kinds: " + ", ".join(missing))
    if not ({"architecture_review", "adversarial_review"} <= seen):
        errors.append("both architecture_review and adversarial_review artifacts are required")
    return errors


def _unknown(value: dict[str, Any], allowed: set[str], prefix: str, errors: list[str]) -> None:
    for key in sorted(value.keys() - allowed):
        errors.append(f"{prefix} has unknown property: {key}")


def _digest(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=pathlib.Path)
    parser.add_argument("--verify-files", action="store_true")
    args = parser.parse_args()
    try:
        data = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    errors = validate(data, args.manifest, args.verify_files)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
