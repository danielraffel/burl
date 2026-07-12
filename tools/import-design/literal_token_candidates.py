#!/usr/bin/env python3
"""Exact-literal token candidate extraction with review-only promotion."""

from __future__ import annotations

import re

CSS_BLOCK = re.compile(r"([^{}]+)\{([^{}]*)\}")
DECL = re.compile(r"([\w-]+)\s*:\s*([^;]+)")
TOKEN_VALUE = re.compile(r"^(#[0-9a-fA-F]{3,8}|-?\d+(?:\.\d+)?px)$")


def declarations(source: str) -> list[tuple[str, str, str]]:
    style = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", source, re.S | re.I))
    out: list[tuple[str, str, str]] = []
    for selectors, body in CSS_BLOCK.findall(style):
        for prop, value in DECL.findall(body):
            out.append((selectors.strip(), prop.strip().lower(), value.strip()))
    return out


def token_candidates(source: str, minimum_uses: int = 2) -> list[dict[str, object]]:
    """Cluster exact literals only; never merge or rewrite automatically."""
    uses: dict[tuple[str, str], list[str]] = {}
    for selector, prop, value in declarations(source):
        if TOKEN_VALUE.fullmatch(value):
            kind = "color" if value.startswith("#") else "dimension"
            uses.setdefault((kind, value.lower()), []).append(f"{selector}:{prop}")
    return [
        {"kind": kind, "literal": literal, "uses": sorted(paths)}
        for (kind, literal), paths in sorted(uses.items())
        if len(paths) >= minimum_uses
    ]


def reviewed_promotion_round_trip(source: str, accepted: list[dict[str, object]]) -> bool:
    """Prove reviewed literal replacement resolves exactly to original bytes."""
    promoted = source
    bindings: dict[str, str] = {}
    for index, item in enumerate(accepted):
        literal = str(item["literal"])
        ref = f"{{extracted.literal.{index}}}"
        bindings[ref] = literal
        promoted = promoted.replace(literal, ref)
    resolved = promoted
    for ref, literal in bindings.items():
        resolved = resolved.replace(ref, literal)
    return resolved == source
