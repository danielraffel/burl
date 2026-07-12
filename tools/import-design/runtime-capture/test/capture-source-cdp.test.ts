import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { authoredViewportThresholds, bootstrapSource, classifyDeclarationOrigin, joinSnapshotProvenanceByBackendId, provenanceFromMatched, sha256, snapshotOrdinaryElementRefs, stableJson, validateManifest } from "../capture-source-cdp"
import { domSnapshotToObserved } from "../domsnapshot-to-observed"

const valid = { schemaVersion: 1, cdpEndpoint: "http://127.0.0.1:9222", output: "/tmp/x", viewport: { width: 800, height: 600, deviceScaleFactor: 2 }, clock: "2026-01-02T03:04:05Z", security: { mode: "recording-fake" } }

describe("runtime source capture contract", () => {
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
	test("manifest is loopback and deny-by-default", () => {
		expect(validateManifest(valid).security.mode).toBe("recording-fake")
		expect(() => validateManifest({ ...valid, cdpEndpoint: "http://example.com:9222" })).toThrow("loopback")
		expect(() => validateManifest({ ...valid, security: { mode: "live" } })).toThrow("recording-fake")
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
			{ nodeName: "HTML", computed, outerHTML: "<html></html>" },
			{ nodeName: "BODY", computed, outerHTML: "<body></body>" },
			{ nodeName: "DIV", computed, declarations: { width: [{ value: "auto", origin: "authored" }] }, matchedStylesCapture: "complete", outerHTML: "<div class=\"card\">Hello <svg></svg></div>" },
			{ nodeName: "SVG", computed: { display: "inline", color: computed.color }, outerHTML: "<svg viewBox=\"0 0 10 10\"></svg>" },
		]
		const first = domSnapshotToObserved(snapshot, ["display", "color"], provenance)
		const second = domSnapshotToObserved(structuredClone(snapshot), ["display", "color"], structuredClone(provenance))
		expect(stableJson(first)).toBe(stableJson(second))
		expect(first.sourceId).toStartWith("dom/html-")
		const div = first.children[0].children[0]
		expect(div.attributes).toEqual({ class: "card" })
		expect(div.rect).toEqual({ x: 10, y: 20, width: 100, height: 30 })
		expect(div.content.map((item) => item.kind)).toEqual(["text", "child"])
		expect(div.children[0].inlineSvg).toContain("viewBox")
		expect(div.provenanceIndex).toBe(2)
		expect(div.styleProvenance?.width?.[0]).toEqual({ value: "auto", origin: "authored" })
		expect(div.styleProvenanceComplete).toBe(true)
		const scaled = domSnapshotToObserved(snapshot, ["display", "color"], provenance, 2)
		expect(scaled.children[0].children[0].rect).toEqual({ x: 10, y: 20, width: 100, height: 30 })
		const deviceCoordinates = domSnapshotToObserved(snapshot, ["display", "color"], provenance, 2, 0.5)
		expect(deviceCoordinates.children[0].children[0].rect).toEqual({ x: 5, y: 10, width: 50, height: 15 })
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
	test("DOMSnapshot materializes before and after with generated provenance and snapshot order", () => {
		const computed = { display: "block", color: "rgb(1, 2, 3)" }
		for (const pseudoType of ["before", "after"]) {
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
		snapshot.strings.push("marker")
		snapshot.documents[0].nodes.pseudoType = { index: [4], value: [snapshot.strings.length - 1] }
		expect(() => domSnapshotToObserved(snapshot, ["display", "color"], provenance)).toThrow("unsupported explicit type marker")
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
