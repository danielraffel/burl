#!/usr/bin/env bun
import { readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { capture, stableJson, validateManifest } from "./capture-source-cdp"

const i = process.argv.indexOf("--manifest")
if (i < 0 || !process.argv[i + 1]) throw new Error("usage: repeatability-gate.ts --manifest capture.json")
const manifest = validateManifest(JSON.parse(await readFile(resolve(process.argv[i + 1]), "utf8")))
const base = resolve(manifest.output)
const first = await capture({ ...manifest, output: `${base}.repeat-a` })
const second = await capture({ ...manifest, output: `${base}.repeat-b` })
if (stableJson(first) !== stableJson(second)) throw new Error(`capture is not byte-repeatable\nA ${stableJson(first)}B ${stableJson(second)}`)
await rm(`${base}.repeat-a`, { recursive: true, force: true }); await rm(`${base}.repeat-b`, { recursive: true, force: true })
console.log("PASS byte-repeatable source capture")
