import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { applyLocalizedRemoteImages, authoredViewportThresholds, bootstrapSource, captureCohortIdentity, captureMatchedStyleReceipts, classifyDeclarationOrigin, elementProvenanceFunctionDeclaration, joinSnapshotProvenanceByBackendId, LAYOUT_PROVENANCE_PROPERTIES, localizeRemoteImageUrls, mapWithConcurrency, provenanceFromMatched, runtimeStateProvenance, runtimeStorageBootstrapSource, semanticRoleProbeExpression, sha256, shouldCaptureMatchedStyles, snapshotOrdinaryElementRefs, stableJson, STYLE_PROPERTIES, validateManifest, validateSemanticRoleReceipts, validateTransientStyleGateReceipt, writeStableJson } from "../capture-source-cdp"
import { domSnapshotToObserved } from "../domsnapshot-to-observed"

const valid = { schemaVersion: 1, cdpEndpoint: "http://127.0.0.1:9222", output: "/tmp/x", viewport: { width: 800, height: 600, deviceScaleFactor: 2 }, clock: "2026-01-02T03:04:05Z", security: { mode: "recording-fake" } }

describe("runtime source capture contract", () => {
	test("source-wide compatibility properties are observable before lowering", () => {
		for (const property of [
			"contain-intrinsic-size", "font-feature-settings", "font-style",
			"scrollbar-color", "scrollbar-width", "stroke-dasharray",
			"text-rendering", "visibility",
		]) expect(STYLE_PROPERTIES).toContain(property)
	})
	test("transient-style poison gate requires settled transitions and stable computed frames", () => {
		const passed = { status: "passed" as const, settleMs: 320, styleSamples: 3,
			activeTransitions: 0, unstableElements: 0 }
		expect(validateTransientStyleGateReceipt(passed)).toEqual(passed)
		expect(() => validateTransientStyleGateReceipt({ ...passed, activeTransitions: 1 })).toThrow("settled style frontier")
		expect(() => validateTransientStyleGateReceipt({ ...passed, unstableElements: 1 })).toThrow("settled style frontier")
		expect(() => validateTransientStyleGateReceipt({ ...passed, styleSamples: 1 })).toThrow("settled style frontier")
	})
	test("bounded capture work preserves input order", async () => {
		let active = 0, peak = 0
		const output = await mapWithConcurrency([3, 1, 2, 0], 2, async (value) => {
			active++; peak = Math.max(peak, active)
			await Bun.sleep(value)
			active--
			return value * 2
		})
		expect(output).toEqual([6, 2, 4, 0])
		expect(peak).toBe(2)
	})
	test("remote image localization is bounded, deterministic, and rewrites captured evidence only", async () => {
		const request = async (url: string | URL | Request) => new Response(
			String(url).endsWith("logo.svg")
				? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>'
				: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			{ headers: { "content-type": String(url).endsWith("logo.svg") ? "image/svg+xml" : "image/png" } },
		) as Promise<Response>
		const receipts = await localizeRemoteImageUrls([
			"https://assets.example/logo.svg", "https://assets.example/pixel.png",
			"https://assets.example/logo.svg",
		], request as typeof fetch)
		expect(receipts.map((receipt) => receipt.sourceUrl)).toEqual([
			"https://assets.example/logo.svg", "https://assets.example/pixel.png",
		])
		expect(receipts[0].dataUri).toStartWith("data:image/svg+xml;base64,")
		const observed = { tagName: "div", attributes: {}, children: [
			{ tagName: "img", attributes: { src: receipts[0].sourceUrl }, children: [] },
		] }
		applyLocalizedRemoteImages(observed, receipts)
		expect(observed.children[0].attributes.src).toBe(receipts[0].dataUri)
		expect(() => new URL(receipts[0].sourceUrl)).not.toThrow()
	})
	test("remote image localization rejects unsupported MIME and unbounded payloads", async () => {
		await expect(localizeRemoteImageUrls(["https://assets.example/file.txt"],
			(async () => new Response("no", { headers: { "content-type": "text/plain" } })) as typeof fetch))
			.rejects.toThrow("unsupported MIME")
		await expect(localizeRemoteImageUrls(["https://assets.example/huge.png"],
			(async () => new Response("x", { headers: { "content-type": "image/png", "content-length": "1048577" } })) as typeof fetch))
			.rejects.toThrow("exceeds")
	})
	test("matched-style scope is explicit and candidate-bounded", () => {
		expect(shouldCaptureMatchedStyles({ matchedStyleScope: "text-and-interactive" },
			{ hasDirectText: true })).toBe(true)
		expect(shouldCaptureMatchedStyles({ matchedStyleScope: "text-and-interactive" },
			{ critical: true })).toBe(true)
		expect(shouldCaptureMatchedStyles({ matchedStyleScope: "text-and-interactive" }, {})).toBe(false)
		expect(shouldCaptureMatchedStyles({ includeMatchedStyles: true }, {})).toBe(true)
		expect(shouldCaptureMatchedStyles({}, { matchedEvidenceProperties: ["margin-left"] })).toBe(true)
	})
	test("layout provenance covers dimensions and margins without source-specific selectors", () => {
		expect(LAYOUT_PROVENANCE_PROPERTIES).toEqual([
			"height", "margin-bottom", "margin-left", "margin-right", "margin-top",
			"max-height", "max-width", "min-height", "min-width", "width",
		])
		const declaration = elementProvenanceFunctionDeclaration()
		expect(declaration).toContain(`const layoutProvenanceProperties=${JSON.stringify([...LAYOUT_PROVENANCE_PROPERTIES])}`)
		expect(declaration).toContain("const matchedEvidenceProperties=layoutProvenanceProperties")
		expect(declaration).toContain("this.computedStyleMap?.()")
		expect(declaration).toContain("scrollWidth:this.scrollWidth")
		expect(declaration).toContain("scrollTop:this.scrollTop")
	})
	test("property-scoped matched-style capture queries every layout evidence node deterministically", async () => {
		const calls: Array<{ method: string; nodeId: number }> = []
		const cdp = {
			async command(method: string, params: any) {
				calls.push({ method, nodeId: params.nodeId })
				return { inlineStyle: { cssProperties: [{ name: "width", value: "auto" }] } }
			},
		}
		const elements = [11, 12, 13].map(() => ({
			matchedEvidenceProperties: [...LAYOUT_PROVENANCE_PROPERTIES],
		}))
		const first = await captureMatchedStyleReceipts(cdp as any, [11, 12, 13], elements, {})
		expect(first).toHaveLength(3)
		expect(calls).toEqual([
			{ method: "CSS.getMatchedStylesForNode", nodeId: 11 },
			{ method: "CSS.getMatchedStylesForNode", nodeId: 12 },
			{ method: "CSS.getMatchedStylesForNode", nodeId: 13 },
		])
		expect(await captureMatchedStyleReceipts(cdp as any, [11], elements.slice(0, 1), {
			structuralStateCapture: true,
		})).toEqual([null])
		await expect(captureMatchedStyleReceipts(cdp as any, [11], [], {}))
			.rejects.toThrow("node and element counts differ")
	})
	test("semantic role probes are explicit, bounded, and deterministic", () => {
		const probes = [{ containerSelector: ".markdown", roles: ["paragraph", "strong", "inline-code", "metadata"] as const }]
		const expression = semanticRoleProbeExpression(probes.map((probe) => ({
			containerSelector: probe.containerSelector, roles: [...probe.roles],
		})))
		expect(expression).toBe(semanticRoleProbeExpression(probes.map((probe) => ({
			containerSelector: probe.containerSelector, roles: [...probe.roles],
		}))))
		expect(expression).toContain("cloneNode(false)")
		expect(expression).toContain("source.querySelector(selectors[role])")
		expect(expression).toContain("ancestry.reverse()")
		expect(expression).toContain("[data-streamdown=\"inline-code\"]")
		expect(expression).toContain("authored-cascade-offscreen-clone")
		expect(expression).toContain("finally{shell.remove()}")
		expect(validateManifest({ ...valid, semanticRoleProbes: probes }).semanticRoleProbes).toHaveLength(1)
		expect(() => validateManifest({ ...valid, semanticRoleProbes: [{ containerSelector: "", roles: ["strong"] }] })).toThrow("containerSelector")
		expect(() => validateManifest({ ...valid, semanticRoleProbes: [{ containerSelector: ".x", roles: ["strong", "strong"] }] })).toThrow("duplicate")
		const receipt = { containerSelector: ".markdown", role: "strong", tagName: "strong",
			computedStyle: { fontSize: "15px" }, method: "authored-cascade-offscreen-clone" }
		expect(validateSemanticRoleReceipts([receipt], [{ containerSelector: ".markdown", roles: ["strong"] }])).toEqual([receipt])
		expect(() => validateSemanticRoleReceipts([], [{ containerSelector: ".markdown", roles: ["strong"] }])).toThrow("count mismatch")
	})
	test("extracts deterministic authored CSS viewport thresholds", () => {
		expect(authoredViewportThresholds([
			{ text: "(width >= 48rem)" },
			{ mediaList: { text: "screen and (max-width: 600px)" } },
			{ text: "(min-width: 40rem)" },
		], 16)).toEqual([
			{ query: "screen and (max-width: 600px)", cssPixels: 600 },
			{ query: "(min-width: 40rem)", cssPixels: 640 },
			{ query: "(width >= 48rem)", cssPixels: 768 },
		])
	})
	test("canonical evidence is key-order neutral", () => expect(stableJson({ z: 1, a: { y: 2, x: 3 } })).toBe(stableJson({ a: { x: 3, y: 2 }, z: 1 })))
	test("streaming canonical evidence matches the in-memory encoding", async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "pulp-canonical-json-"))
		const path = resolve(directory, "evidence.json")
		const evidence = { z: [1, null, { q: "line\nvalue", a: true }], a: { n: Number.NaN, empty: [] } }
		try {
			const digest = await writeStableJson(path, evidence)
			const bytes = await readFile(path, "utf8")
			expect(bytes).toBe(stableJson(evidence))
			expect(digest).toBe(sha256(bytes))
		} finally { await rm(directory, { recursive: true, force: true }) }
	})
	test("manifest is loopback and deny-by-default", () => {
		expect(validateManifest(valid).security.mode).toBe("recording-fake")
		expect(() => validateManifest({ ...valid, cdpEndpoint: "http://example.com:9222" })).toThrow("loopback")
		expect(() => validateManifest({ ...valid, security: { mode: "live" } })).toThrow("recording-fake")
		expect(validateManifest({ ...valid, reload: false, preserveLivePage: true,
			structuralStateCapture: true, sourceRevision: "abc" }).preserveLivePage).toBe(true)
		expect(() => validateManifest({ ...valid, preserveLivePage: true })).toThrow("reload=false")
	})
	test("explicit runtime storage is isolated, bounded, and credential-safe", () => {
		const runtimeState = { localStorage: { "ui:theme": "dark" }, sessionStorage: { "ui:density": "compact" } }
		const manifest = validateManifest({ ...valid, clearStorage: true,
			security: { mode: "recording-fake", isolatedProfile: true }, runtimeState })
		expect(manifest.runtimeState).toEqual(runtimeState)
		expect(runtimeStorageBootstrapSource(runtimeState, true)).toContain("store.clear()")
		expect(runtimeStorageBootstrapSource(runtimeState, true)).toContain("ui:theme")
		expect(runtimeStateProvenance(runtimeState)).not.toEqual(expect.objectContaining(runtimeState))
		expect(() => validateManifest({ ...valid, runtimeState })).toThrow("isolatedProfile")
		expect(() => validateManifest({ ...valid, clearStorage: true,
			security: { mode: "recording-fake", isolatedProfile: true },
			runtimeState: { localStorage: { access_token: "do-not-record" } } })).toThrow("credential-like")
	})
	test("runtime storage participates deterministically in capture cohort identity", () => {
		const base = { ...valid, clearStorage: true,
			security: { mode: "recording-fake" as const, isolatedProfile: true },
			runtimeState: { localStorage: { "ui:theme": "dark", "ui:density": "compact" } } }
		const sameDifferentOrder = { ...base,
			runtimeState: { localStorage: { "ui:density": "compact", "ui:theme": "dark" } } }
		const different = { ...base, runtimeState: { localStorage: { "ui:theme": "light", "ui:density": "compact" } } }
		expect(captureCohortIdentity(base)).toBe(captureCohortIdentity(sameDifferentOrder))
		expect(captureCohortIdentity(base)).not.toBe(captureCohortIdentity(different))
		expect(runtimeStateProvenance(base.runtimeState)).not.toEqual(runtimeStateProvenance(different.runtimeState))
	})
	test("bootstrap freezes time and host services without erasing motion evidence", () => {
		const source = bootstrapSource(valid.clock)
		expect(source).toContain("static now(){return epoch}")
		expect(source).not.toContain("animation:none!important")
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
		expect(result.color).toHaveLength(3)
	})
	test("matched rules remain provenance order, never an inferred cascade winner", () => {
		const result = provenanceFromMatched({ matchedCSSRules: [
			{ rule: { origin: "author", selectorList: { text: "*" }, style: { cssProperties: [{ name: "margin-left", value: "0px" }] } } },
			{ rule: { origin: "author", selectorList: { text: ".ml-auto" }, style: { cssProperties: [{ name: "margin-left", value: "auto", important: true }] } } },
		] })
		expect(result["margin-left"].map((item) => item.value)).toEqual(["0px", "auto"])
		expect(result["margin-left"].map((item) => item.important)).toEqual([false, true])
	})
	test("property-scoped matched rules retain only the declared evidence frontier", () => {
		const matched = { matchedCSSRules: [{ rule: { origin: "author", selectorList: { text: ".panel" }, style: { cssProperties: [
			{ name: "margin-left", value: "auto" },
			{ name: "color", value: "red" },
			{ name: "background-image", value: "linear-gradient(red, blue)" },
		] } } }] }
		expect(provenanceFromMatched(matched, ["margin-left"])).toEqual({
			"margin-left": [expect.objectContaining({ value: "auto", selector: ".panel" })],
		})
	})
	test("hash is stable", () => expect(sha256("pulp")).toBe("fbd51a21513da3be67bf2802ef6e2adc4b48c61d8be88e55761c2aa38a324d9d"))
	test("snapshot backend identity prevents insertion removal and ordering misjoins", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		snapshot.documents[0].nodes.backendNodeId = snapshot.documents[0].nodes.nodeType.map((_: number, index: number) => 1000 + index)
		const refs = snapshotOrdinaryElementRefs(snapshot)
		const records = refs.map((ref) => ({ backendNodeId: ref.backendNodeId, name: ref.nodeName }))
		const inserted = [{ backendNodeId: 999999, name: "INSERTED" }, ...records].reverse()
		expect(joinSnapshotProvenanceByBackendId(refs, inserted).map((record) => record.backendNodeId))
			.toEqual(refs.map((ref) => ref.backendNodeId))
		expect(() => joinSnapshotProvenanceByBackendId(refs, records.slice(1)))
			.toThrow(`snapshot backendNodeId ${refs[0].backendNodeId} is stale or unresolved`)
		expect(() => joinSnapshotProvenanceByBackendId(refs, [...records, records[0]]))
			.toThrow(`duplicate live backendNodeId ${records[0].backendNodeId}`)
	})
	test("snapshot ordinary identity fails closed on missing backend IDs", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		snapshot.documents[0].nodes.backendNodeId = snapshot.documents[0].nodes.nodeType.map((_: number, index: number) => 1000 + index)
		snapshot.documents[0].nodes.backendNodeId[1] = 0
		expect(() => snapshotOrdinaryElementRefs(snapshot)).toThrow("missing backendNodeId")
	})
	test("DOMSnapshot lowers deterministically with ordered mixed content and SVG", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		const provenance = [
			{ nodeName: "HTML", computed, outerHTML: "<html></html>", matchedStylesCapture: "property-scoped", matchedStylesCompleteProperties: ["margin-left"] },
			{ nodeName: "BODY", computed, outerHTML: "<body></body>" },
			{ nodeName: "DIV", computed, declarations: { width: [{ value: "auto", origin: "authored" }] }, matchedStylesCapture: "complete", motion: [{ name: "spin" }], scrollGeometry: { clientWidth: 100, clientHeight: 30, scrollWidth: 100, scrollHeight: 90, scrollLeft: 0, scrollTop: 0 }, outerHTML: "<div class=\"card\">Hello <svg></svg></div>" },
			{ nodeName: "SVG", computed: { display: "inline", color: computed.color }, outerHTML: "<svg viewBox=\"0 0 10 10\"></svg>" },
		]
		const first = domSnapshotToObserved(snapshot, ["display", "color"], provenance)
		const second = domSnapshotToObserved(structuredClone(snapshot), ["display", "color"], structuredClone(provenance))
		expect(stableJson(first)).toBe(stableJson(second))
		expect(first.sourceId).toStartWith("dom/html-")
		expect(first.styleProvenanceComplete).toBe(false)
		expect(first.styleProvenanceCompleteProperties).toEqual(["margin-left"])
		const div = first.children[0].children[0]
		expect(div.attributes).toEqual({ class: "card" })
		expect(div.rect).toEqual({ x: 10, y: 20, width: 100, height: 30 })
		expect(div.content.map((item) => item.kind)).toEqual(["text", "child"])
		expect(div.children[0].inlineSvg).toContain("viewBox")
		expect(div.provenanceIndex).toBe(2)
		expect(div.styleProvenance?.width?.[0]).toEqual({ value: "auto", origin: "authored" })
		expect(div.styleProvenanceComplete).toBe(true)
		expect(div.motion).toEqual([{ name: "spin" }])
		expect(div.scrollGeometry).toEqual({ clientWidth: 100, clientHeight: 30, scrollWidth: 100, scrollHeight: 90, scrollLeft: 0, scrollTop: 0 })
		const scaled = domSnapshotToObserved(snapshot, ["display", "color"], provenance, 2)
		expect(scaled.children[0].children[0].rect).toEqual({ x: 10, y: 20, width: 100, height: 30 })
		const deviceCoordinates = domSnapshotToObserved(snapshot, ["display", "color"], provenance, 2, 0.5)
		expect(deviceCoordinates.children[0].children[0].rect).toEqual({ x: 5, y: 10, width: 50, height: 15 })
	})
	test("DOMSnapshot fails closed on malformed runtime scroll geometry", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		const provenance = [
			{ nodeName: "HTML", computed }, { nodeName: "BODY", computed },
			{ nodeName: "DIV", computed, scrollGeometry: { clientWidth: 100, clientHeight: 30, scrollWidth: 99, scrollHeight: 30, scrollLeft: 0, scrollTop: 0 } },
			{ nodeName: "SVG", computed },
		]
		expect(() => domSnapshotToObserved(snapshot, ["display", "color"], provenance))
			.toThrow("scroll geometry is malformed at node 4")
	})
	test("DOMSnapshot source identity ignores volatile component-library ids", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		snapshot.strings.push("id", "base-ui-_r_4h_")
		const idName = snapshot.strings.length - 2, idValue = snapshot.strings.length - 1
		// Element node 4 is the fixture's authored card div.
		snapshot.documents[0].nodes.attributes[4].push(idName, idValue)
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		const provenance = [
			{ nodeName: "HTML", computed }, { nodeName: "BODY", computed },
			{ nodeName: "DIV", computed }, { nodeName: "SVG", computed },
		]
		const observed = domSnapshotToObserved(snapshot, ["display", "color"], provenance)
		const card = observed.children[0].children[0]
		expect(card.attributes.id).toBe("base-ui-_r_4h_")
		expect(card.sourceId).not.toContain("base-ui")
		expect(card.sourceId).toContain("div-shape-")
	})
	test("DOMSnapshot source identity separates clipped focus infrastructure from visible shape peers", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		snapshot.strings.push("aria-hidden", "true", "tabindex", "0", "style", "clip-path: inset(50%); position: fixed; top: 0; left: 0")
		const base = snapshot.strings.length - 6
		snapshot.documents[0].nodes.attributes[4].push(base, base + 1, base + 2, base + 3, base + 4, base + 5)
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		const provenance = [
			{ nodeName: "HTML", computed }, { nodeName: "BODY", computed },
			{ nodeName: "DIV", computed }, { nodeName: "SVG", computed },
		]
		const observed = domSnapshotToObserved(snapshot, ["display", "color"], provenance)
		expect(observed.children[0].children[0].sourceId).toContain("div-focus-infrastructure-sentinel")
	})
	test("DOMSnapshot unions same-node layout fragments without changing canonical identity", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		const position = snapshot.documents[0].layout.nodeIndex.indexOf(4)
		snapshot.documents[0].layout.nodeIndex.push(4)
		snapshot.documents[0].layout.bounds.push([100, 20, 30, 30])
		snapshot.documents[0].layout.styles.push([...snapshot.documents[0].layout.styles[position]])
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		const provenance = [
			{ nodeName: "HTML", computed }, { nodeName: "BODY", computed },
			{ nodeName: "DIV", computed }, { nodeName: "SVG", computed: { display: "inline", color: computed.color } },
		]
		const observed = domSnapshotToObserved(snapshot, ["display", "color"], provenance)
		const card = observed.children[0].children[0]
		expect(card.sourceId).toContain("div-shape-")
		expect(card.rect).toEqual({ x: 10, y: 20, width: 120, height: 30 })
		snapshot.documents[0].layout.styles.at(-1)![0] = 14
		expect(() => domSnapshotToObserved(snapshot, ["display", "color"], provenance))
			.toThrow("fragment styles disagree")
	})
	test("DOMSnapshot materializes supported CSS generated pseudos with provenance and snapshot order", () => {
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		for (const pseudoType of ["before", "after", "marker"]) {
			const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
			snapshot.strings.push(pseudoType)
			snapshot.documents[0].nodes.pseudoType = { index: [4], value: [snapshot.strings.length - 1] }
			const provenance = [
				{ nodeName: "HTML", computed }, { nodeName: "BODY", computed },
				{ nodeName: "SVG", computed: { display: "inline", color: computed.color } },
			]
			const observed = domSnapshotToObserved(snapshot, ["display", "color"], provenance)
			const body = observed.children[0], generated = body.children[0]
			expect(generated.sourceId).toEndWith(`/pseudo-${pseudoType}:0`)
			expect(generated.generated).toEqual({ kind: "pseudo-element", pseudoType })
			expect(generated.provenanceIndex).toBe(-1)
			expect(generated.rect).toEqual({ x: 10, y: 20, width: 100, height: 30 })
			expect(generated.computedStyle).toEqual(computed)
			expect(generated.children[0].tagName).toBe("svg")
			expect(generated.children[0].provenanceIndex).toBe(2)
			expect(body.content[0]).toEqual({ kind: "child", sourceId: generated.sourceId })
		}
	})
	test("DOMSnapshot fails closed for malformed, unknown, and foreign generated trees", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		const provenance = [{ nodeName: "HTML", computed }, { nodeName: "BODY", computed },
			{ nodeName: "DIV", computed }, { nodeName: "SVG", computed }]
		snapshot.documents[0].nodes.pseudoType = { index: [4], value: [] }
		expect(() => domSnapshotToObserved(snapshot, ["display", "color"], provenance)).toThrow("pseudoType classification is malformed")
		snapshot.strings.push("first-letter")
		snapshot.documents[0].nodes.pseudoType = { index: [4], value: [snapshot.strings.length - 1] }
		expect(() => domSnapshotToObserved(snapshot, ["display", "color"], provenance)).toThrow("unsupported explicit type first-letter")
		delete snapshot.documents[0].nodes.pseudoType
		snapshot.documents[0].nodes.shadowRootType = { index: [4], value: [snapshot.strings.length - 1] }
		expect(() => domSnapshotToObserved(snapshot, ["display", "color"], provenance))
			.toThrow("shadow tree at node 4")
	})
	test("DOMSnapshot rejects ambiguous parent ordering", () => {
		const snapshot = JSON.parse(readFileSync(resolve(import.meta.dir, "fixtures/domsnapshot.json"), "utf8"))
		snapshot.documents[0].nodes.parentIndex[2] = 4
		expect(() => domSnapshotToObserved(snapshot, ["display", "color"], [])).toThrow("parent/order is ambiguous")
	})
})
