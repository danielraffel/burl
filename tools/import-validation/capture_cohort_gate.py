#!/usr/bin/env python3
"""Reject visual comparisons whose artifacts do not share capture provenance."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from host_environment_receipt import validate_host_environment


SCHEMA = "pulp-parity-capture-evidence-v1"
COMPARISON_FIELDS = (
    "source.identity",
    "source.revision",
    "route",
    "viewport.width",
    "viewport.height",
    "viewport.deviceScaleFactor",
    "applicationState",
    "window.transparent",
    "window.effect",
    "sourceCapture.sha256",
    "sourceCapture.hostEnvironment",
)


class EvidenceError(ValueError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _lookup(document: dict[str, Any], dotted: str) -> Any:
    value: Any = document
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            raise EvidenceError(f"missing required field {dotted}")
        value = value[part]
    return value


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise EvidenceError(f"{field} must be a lowercase sha256")
    return value


def load_evidence(path: Path, artifact: Path) -> dict[str, Any]:
    if not path.is_file():
        raise EvidenceError(f"evidence file not found: {path}")
    if not artifact.is_file():
        raise EvidenceError(f"artifact file not found: {artifact}")
    try:
        document = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceError(f"cannot read evidence {path}: {error}") from error
    if not isinstance(document, dict) or document.get("schema") != SCHEMA:
        raise EvidenceError(f"evidence must use schema {SCHEMA}")
    for field in COMPARISON_FIELDS:
        value = _lookup(document, field)
        if value is None or value == "":
            raise EvidenceError(f"required field {field} is empty")
    for field in ("source.identity", "source.revision", "route", "window.effect"):
        if not isinstance(_lookup(document, field), str):
            raise EvidenceError(f"{field} must be a string")
    for field in ("viewport.width", "viewport.height"):
        value = _lookup(document, field)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise EvidenceError(f"{field} must be a positive integer")
    scale = _lookup(document, "viewport.deviceScaleFactor")
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or scale <= 0:
        raise EvidenceError("viewport.deviceScaleFactor must be a positive number")
    if not isinstance(_lookup(document, "applicationState"), dict):
        raise EvidenceError("applicationState must be an object")
    if not isinstance(_lookup(document, "window.transparent"), bool):
        raise EvidenceError("window.transparent must be a boolean")
    declared = _require_sha256(_lookup(document, "artifact.sha256"), "artifact.sha256")
    observed = _sha256(artifact)
    if declared != observed:
        raise EvidenceError(
            f"artifact freshness mismatch: declared {declared}, observed {observed}"
        )
    _require_sha256(
        _lookup(document, "sourceCapture.sha256"), "sourceCapture.sha256"
    )
    host_errors = validate_host_environment(
        _lookup(document, "sourceCapture.hostEnvironment")
    )
    if host_errors:
        raise EvidenceError(f"invalid sourceCapture.hostEnvironment: {host_errors[0]}")
    return document


def compare_cohort(
    reference: dict[str, Any], candidate: dict[str, Any]
) -> dict[str, Any]:
    mismatches = []
    for field in COMPARISON_FIELDS:
        reference_value = _lookup(reference, field)
        candidate_value = _lookup(candidate, field)
        if reference_value != candidate_value:
            mismatches.append(
                {
                    "field": field,
                    "reference": reference_value,
                    "candidate": candidate_value,
                }
            )
    return {
        "schema": "pulp-parity-capture-cohort-report-v1",
        "comparable": not mismatches,
        "classification": "same-capture-cohort" if not mismatches else "invalid-capture-cohort",
        "mismatches": mismatches,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-artifact", type=Path, required=True)
    parser.add_argument("--reference-evidence", type=Path, required=True)
    parser.add_argument("--candidate-artifact", type=Path, required=True)
    parser.add_argument("--candidate-evidence", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    try:
        reference = load_evidence(args.reference_evidence, args.reference_artifact)
        candidate = load_evidence(args.candidate_evidence, args.candidate_artifact)
        report = compare_cohort(reference, candidate)
    except EvidenceError as error:
        report = {
            "schema": "pulp-parity-capture-cohort-report-v1",
            "comparable": False,
            "classification": "invalid-capture-evidence",
            "errors": [str(error)],
            "mismatches": [],
        }
        exit_code = 2
    else:
        exit_code = 0 if report["comparable"] else 1

    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(payload)
    sys.stdout.write(payload)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
