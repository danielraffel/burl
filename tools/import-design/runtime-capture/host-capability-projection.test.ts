import { describe, expect, test } from "bun:test"
import {
	hostCapabilityProjectionBootstrapSource,
	hostCapabilityProjectionReceipt,
	validateHostCapabilityProjection,
} from "./host-capability-projection"

const projection = {
	schemaVersion: 1 as const,
	entries: [
		{ path: "desktopHost.platform", kind: "property" as const, value: "darwin" },
		{ path: "desktopHost.getWindowSurface", kind: "method" as const,
			returnMode: "promise" as const, value: { tier: "transparent" } },
	],
}

describe("bounded declarative host capability projection", () => {
	test("validates generic property and method entries and produces deterministic provenance", () => {
		expect(validateHostCapabilityProjection(projection)).toEqual(projection)
		const first = hostCapabilityProjectionReceipt(projection)
		const reordered = { schemaVersion: 1, entries: [projection.entries[1], projection.entries[0]] }
		expect(first.schema).toBe("burl-host-capability-projection-v1")
		expect(first.mode).toBe("declarative-projection")
		expect(first.provenanceSha256).toMatch(/^[0-9a-f]{64}$/)
		expect(first.provenanceSha256).not.toBe(hostCapabilityProjectionReceipt(reordered).provenanceSha256)
		expect(first.paths).toEqual([
			{ path: "desktopHost.platform", kind: "property" },
			{ path: "desktopHost.getWindowSurface", kind: "method", returnMode: "promise" },
		])
	})

	test("bootstrap installs only declared leaves and records projected method calls", async () => {
		const source = hostCapabilityProjectionBootstrapSource(projection)
		expect(source).not.toContain("darwin=>")
		const execute = new Function(`${source};return globalThis.desktopHost`)
		const prior = (globalThis as any).desktopHost
		const priorCalls = (globalThis as any).__pulpCaptureHostCalls
		try {
			delete (globalThis as any).desktopHost
			;(globalThis as any).__pulpCaptureHostCalls = []
			const projected = execute()
			expect(projected.platform).toBe("darwin")
			expect(await projected.getWindowSurface()).toEqual({ tier: "transparent" })
			expect((globalThis as any).__pulpCaptureHostCalls).toEqual([{
				name: "desktopHost.getWindowSurface", args: [], source: "declarative-projection",
			}])
			expect(() => { projected.platform = "changed" }).toThrow()
		} finally {
			delete (globalThis as any).desktopHost
			if (prior !== undefined) (globalThis as any).desktopHost = prior
			if (priorCalls === undefined) delete (globalThis as any).__pulpCaptureHostCalls
			else (globalThis as any).__pulpCaptureHostCalls = priorCalls
		}
	})

	test("rejects prototype paths, platform globals, secrets, conflicts, and implicit async semantics", () => {
		const invalid = [
			{ path: "desktopHost.__proto__.tier", kind: "property", value: "x" },
			{ path: "document.hostTier", kind: "property", value: "x" },
			{ path: "desktopHost.accessToken", kind: "property", value: "x" },
			{ path: "desktopHost.getTier", kind: "method", value: "x" },
		]
		for (const entry of invalid)
			expect(() => validateHostCapabilityProjection({ schemaVersion: 1, entries: [entry] })).toThrow()
		expect(() => validateHostCapabilityProjection({ schemaVersion: 1, entries: [
			{ path: "desktopHost.surface", kind: "property", value: {} },
			{ path: "desktopHost.surface.tier", kind: "property", value: "x" },
		] })).toThrow("conflicting paths")
	})

	test("rejects non-JSON, deeply nested, oversized, and unbounded declarations", () => {
		for (const value of [Number.NaN, { password: "x" }, { a: { b: { c: { d: { e: 1 } } } } }])
			expect(() => validateHostCapabilityProjection({ schemaVersion: 1, entries: [
				{ path: "desktopHost.value", kind: "property", value },
			] })).toThrow()
		expect(() => validateHostCapabilityProjection({ schemaVersion: 1, entries: [] })).toThrow("1 through 32")
		expect(() => validateHostCapabilityProjection({ schemaVersion: 1, entries: Array.from(
			{ length: 33 }, (_, index) => ({ path: `host.value${index}`, kind: "property", value: index }),
		) })).toThrow("1 through 32")
	})
})
