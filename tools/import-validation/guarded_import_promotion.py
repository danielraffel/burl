#!/usr/bin/env python3
"""Atomically replace canonical Design IR only after source/capture guards pass."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

THIS_DIR = Path(__file__).resolve().parent
IMPORT_DESIGN = THIS_DIR.parent / "import-design"
sys.path.insert(0, str(IMPORT_DESIGN))

from validate_window_compositing_capture import backdrop_requested, validate as validate_compositing
from host_environment_receipt import validate_host_environment

RECEIPT_SCHEMA = "burl-import-promotion-candidate-v1"
CAPTURE_SCHEMA = "pulp-runtime-source-capture-v1"
CAPTURE_META_SCHEMA = "pulp-runtime-source-capture-v1"
ROOT_PREDICATE_SCHEMA = "burl-root-state-predicate-receipt-v1"
SHA_FIELDS = (
    "candidateSha256",
    "sourceWindowSha256",
    "sourceCaptureSha256",
    "sourceCaptureManifestSha256",
    "rootStatePredicateSha256",
)


class PromotionError(ValueError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_json_sha256(value: Any) -> str:
    return sha256_bytes(json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8"))


def read_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as error:
        raise PromotionError(f"cannot read {path}: {error}") from error


def parse_object(path: Path, payload: bytes) -> dict[str, Any]:
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as error:
        raise PromotionError(f"{path} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise PromotionError(f"{path} root must be an object")
    return value


def require_sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise PromotionError(f"{label} must be a lowercase SHA-256")
    return value


def derive_host_environment(
    source_capture: dict[str, Any], source_capture_sha256: str
) -> dict[str, Any] | None:
    policy = source_capture.get("policy")
    if not isinstance(policy, dict):
        raise PromotionError("source capture policy is missing")
    mode = policy.get("hostServices")
    if mode == "recording-fake":
        return None
    if mode == "live-existing":
        host = {"mode": mode, "provenanceSha256": source_capture_sha256}
    elif mode == "declarative-projection":
        projection = policy.get("hostCapabilityProjection")
        provenance = projection.get("provenanceSha256") if isinstance(projection, dict) else None
        host = {
            "mode": mode,
            "provenanceSha256": provenance,
            "projectionReceipt": projection,
        }
    else:
        raise PromotionError(f"source capture has unsupported hostServices mode: {mode!r}")
    errors = validate_host_environment(host)
    if errors:
        raise PromotionError(f"source capture host provenance is invalid: {errors[0]}")
    return host


def validate_inputs(
    candidate_path: Path,
    candidate_bytes: bytes,
    source_window_path: Path,
    source_window_bytes: bytes,
    source_capture_path: Path,
    source_capture_bytes: bytes,
    source_capture_meta_path: Path,
    source_capture_meta_bytes: bytes,
    promotion_receipt_path: Path,
    promotion_receipt_bytes: bytes,
) -> dict[str, Any]:
    candidate = parse_object(candidate_path, candidate_bytes)
    source_window = parse_object(source_window_path, source_window_bytes)
    source_capture = parse_object(source_capture_path, source_capture_bytes)
    meta = parse_object(source_capture_meta_path, source_capture_meta_bytes)
    receipt = parse_object(promotion_receipt_path, promotion_receipt_bytes)
    if receipt.get("schema") != RECEIPT_SCHEMA:
        raise PromotionError(f"promotion receipt must use schema {RECEIPT_SCHEMA}")
    for field in SHA_FIELDS:
        require_sha(receipt.get(field), f"promotion receipt {field}")
    observed_hashes = {
        "candidateSha256": sha256_bytes(candidate_bytes),
        "sourceWindowSha256": sha256_bytes(source_window_bytes),
        "sourceCaptureSha256": sha256_bytes(source_capture_bytes),
    }
    for field, observed in observed_hashes.items():
        if receipt[field] != observed:
            raise PromotionError(f"promotion receipt freshness mismatch for {field}")
    if source_capture.get("schema") != CAPTURE_SCHEMA:
        raise PromotionError(f"source capture must use schema {CAPTURE_SCHEMA}")
    if meta.get("schema") != CAPTURE_META_SCHEMA:
        raise PromotionError(f"source capture metadata must use schema {CAPTURE_META_SCHEMA}")
    if require_sha(meta.get("evidenceSha256"), "source capture metadata evidenceSha256") != observed_hashes["sourceCaptureSha256"]:
        raise PromotionError("source capture metadata does not bind the source evidence")
    manifest_hash = require_sha(meta.get("manifestSha256"), "source capture metadata manifestSha256")
    if receipt["sourceCaptureManifestSha256"] != manifest_hash:
        raise PromotionError("promotion receipt does not bind the source capture manifest")

    policy = source_capture.get("policy")
    predicate = policy.get("rootStatePredicate") if isinstance(policy, dict) else None
    if not isinstance(predicate, dict) or predicate.get("schema") != ROOT_PREDICATE_SCHEMA or predicate.get("status") != "passed":
        raise PromotionError("source capture has no passed root-state predicate receipt")
    predicate_hash = require_sha(predicate.get("provenanceSha256"), "root-state predicate provenanceSha256")
    declaration = predicate.get("declaration")
    if not isinstance(declaration, dict):
        raise PromotionError("root-state predicate receipt has no manifest declaration")
    if canonical_json_sha256(declaration) != predicate_hash:
        raise PromotionError("root-state predicate receipt does not hash its declaration")
    if receipt["rootStatePredicateSha256"] != predicate_hash:
        raise PromotionError("promotion receipt crosses the source root-state predicate")

    surface_state = receipt.get("surfaceState")
    if surface_state not in {"transparent-preference", "opaque-preference"}:
        raise PromotionError("promotion receipt surfaceState is unsupported")
    captured_surface_state = policy.get("windowSurfaceState") if isinstance(policy, dict) else None
    if captured_surface_state != surface_state:
        raise PromotionError("promotion surfaceState does not match source capture windowSurfaceState")
    host = derive_host_environment(source_capture, observed_hashes["sourceCaptureSha256"])
    if backdrop_requested(source_window) and host is None:
        raise PromotionError("transparent/backdrop promotion requires live or declaratively projected host state")
    capture_state = {
        "schema": "burl-capture-environment-state-v1",
        "surfaceState": surface_state,
        "hostEnvironment": host,
        "rootStatePredicate": {
            "status": "passed",
            "declaration": f"sha256:{predicate_hash}",
        },
    }
    compositing_errors = validate_compositing(source_window, candidate, capture_state)
    if compositing_errors:
        raise PromotionError(f"window compositing gate failed: {compositing_errors[0]}")
    return {
        "schema": "burl-guarded-import-promotion-report-v1",
        "status": "validated",
        "candidateSha256": observed_hashes["candidateSha256"],
        "sourceWindowSha256": observed_hashes["sourceWindowSha256"],
        "sourceCaptureSha256": observed_hashes["sourceCaptureSha256"],
        "sourceCaptureManifestSha256": manifest_hash,
        "rootStatePredicateSha256": predicate_hash,
        "surfaceState": surface_state,
        "hostEnvironment": host,
    }


def atomic_replace(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.promoting-", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--canonical", type=Path, required=True)
    parser.add_argument("--source-window", type=Path, required=True)
    parser.add_argument("--source-capture", type=Path, required=True)
    parser.add_argument("--source-capture-meta", type=Path, required=True)
    parser.add_argument("--promotion-receipt", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.candidate.resolve() == args.canonical.resolve():
        print("guarded-import-promotion: candidate must be a staging path, not the canonical path", file=sys.stderr)
        return 2
    try:
        candidate_bytes = read_bytes(args.candidate)
        report = validate_inputs(
            args.candidate, candidate_bytes,
            args.source_window, read_bytes(args.source_window),
            args.source_capture, read_bytes(args.source_capture),
            args.source_capture_meta, read_bytes(args.source_capture_meta),
            args.promotion_receipt, read_bytes(args.promotion_receipt),
        )
        if not args.check_only:
            atomic_replace(args.canonical, candidate_bytes)
            report["status"] = "promoted"
            report["canonical"] = str(args.canonical)
        else:
            report["status"] = "validated-check-only"
        atomic_replace(args.report, (json.dumps(report, indent=2, sort_keys=True) + "\n").encode())
    except PromotionError as error:
        print(f"guarded-import-promotion: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"guarded-import-promotion: I/O failure: {error}", file=sys.stderr)
        return 2
    print(f"guarded-import-promotion: {report['status']} {args.candidate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
