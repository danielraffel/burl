import { describe, expect, test } from "bun:test"
import { INTERACTION_SCHEMA, normalizeAxTree, validateInteractionManifest } from "../capture-interactions-cdp"

const valid = { schemaVersion: 1, cdpEndpoint: "http://localhost:9333", output: "/tmp/x", viewport: { width: 800, height: 600, deviceScaleFactor: 2 }, clock: "2026-01-02T03:04:05Z", security: { mode: "recording-fake" }, scenarios: [{ id: "click", action: { type: "pointer", target: { role: "button", name: "Save" } } }] }

describe("interaction capture contract", () => {
	test("accepts generic role targets", () => expect(validateInteractionManifest(valid).scenarios[0].id).toBe("click"))
	test("rejects duplicate IDs and unscoped targets", () => {
		expect(() => validateInteractionManifest({ ...valid, scenarios: [...valid.scenarios, ...valid.scenarios] })).toThrow("unique")
		expect(() => validateInteractionManifest({ ...valid, scenarios: [{ id: "bad", action: { type: "pointer", target: {} } }] })).toThrow("selector or role")
	})
	test("normalizes ephemeral AX IDs to deterministic indexes", () => {
		const a = normalizeAxTree([{ nodeId: "91", role: { value: "button" }, name: { value: "Save" }, childIds: ["92"] }, { nodeId: "92", role: { value: "StaticText" }, name: { value: "Save" } }])
		const b = normalizeAxTree([{ nodeId: "700", role: { value: "button" }, name: { value: "Save" }, childIds: ["800"] }, { nodeId: "800", role: { value: "StaticText" }, name: { value: "Save" } }])
		expect(a).toEqual(b); expect(INTERACTION_SCHEMA).toContain("interaction")
	})
})
