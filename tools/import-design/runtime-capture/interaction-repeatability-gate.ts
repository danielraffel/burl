#!/usr/bin/env bun
import { readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { captureInteractions, validateInteractionManifest } from "./capture-interactions-cdp"
import { stableJson } from "./capture-source-cdp"

const index = process.argv.indexOf("--manifest")
if (index < 0 || !process.argv[index + 1]) throw new Error("usage: interaction-repeatability-gate.ts --manifest interactions.json")
const manifest = validateInteractionManifest(JSON.parse(await readFile(resolve(process.argv[index + 1]), "utf8")))
const base = resolve(manifest.output)
const first = await captureInteractions({ ...manifest, output: `${base}.repeat-a` })
const second = await captureInteractions({ ...manifest, output: `${base}.repeat-b` })
if (stableJson(first) !== stableJson(second)) throw new Error(`interaction evidence is not byte-repeatable\nA ${stableJson(first)}B ${stableJson(second)}`)
await rm(`${base}.repeat-a`, { recursive: true, force: true }); await rm(`${base}.repeat-b`, { recursive: true, force: true })
console.log("PASS byte-repeatable interaction evidence")
