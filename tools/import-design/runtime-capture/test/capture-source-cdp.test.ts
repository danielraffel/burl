import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { bootstrapSource, classifyDeclarationOrigin, provenanceFromMatched, sha256, stableJson, validateManifest } from "../capture-source-cdp"

const valid = { schemaVersion: 1, cdpEndpoint: "http://127.0.0.1:9222", output: "/tmp/x", viewport: { width: 800, height: 600, deviceScaleFactor: 2 }, clock: "2026-01-02T03:04:05Z", security: { mode: "recording-fake" } }

describe("runtime source capture contract", () => {
	test("canonical evidence is key-order neutral", () => expect(stableJson({ z: 1, a: { y: 2, x: 3 } })).toBe(stableJson({ a: { x: 3, y: 2 }, z: 1 })))
	test("manifest is loopback and deny-by-default", () => {
		expect(validateManifest(valid).security.mode).toBe("recording-fake")
		expect(() => validateManifest({ ...valid, cdpEndpoint: "http://example.com:9222" })).toThrow("loopback")
		expect(() => validateManifest({ ...valid, security: { mode: "live" } })).toThrow("recording-fake")
	})
	test("bootstrap freezes time, motion, and host services", () => {
		const source = bootstrapSource(valid.clock)
		expect(source).toContain("static now(){return epoch}")
		expect(source).toContain("animation:none!important")
		expect(source).toContain("capture host service denied")
	})
	test("style origins remain explicit", () => {
		expect(classifyDeclarationOrigin("user-agent", false)).toBe("ua")
		expect(classifyDeclarationOrigin("author", true)).toBe("inherited")
		expect(classifyDeclarationOrigin("author", false)).toBe("authored")
	})
	test("matched-rule fixture preserves authored, inherited, and UA declarations", () => {
		const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/matched-styles.json"), "utf8"))
		const result = provenanceFromMatched(fixture)
		expect(result.color.map((item) => item.origin)).toEqual(["authored", "ua", "inherited"])
		expect(result.color[0].selector).toBe(".message")
	})
	test("hash is stable", () => expect(sha256("pulp")).toBe("fbd51a21513da3be67bf2802ef6e2adc4b48c61d8be88e55761c2aa38a324d9d"))
})
