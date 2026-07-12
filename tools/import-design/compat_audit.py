#!/usr/bin/env python3
"""Standards-seeded audit of renderer and Electron capabilities used by a source tree."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

SCHEMA = "pulp-web-electron-capability-audit-v2"
TEXT_EXTENSIONS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".html", ".css"}
EXCLUDED_PARTS = {".git", "node_modules", "dist", "build", "out", "coverage"}

PROVENANCE = {
    "css": {"authority": "W3C CSS", "catalog": "mdn-css.tsv", "upstream": "https://www.w3.org/TR/CSS/"},
    "pseudo-state": {"authority": "W3C Web Platform Tests", "catalog": "WPT selectors seed", "upstream": "https://wpt.fyi/results/css/selectors"},
    "html": {"authority": "WHATWG HTML", "catalog": "HTML Living Standard", "upstream": "https://html.spec.whatwg.org/"},
    "aria": {"authority": "W3C WAI-ARIA", "catalog": "ARIA 1.2", "upstream": "https://www.w3.org/TR/wai-aria-1.2/"},
    "electron-platform": {"authority": "Electron", "catalog": "electron-api-seed.tsv", "upstream": "https://www.electronjs.org/docs/latest/api/"},
    "browser-api": {"authority": "WHATWG/W3C Web APIs", "catalog": "observed API seed", "upstream": "https://developer.mozilla.org/docs/Web/API"},
    "react": {"authority": "React", "catalog": "prop-applier observations", "upstream": "https://react.dev/reference/react-dom/components/common"},
}


def kebab(value: str) -> str:
    return re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value).replace("_", "-").lower()


def load_tsv_names(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {line.split("\t", 1)[0].strip() for line in path.read_text().splitlines()
            if line.strip() and not line.startswith("#")}


def walk_observed(node: dict, out: list[tuple[str, str, str]]) -> None:
    style = node.get("computedStyle", {})
    for prop, value in style.items():
        out.append(("css", kebab(prop), str(value)))
    for state, state_style in node.get("stateStyles", {}).items():
        out.append(("pseudo-state", state, "captured"))
        for prop, value in state_style.items():
            out.append(("css", kebab(prop), str(value)))
    tag = node.get("tagName")
    if tag:
        out.append(("html", f"element:{tag.lower()}", "observed"))
    for name, value in node.get("attributes", {}).items():
        lower = name.lower()
        if lower == "role":
            out.append(("aria", f"role:{value}", "observed"))
        elif lower.startswith("aria-"):
            out.append(("aria", lower, str(value)))
    for child in node.get("children", []):
        walk_observed(child, out)


def scan_sources(root: Path) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and
                       p.suffix in TEXT_EXTENSIONS and not EXCLUDED_PARTS.intersection(p.parts)):
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        rel = str(path.relative_to(root))
        for prop, value in re.findall(r"(?:^|[;{,])\s*([a-zA-Z][\w-]*)\s*:\s*([^;}`\n]+)", text, re.M):
            out.append(("css", kebab(prop), f"{rel}={value.strip()}"))
        for pseudo in re.findall(r":(hover|focus|focus-visible|focus-within|active|disabled|checked|selected)\b", text):
            out.append(("pseudo-state", pseudo, rel))
        for tag in re.findall(r"<([a-z][\w-]*)\b", text, re.I):
            out.append(("html", f"element:{tag.lower()}", rel))
        for role in re.findall(r"\brole\s*=\s*[\"']([^\"']+)", text):
            out.append(("aria", f"role:{role}", rel))
        for aria in re.findall(r"\b(aria-[\w-]+)\s*=", text, re.I):
            out.append(("aria", aria.lower(), rel))
        for event in re.findall(r"\baddEventListener\s*\(\s*[\"']([^\"']+)", text):
            out.append(("browser-api", f"event:{event}", rel))
        for event in re.findall(r"\bon([A-Z][A-Za-z]+)\s*=", text):
            out.append(("react", f"prop:on{event}", rel))
        for owner, member in re.findall(r"\b(window|document|navigator)\.([A-Za-z_$][\w$]*)", text):
            out.append(("browser-api", f"{owner}.{member}", rel))
        for prop in re.findall(r"\b([a-zA-Z][\w-]*)\s*=\s*[{\"']", text):
            out.append(("react", f"prop:{prop}", rel))
        if re.search(r"(?:from\s*[\"']electron[\"']|require\s*\(\s*[\"']electron[\"'])", text):
            out.append(("electron-platform", "module:electron", rel))
            for names in re.findall(r"\{([^}]+)\}\s*(?:=\s*require\s*\(\s*[\"']electron[\"']|from\s*[\"']electron[\"'])", text):
                for name in names.split(","):
                    out.append(("electron-platform", f"api:{name.strip().split(' as ')[0]}", rel))
        for owner, member in re.findall(r"\b(ipcRenderer|ipcMain|electron)\.([A-Za-z_$][\w$]*)", text):
            out.append(("electron-platform", f"member:{owner}.{member}", rel))
        for owner, method, channel in re.findall(r"\b(ipcRenderer|ipcMain)\.(invoke|send|on|once|handle)\s*\(\s*[\"']([^\"']+)", text):
            out.append(("electron-platform", f"ipc:{owner}.{method}:{channel}", rel))
    return out


def compat_index(manifest: dict) -> dict[tuple[str, str], dict]:
    result = {}
    for section, entries in manifest.items():
        if not isinstance(entries, dict):
            continue
        for key, value in entries.items():
            if not isinstance(value, dict):
                continue
            feature = key.split("/", 1)[-1]
            result[(section, kebab(feature))] = value
    return result


def load_evidence_index(path: Path) -> dict[str, dict]:
    """Load an exact evidence-ID registry; malformed entries never resolve."""
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    if payload.get("schema") != "pulp-compat-evidence-index-v1":
        raise ValueError(f"unsupported evidence index schema in {path}")
    entries = payload.get("entries")
    if not isinstance(entries, dict):
        raise ValueError(f"evidence index entries must be an object in {path}")
    return entries


def resolve_evidence(repo: Path, reference: str, index: dict[str, dict],
                     expected_route: str | None = None) -> tuple[dict | None, str | None]:
    """Resolve one typed reference to an owned, runnable artifact.

    Prefix recognition is deliberately insufficient.  The complete reference
    must exist in the registry and its repository path must exist.  Legacy
    free-form paths and cannot-validate markers remain visible but fail closed.
    """
    if not isinstance(reference, str) or not reference:
        return None, "malformed-evidence-reference"
    if reference.startswith("cannot-validate:"):
        return None, "cannot-validate-is-not-evidence"
    if ":" not in reference:
        return None, "legacy-reference-not-indexed"
    record = index.get(reference)
    if not isinstance(record, dict):
        return None, "unknown-evidence-id"
    required = {"kind", "owner", "repository", "route", "endpoint", "path", "command"}
    if not required.issubset(record) or not all(
            isinstance(record[field], str) and record[field].strip()
            for field in required):
        return None, "malformed-evidence-record"
    if record["kind"] not in {"unit", "semantic", "visual", "dom", "behavior",
                              "platform", "accessibility", "application"}:
        return None, "unknown-evidence-kind"
    if record["repository"] != "burl":
        return None, "wrong-evidence-repository"
    if not expected_route:
        return None, "missing-implementation-route"
    if record["route"] != expected_route:
        return None, "route-mismatch"
    repo_root = repo.resolve()
    candidate = (repo_root / record["path"]).resolve()
    try:
        candidate.relative_to(repo_root)
    except ValueError:
        return None, "unsafe-evidence-path"
    if not candidate.exists():
        return None, "missing-evidence-path"
    resolved = {"id": reference, **{field: record[field] for field in sorted(required)}}
    return resolved, None


def implementation_claim(entry: dict | None) -> dict:
    """Translate the legacy compat catalog without conflating its dimensions."""
    if not entry:
        return {"conformance": "unknown", "strategy": "none", "route": None}
    claim = entry.get("status", "missing")
    mapping = {
        "supported": ("supported", "direct"),
        # Partial is a coverage/conformance qualifier, never a lowering proof.
        "partial": ("partial", "direct"),
        "noop": ("unsupported", "noop"),
        "missing": ("missing", "none"),
        "wontfix": ("unsupported", "none"),
    }
    if claim not in mapping:
        return {"conformance": "unknown", "strategy": "none",
                "route": entry.get("mapsTo")}
    conformance, strategy = mapping[claim]
    return {"conformance": conformance, "strategy": strategy,
            "route": entry.get("mapsTo"), "catalog_claim": claim}


def build_report(source: Path, observed: Path, repo: Path, catalogs: Path,
                 compat_path: Path, evidence_index_path: Path | None = None) -> dict:
    observations = scan_sources(source)
    payload = json.loads(observed.read_text())
    root = payload.get("observedDom", payload)
    walk_observed(root, observations)
    standards = {
        "css": load_tsv_names(catalogs / "mdn-css.tsv") | load_tsv_names(catalogs / "yoga.tsv"),
        "electron-platform": load_tsv_names(catalogs / "electron-api-seed.tsv"),
    }
    compat = compat_index(json.loads(compat_path.read_text()))
    evidence_index = load_evidence_index(
        evidence_index_path or catalogs / "compat-evidence-index.json")
    grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
    for domain, feature, evidence in observations:
        grouped[(domain, feature)].append(evidence)
    rows = []
    failures = []
    for (domain, feature), evidence in sorted(grouped.items()):
        lookup_domain = "html" if domain in {"html", "aria", "browser-api"} else domain
        entry = compat.get((lookup_domain, kebab(feature)))
        cataloged = domain in {"html", "aria", "browser-api", "react", "pseudo-state"}
        if domain == "css": cataloged = feature in standards["css"]
        if domain == "electron-platform":
            api_name = feature.split(":", 1)[-1].split(".", 1)[0]
            cataloged = feature == "module:electron" or api_name in standards[domain] or feature.startswith("ipc:")
        tests = []
        if entry:
            tests = entry.get("tests", []) if isinstance(entry.get("tests", []), list) else []
        implementation = implementation_claim(entry)
        resolved_evidence = []
        unresolved_evidence = []
        for reference in tests:
            resolved, reason = resolve_evidence(
                repo, reference, evidence_index, implementation["route"])
            if resolved:
                resolved_evidence.append(resolved)
            else:
                unresolved_evidence.append({"id": str(reference), "reason": reason})
        row = {
            "domain": domain, "feature": feature,
            "catalog": {"cataloged": cataloged, "provenance": PROVENANCE[domain]},
            "implementation": implementation,
            "observation": {"seen": True, "count": len(evidence),
                            "examples": sorted(set(evidence))[:5]},
            "evidence": {"references": tests, "resolved": resolved_evidence,
                         "unresolved": unresolved_evidence},
            "diagnostic_owner": entry.get("notes") if entry else None,
        }
        if domain == "css":
            row["observation"]["values"] = sorted(set(
                item.split("=", 1)[1] if "=" in item else item for item in evidence))[:20]
        rows.append(row)
        if not cataloged:
            failures.append({"code": "observed-uncataloged", "domain": domain, "feature": feature})
        if entry and entry.get("status", "missing") not in {
                "supported", "partial", "noop", "missing", "wontfix"}:
            failures.append({"code": "unknown-compat-status", "domain": domain,
                             "feature": feature})
        if implementation["conformance"] == "supported" and not resolved_evidence:
            failures.append({"code": "supported-without-resolved-evidence",
                             "domain": domain, "feature": feature})
        if implementation["conformance"] == "supported" and not implementation["route"]:
            failures.append({"code": "supported-without-route",
                             "domain": domain, "feature": feature})
        for unresolved in unresolved_evidence:
            failures.append({"code": "unresolved-evidence", "domain": domain,
                             "feature": feature, **unresolved})
        if implementation["strategy"] == "lowered" and implementation.get("catalog_claim") == "partial":
            failures.append({"code": "partial-conflated-with-lowered",
                             "domain": domain, "feature": feature})
    summary = {
        "catalog": dict(Counter("cataloged" if row["catalog"]["cataloged"] else "uncataloged"
                                for row in rows)),
        "implementation": dict(Counter(row["implementation"]["conformance"] for row in rows)),
        "strategy": dict(Counter(row["implementation"]["strategy"] for row in rows)),
        "observation": {"observed": len(rows)},
        "evidence": {"resolved": sum(len(row["evidence"]["resolved"]) for row in rows),
                     "unresolved": sum(len(row["evidence"]["unresolved"]) for row in rows)},
    }
    return {"schema": SCHEMA, "source": str(source), "observed": str(observed),
            "evidence_index": str(evidence_index_path or catalogs / "compat-evidence-index.json"),
            "summary": summary, "items": rows, "failures": failures, "ok": not failures}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--observed", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--catalogs", type=Path, default=Path(__file__).with_name("catalogs"))
    parser.add_argument("--compat", type=Path)
    parser.add_argument("--evidence-index", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--no-fail", action="store_true")
    args = parser.parse_args()
    report = build_report(args.source, args.observed, args.repo, args.catalogs,
                          args.compat or args.repo / "compat.json", args.evidence_index)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")
    return 0 if report["ok"] or args.no_fail else 2


if __name__ == "__main__":
    raise SystemExit(main())
