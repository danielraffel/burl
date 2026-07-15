import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
	bootstrapSource, captureCohortIdentity, captureRootStatePredicate, validateManifest,
} from "./capture-source-cdp"
import { hostCapabilityProjectionReceipt } from "./host-capability-projection"

const base = {
	schemaVersion: 1,
	cdpEndpoint: "http://127.0.0.1:9222",
	output: "/tmp/capture",
	viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
	clock: "2026-01-02T03:04:05Z",
	security: { mode: "recording-fake" },
}

const hostCapabilityProjection = {
	schemaVersion: 1 as const,
	entries: [
		{ path: "desktopHost.platform", kind: "property" as const, value: "darwin" },
		{ path: "desktopHost.getSurfaceTier", kind: "method" as const,
			returnMode: "promise" as const, value: "transparent" },
	],
}
const rootStatePredicate = {
	selector: "#application-root",
	requiredAttributes: [{ name: "data-surface", value: "transparent" }],
}

describe("runtime capture host capability projection integration", () => {
	test("manifest validation accepts a bounded projection and rejects live-page replacement", () => {
		const manifest = validateManifest({ ...base, hostCapabilityProjection, rootStatePredicate,
			windowSurfaceState: "transparent-preference" })
		expect(manifest.hostCapabilityProjection).toEqual(hostCapabilityProjection)
		expect(() => validateManifest({ ...base, reload: false, preserveLivePage: true,
			hostCapabilityProjection, rootStatePredicate })).toThrow("cannot replace capabilities")
		expect(() => validateManifest({ ...base, hostCapabilityProjection }))
			.toThrow("requires rootStatePredicate")
		expect(() => validateManifest({ ...base, windowSurfaceState: "transparent-preference" }))
			.toThrow("requires rootStatePredicate")
	})

	test("projection provenance participates in capture cohort identity", () => {
		const plain = validateManifest(base)
		const projected = validateManifest({ ...base, hostCapabilityProjection, rootStatePredicate,
			windowSurfaceState: "transparent-preference" })
		expect(captureCohortIdentity(plain)).not.toBe(captureCohortIdentity(projected))
		const changed = validateManifest({ ...base, hostCapabilityProjection: {
			...hostCapabilityProjection,
			entries: hostCapabilityProjection.entries.map((entry) =>
				entry.path === "desktopHost.platform" ? { ...entry, value: "other" } : entry),
		}, rootStatePredicate, windowSurfaceState: "transparent-preference" })
		expect(captureCohortIdentity(projected)).not.toBe(captureCohortIdentity(changed))
		const changedPredicate = validateManifest({ ...base, hostCapabilityProjection,
			windowSurfaceState: "transparent-preference",
			rootStatePredicate: { ...rootStatePredicate,
				requiredAttributes: [{ name: "data-surface", value: "opaque" }] } })
		expect(captureCohortIdentity(projected)).not.toBe(captureCohortIdentity(changedPredicate))
	})

	test("reload bootstrap includes only the validated declarative projection and its receipt is hash-addressed", () => {
		const source = bootstrapSource(base.clock, hostCapabilityProjection)
		expect(source).toContain("desktopHost.getSurfaceTier")
		expect(source).toContain("declarative-projection")
		expect(source).toContain("capture host projection call limit exceeded")
		const receipt = hostCapabilityProjectionReceipt(hostCapabilityProjection)
		expect(receipt.provenanceSha256).toMatch(/^[0-9a-f]{64}$/)
		expect(receipt.paths.map(({ path }) => path)).toEqual([
			"desktopHost.platform", "desktopHost.getSurfaceTier",
		])
	})

	test("capture evaluates the manifest predicate and emits a crossed receipt", async () => {
		let expression = ""
		const receipt = await captureRootStatePredicate({
			command: async (_method: string, parameters: any) => {
				expression = parameters.expression
				return { result: { value: { status: "passed", matchedCount: 1 } } }
			},
		} as any, rootStatePredicate)
		expect(expression).toContain("document.querySelectorAll")
		expect(receipt.status).toBe("passed")
		expect(receipt.declaration).toEqual(rootStatePredicate)
		expect(receipt.provenanceSha256).toMatch(/^[0-9a-f]{64}$/)
	})

	test("checked-in manifest and evidence schemas carry the bounded projection contract", () => {
		const manifestSchema = JSON.parse(readFileSync(resolve(import.meta.dir,
			"capture-manifest.schema.json"), "utf8"))
		const evidenceSchema = JSON.parse(readFileSync(resolve(import.meta.dir,
			"source-capture.schema.json"), "utf8"))
		const declared = manifestSchema.properties.hostCapabilityProjection
		expect(declared.properties.entries.minItems).toBe(1)
		expect(declared.properties.entries.maxItems).toBe(32)
		expect(declared.properties.entries.items.properties.returnMode.enum).toEqual(["sync", "promise"])
		expect(manifestSchema.allOf).toContainEqual({
			if: { required: ["hostCapabilityProjection"] },
			then: { required: ["rootStatePredicate"] },
		})
		const policy = evidenceSchema.properties.policy
		expect(policy.properties.hostServices.enum).toContain("declarative-projection")
		expect(policy.properties.hostCapabilityProjection.properties.provenanceSha256.pattern)
			.toBe("^[0-9a-f]{64}$")
		expect(policy.allOf).toContainEqual(expect.objectContaining({
			if: { properties: { hostServices: { const: "declarative-projection" } } },
			then: { required: ["hostCapabilityProjection", "rootStatePredicate"] },
		}))
	})
})
