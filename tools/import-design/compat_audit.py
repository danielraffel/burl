#!/usr/bin/env python3
"""Standards-seeded audit of renderer and Electron capabilities used by a source tree."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

SCHEMA = "pulp-web-electron-capability-audit-v1"
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


def test_exists(repo: Path, reference: str) -> bool:
    candidate = reference.split(" [", 1)[0].split("::", 1)[0]
    return bool(candidate) and (repo / candidate).exists()


def build_report(source: Path, observed: Path, repo: Path, catalogs: Path,
                 compat_path: Path) -> dict:
    observations = scan_sources(source)
    payload = json.loads(observed.read_text())
    root = payload.get("observedDom", payload)
    walk_observed(root, observations)
    standards = {
        "css": load_tsv_names(catalogs / "mdn-css.tsv") | load_tsv_names(catalogs / "yoga.tsv"),
        "electron-platform": load_tsv_names(catalogs / "electron-api-seed.tsv"),
    }
    compat = compat_index(json.loads(compat_path.read_text()))
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
        status = "unseen"
        tests = []
        if entry:
            claim = entry.get("status", "missing")
            tests = entry.get("tests", []) if isinstance(entry.get("tests", []), list) else []
            status = "supported" if claim == "supported" else "lowered" if claim == "partial" else "unsupported"
        elif cataloged:
            status = "projected" if domain in {"css", "pseudo-state", "html", "aria", "react"} else "unsupported"
        valid_tests = [test for test in tests if test_exists(repo, test)]
        row = {
            "domain": domain, "feature": feature, "status": status,
            "count": len(evidence), "examples": sorted(set(evidence))[:5],
            "cataloged": cataloged, "support_owner": entry.get("mapsTo") if entry else None,
            "diagnostic_owner": entry.get("notes") if entry else None,
            "tests": tests, "valid_tests": valid_tests, "provenance": PROVENANCE[domain],
        }
        if domain == "css":
            row["values"] = sorted(set(item.split("=", 1)[1] if "=" in item else item
                                       for item in evidence))[:20]
        rows.append(row)
        if not cataloged:
            failures.append({"code": "observed-uncataloged", "domain": domain, "feature": feature})
        if status == "supported" and not valid_tests:
            failures.append({"code": "supported-without-test", "domain": domain, "feature": feature})
    return {"schema": SCHEMA, "source": str(source), "observed": str(observed),
            "summary": dict(Counter(row["status"] for row in rows)),
            "items": rows, "failures": failures, "ok": not failures}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--observed", type=Path, required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--catalogs", type=Path, default=Path(__file__).with_name("catalogs"))
    parser.add_argument("--compat", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--no-fail", action="store_true")
    args = parser.parse_args()
    report = build_report(args.source, args.observed, args.repo, args.catalogs,
                          args.compat or args.repo / "compat.json")
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")
    return 0 if report["ok"] or args.no_fail else 2


if __name__ == "__main__":
    raise SystemExit(main())
