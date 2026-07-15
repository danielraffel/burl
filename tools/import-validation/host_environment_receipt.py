#!/usr/bin/env python3
"""Validation shared by parity, compositing, and guarded import promotion."""

from __future__ import annotations

import re
from typing import Any

HOST_MODES = {"live-existing", "declarative-projection"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def validate_host_environment(host: Any) -> list[str]:
    if not isinstance(host, dict) or host.get("mode") not in HOST_MODES:
        return ["host environment must be live-existing or declarative-projection"]
    provenance = str(host.get("provenanceSha256", ""))
    if not SHA256.fullmatch(provenance):
        return ["host environment requires a lowercase SHA-256 provenance receipt"]
    projection = host.get("projectionReceipt")
    if host["mode"] == "live-existing":
        return [] if projection is None else ["live-existing host environment cannot carry a projection receipt"]
    if not isinstance(projection, dict) or (
        projection.get("schema") != "burl-host-capability-projection-v1"
        or projection.get("mode") != "declarative-projection"
        or projection.get("provenanceSha256") != provenance
    ):
        return ["declarative host environment requires its validated projection receipt"]
    paths = projection.get("paths")
    count = projection.get("entryCount")
    if not isinstance(paths, list) or not isinstance(count, int) or not 1 <= count <= 32 or len(paths) != count:
        return ["declarative projection receipt has an invalid bounded path inventory"]
    seen: set[str] = set()
    for index, item in enumerate(paths):
        if not isinstance(item, dict) or item.get("kind") not in {"property", "method"}:
            return [f"declarative projection path {index} is malformed"]
        path = item.get("path")
        if not isinstance(path, str) or not path or path in seen:
            return [f"declarative projection path {index} is missing or duplicated"]
        if item["kind"] == "method" and item.get("returnMode") not in {"sync", "promise"}:
            return [f"declarative projection method {path} has no return mode"]
        if item["kind"] == "property" and "returnMode" in item:
            return [f"declarative projection property {path} cannot have a return mode"]
        seen.add(path)
    return []
