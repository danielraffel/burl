#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { domSnapshotToObserved } from "./domsnapshot-to-observed"

export type Json = Record<string, unknown>

export const SCHEMA = "pulp-runtime-source-capture-v1"
export const STYLE_PROPERTIES = [
	"display", "position", "flex-direction", "flex-grow", "flex-shrink", "flex-basis",
	"flex-wrap", "align-items", "align-self", "align-content", "justify-content", "gap",
	"padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right",
	"margin-bottom", "margin-left", "width", "height", "min-width", "min-height", "max-width",
	"max-height", "top", "right", "bottom", "left", "color", "background-color",
	"background-image", "transform", "filter", "backdrop-filter", "font-family", "font-size",
	"font-weight", "font-style", "line-height", "white-space", "text-align", "text-overflow",
	"overflow-wrap", "letter-spacing", "border-top-width", "border-right-width",
	"border-bottom-width", "border-left-width", "border-top-color", "border-right-color",
	"border-bottom-color", "border-left-color", "border-top-left-radius", "border-top-right-radius",
	"border-bottom-right-radius", "border-bottom-left-radius", "opacity", "box-shadow", "cursor",
	"overflow-x", "overflow-y", "visibility", "z-index", "pointer-events",
] as const

export function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex")
}

export function stableJson(value: unknown): string {
	const sort = (item: any): any => Array.isArray(item)
		? item.map(sort)
		: item && typeof item === "object"
			? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]))
			: item
	return `${JSON.stringify(sort(value), null, 2)}\n`
}

export interface CaptureManifest {
	schemaVersion: 1
	cdpEndpoint: string
	pageUrlPattern?: string
	output: string
	viewport: { width: number; height: number; deviceScaleFactor: number }
	clock: string
	settleFrames?: number
	timeoutMs?: number
	reload?: boolean
	includeMatchedStyles?: boolean
	matchedStyleSelectors?: string[]
	clearStorage?: boolean
	state?: { selector: string; pseudo?: "hover" | "active" | "focus" }
	security: { mode: "recording-fake"; isolatedProfile?: boolean }
}

export interface SnapshotElementRef { nodeIndex: number; backendNodeId: number; nodeName: string }

export function snapshotOrdinaryElementRefs(snapshot: any): SnapshotElementRef[] {
	if (!Array.isArray(snapshot?.documents) || snapshot.documents.length !== 1 || !Array.isArray(snapshot.strings))
		throw new Error("snapshot element identity requires exactly one typed document")
	const nodes = snapshot.documents[0]?.nodes
	if (!Array.isArray(nodes?.nodeType) || !Array.isArray(nodes?.nodeName) || !Array.isArray(nodes?.backendNodeId) ||
		nodes.nodeType.length !== nodes.nodeName.length || nodes.nodeType.length !== nodes.backendNodeId.length)
		throw new Error("snapshot backend element identity table is incomplete")
	const pseudo = new Set<number>(nodes.pseudoType?.index ?? [])
	return nodes.nodeType.flatMap((type: number, nodeIndex: number) => {
		if (type !== 1 || pseudo.has(nodeIndex)) return []
		const backendNodeId = nodes.backendNodeId[nodeIndex]
		if (!Number.isInteger(backendNodeId) || backendNodeId <= 0)
			throw new Error(`snapshot ordinary element ${nodeIndex} has missing backendNodeId`)
		const encodedName = nodes.nodeName[nodeIndex]
		if (!Number.isInteger(encodedName) || encodedName < 0 || encodedName >= snapshot.strings.length)
			throw new Error(`snapshot ordinary element ${nodeIndex} has invalid nodeName`)
		return [{ nodeIndex, backendNodeId, nodeName: snapshot.strings[encodedName] }]
	})
}

export function joinSnapshotProvenanceByBackendId<T extends { backendNodeId: number }>(
	refs: readonly SnapshotElementRef[], records: readonly T[]): T[] {
	const indexed = new Map<number, T>()
	for (const record of records) {
		if (indexed.has(record.backendNodeId)) throw new Error(`duplicate live backendNodeId ${record.backendNodeId}`)
		indexed.set(record.backendNodeId, record)
	}
	return refs.map((ref) => {
		const record = indexed.get(ref.backendNodeId)
		if (!record) throw new Error(`snapshot backendNodeId ${ref.backendNodeId} is stale or unresolved`)
		return record
	})
}

export function validateManifest(input: any): CaptureManifest {
	if (input?.schemaVersion !== 1) throw new Error("manifest schemaVersion must be 1")
	if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(input.cdpEndpoint ?? ""))
		throw new Error("cdpEndpoint must be loopback HTTP with an explicit port")
	const v = input.viewport
	if (!Number.isInteger(v?.width) || !Number.isInteger(v?.height) || v.width < 1 || v.height < 1)
		throw new Error("viewport dimensions must be positive integers")
	if (![1, 2, 3].includes(v.deviceScaleFactor)) throw new Error("deviceScaleFactor must be 1, 2, or 3")
	if (!Number.isFinite(Date.parse(input.clock))) throw new Error("clock must be an ISO date")
	if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 120000))
		throw new Error("timeoutMs must be an integer from 1000 through 120000")
	if (input.security?.mode !== "recording-fake") throw new Error("security.mode must be recording-fake")
	if (input.clearStorage && input.security?.isolatedProfile !== true)
		throw new Error("clearStorage requires security.isolatedProfile=true")
	if (input.state?.pseudo && !["hover", "active", "focus"].includes(input.state.pseudo))
		throw new Error("unsupported forced pseudo state")
	return input
}

export function bootstrapSource(clock: string): string {
	const epoch = Date.parse(clock)
	return `(() => {
const NativeDate=Date, epoch=${epoch};
class FrozenDate extends NativeDate { constructor(...a){super(...(a.length?a:[epoch]))} static now(){return epoch} }
globalThis.Date=FrozenDate;
let captureSeed=0x6d2b79f5;Math.random=()=>{captureSeed=(captureSeed+0x6d2b79f5)|0;let t=captureSeed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
globalThis.__pulpCaptureHostCalls=[];
const denied=(name)=>(...args)=>{globalThis.__pulpCaptureHostCalls.push({name,args});throw new Error("capture host service denied: "+name)};
const fake={invoke:denied("invoke"),send:denied("send"),on:denied("on"),openExternal:denied("openExternal")};
for(const name of ["electron","electronAPI","api","hostBridge"])try{Object.defineProperty(globalThis,name,{value:fake,configurable:true})}catch{}
try{Object.defineProperty(Performance.prototype,"now",{value:()=>0,configurable:true})}catch{}
const apply=()=>{let s=document.querySelector("style[data-pulp-capture-policy]");if(!s){s=document.createElement("style");s.dataset.pulpCapturePolicy="true";document.documentElement.appendChild(s)}s.textContent="*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}"};
document.documentElement?apply():addEventListener("DOMContentLoaded",apply,{once:true});
})();`
}

export function classifyDeclarationOrigin(origin: string, inherited: boolean): "authored" | "inherited" | "ua" {
	if (inherited) return "inherited"
	return origin === "user-agent" ? "ua" : "authored"
}

export class Cdp {
	private nextId = 1
	private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
	private handlers = new Map<string, Array<(params: any) => void>>()
	private constructor(private socket: WebSocket, private timeoutMs: number) {
		socket.addEventListener("message", (event) => {
			const payload = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString())
			if (!payload.id) { for (const handler of this.handlers.get(payload.method) ?? []) handler(payload.params); return }
			const waiter = this.pending.get(payload.id); if (!waiter) return
			this.pending.delete(payload.id)
			payload.error ? waiter.reject(new Error(JSON.stringify(payload.error))) : waiter.resolve(payload.result)
		})
	}
	on(method: string, handler: (params: any) => void) { (this.handlers.get(method) ?? this.handlers.set(method, []).get(method)!).push(handler) }
	static async connect(url: string, timeoutMs = 30000): Promise<Cdp> {
		const socket = new WebSocket(url)
		await new Promise<void>((ok, fail) => {
			const timer = setTimeout(() => fail(new Error(`CDP connection timed out after ${timeoutMs}ms`)), timeoutMs)
			socket.addEventListener("open", () => { clearTimeout(timer); ok() }, { once: true })
			socket.addEventListener("error", () => { clearTimeout(timer); fail(new Error("CDP connection failed")) }, { once: true })
		})
		return new Cdp(socket, timeoutMs)
	}
	command(method: string, params: Json = {}, timeoutOverride?: number): Promise<any> {
		const id = this.nextId++
		return new Promise((resolve, reject) => {
			const timeoutMs = timeoutOverride ?? this.timeoutMs
			const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs}ms`)) }, timeoutMs)
			this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
			this.socket.send(JSON.stringify({ id, method, params }))
		})
	}
	close() { this.socket.close() }
}

export function provenanceFromMatched(matched: any): Record<string, Array<Json>> {
	const result: Record<string, Array<Json>> = {}
	if (!matched) return result
	const collect = (rules: any[], inherited: boolean) => {
		for (const entry of rules ?? []) {
			const rule = entry.rule ?? entry
			for (const property of rule.style?.cssProperties ?? []) {
				if (!property.name || property.disabled) continue
				(result[property.name] ??= []).push({
					value: property.value, important: !!property.important,
					origin: classifyDeclarationOrigin(rule.origin ?? "author", inherited),
					selector: rule.selectorList?.text ?? "<inline>",
					range: property.range ?? rule.style?.range ?? null,
					media: (rule.media ?? []).map((entry: any) => entry.text).filter(Boolean),
				})
			}
		}
	}
	collect(matched.inlineStyle ? [{ style: matched.inlineStyle, origin: "author" }] : [], false)
	collect(matched.matchedCSSRules, false)
	for (const inherited of matched.inherited ?? []) {
		collect(inherited.inlineStyle ? [{ style: inherited.inlineStyle, origin: "author" }] : [], true)
		collect(inherited.matchedCSSRules, true)
	}
	return result
}

export interface AuthoredViewportThreshold { query: string; cssPixels: number }

export function authoredViewportThresholds(media: readonly any[], rootFontSize = 16): AuthoredViewportThreshold[] {
	const found = new Map<string, AuthoredViewportThreshold>()
	for (const entry of media) {
		const query = String(entry?.text ?? entry?.mediaList?.text ?? "").trim()
		if (!query) continue
		const expression = /(?:min-|max-)?width\s*:\s*([0-9]*\.?[0-9]+)(px|rem)|width\s*(?:>=|<=|>|<)\s*([0-9]*\.?[0-9]+)(px|rem)/gi
		for (const match of query.matchAll(expression)) {
			const amount = Number(match[1] ?? match[3])
			const unit = match[2] ?? match[4]
			if (!Number.isFinite(amount)) continue
			const cssPixels = amount * (unit === "rem" ? rootFontSize : 1)
			found.set(`${query}\u0000${cssPixels}`, { query, cssPixels })
		}
	}
	return [...found.values()].sort((a, b) => a.cssPixels - b.cssPixels || a.query.localeCompare(b.query))
}

export async function capture(manifest: CaptureManifest): Promise<Json> {
	const trace = (stage: string) => { if (process.env.PULP_CAPTURE_TRACE) console.error(`[capture] ${stage}`) }
	const timeoutMs = manifest.timeoutMs ?? 30000
	const output = resolve(manifest.output)
	const staging = `${output}.capturing-${process.pid}`
	// A failed capture must never leave an older run looking current.
	await rm(output, { recursive: true, force: true })
	await rm(staging, { recursive: true, force: true })
	const pages = await fetch(`${manifest.cdpEndpoint}/json/list`, { signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json()) as any[]
	const page = pages.find((p) => p.type === "page" && (!manifest.pageUrlPattern || new RegExp(manifest.pageUrlPattern).test(p.url)))
	if (!page?.webSocketDebuggerUrl) throw new Error("no matching CDP page")
	const cdp = await Cdp.connect(page.webSocketDebuggerUrl, timeoutMs)
	try {
		for (const domain of ["Page", "Runtime", "DOM", "CSS", "Network"]) await cdp.command(`${domain}.enable`)
		const source = new URL(page.url)
		cdp.on("Fetch.requestPaused", (event) => {
			let allowed = false
			try {
				const requested = new URL(event.request.url)
				allowed = ["data:", "blob:", "file:"].includes(requested.protocol) ||
					(requested.origin === source.origin && ["127.0.0.1", "localhost"].includes(requested.hostname))
			} catch {}
			void cdp.command(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
				allowed ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: "BlockedByClient" })
		})
		await cdp.command("Fetch.enable", { patterns: [{ urlPattern: "*" }] })
		await cdp.command("Emulation.setDeviceMetricsOverride", { ...manifest.viewport, mobile: false, screenWidth: manifest.viewport.width, screenHeight: manifest.viewport.height })
		if (manifest.clearStorage && source.protocol !== 'file:') {
			await cdp.command("Runtime.evaluate", { expression: "sessionStorage.clear();localStorage.clear()" })
			await cdp.command("Storage.clearDataForOrigin", { origin: source.origin, storageTypes: "all" })
			await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: "sessionStorage.clear();localStorage.clear()" })
		}
		await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: bootstrapSource(manifest.clock) })
		if (manifest.reload === false) await cdp.command("Runtime.evaluate", { expression: bootstrapSource(manifest.clock) })
		else await cdp.command("Page.reload", { ignoreCache: true })
		const frames = manifest.settleFrames ?? 2
		for (let attempt = 0;; attempt++) {
			try { await cdp.command("Runtime.evaluate", { expression: `document.fonts.ready.then(()=>new Promise(done=>setTimeout(done,${frames}*16)))`, awaitPromise: true }); break }
			catch (error) {
				if (attempt >= 9 || !String(error).includes("Execution context was destroyed")) throw error
				await Bun.sleep(100)
			}
		}
		// Let application startup use rAF, then prevent motion loops from
		// mutating inline styles between evidence and screenshot capture.
		await cdp.command("Runtime.evaluate", { expression: `(()=>{globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{}})()` })
		await cdp.command("Runtime.evaluate", { expression: `(()=>{window.scrollTo(0,0);for(const element of document.querySelectorAll('*')){element.scrollLeft=0;element.scrollTop=0}document.activeElement?.blur?.()})()` })
		await cdp.command("Runtime.evaluate", { expression: `new Promise(done=>setTimeout(done,${frames}*16))`, awaitPromise: true })
		let priorDomSignature = "", stableDomSamples = 0
		for (let attempt = 0; attempt < 100 && stableDomSamples < 2; attempt++) {
			const signature = (await cdp.command("Runtime.evaluate", { expression: `JSON.stringify([...document.querySelectorAll('*')].map(element=>{const clone=element.cloneNode(false);const text=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.nodeValue).join('');return[element.tagName,clone.outerHTML,text]}))`, returnByValue: true })).result.value
			stableDomSamples = signature === priorDomSignature ? stableDomSamples + 1 : 0
			priorDomSignature = signature
			if (stableDomSamples < 2) await Bun.sleep(20)
		}
		if (stableDomSamples < 2) throw new Error("DOM did not reach a stable provenance window")
		trace("settled")
		const document = await cdp.command("DOM.getDocument", { depth: -1, pierce: true })
		const mediaQueries = ((await cdp.command("CSS.getMediaQueries")).medias ?? []).map((entry: any) => {
			// CDP reallocates stylesheet transport IDs after every navigation. Preserve
			// authored location/query evidence but discard the ephemeral handle.
			const { styleSheetId: _styleSheetId, ...stable } = entry
			return stable
		})
		const rootFontSize = Number.parseFloat((await cdp.command("Runtime.evaluate", {
			expression: "getComputedStyle(document.documentElement).fontSize", returnByValue: true,
		})).result.value) || 16
		const authoredThresholds = authoredViewportThresholds(mediaQueries, rootFontSize)
		if (manifest.state) {
			const chosen = await cdp.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: manifest.state.selector })
			if (!chosen.nodeId) throw new Error("state selector did not match")
			await cdp.command("CSS.forcePseudoState", { nodeId: chosen.nodeId, forcedPseudoClasses: [manifest.state.pseudo] })
		}
		let snapshot: any, nodeIds: number[] = [], observedElements: any[] = []
		let snapshotRefs: SnapshotElementRef[] = []
		let identityFailure: unknown
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				snapshot = await cdp.command("DOMSnapshot.captureSnapshot", { computedStyles: [...STYLE_PROPERTIES], includePaintOrder: true, includeDOMRects: true, includeBlendedBackgroundColors: true, includeTextColorOpacities: true })
				snapshotRefs = snapshotOrdinaryElementRefs(snapshot)
				nodeIds = (await cdp.command("DOM.pushNodesByBackendIdsToFrontend", {
					backendNodeIds: snapshotRefs.map((ref) => ref.backendNodeId),
				})).nodeIds as number[]
				if (!Array.isArray(nodeIds) || nodeIds.length !== snapshotRefs.length || nodeIds.some((id) => !Number.isInteger(id) || id <= 0))
					throw new Error("snapshot backendNodeId resolution returned a stale node")
				const records = await Promise.all(nodeIds.map(async (nodeId, index) => {
					const resolved = await cdp.command("DOM.resolveNode", { nodeId })
					if (!resolved.object?.objectId) throw new Error(`snapshot backendNodeId ${snapshotRefs[index].backendNodeId} is stale or unresolved`)
					const called = await cdp.command("Runtime.callFunctionOn", {
						objectId: resolved.object.objectId, returnByValue: true,
						functionDeclaration: `function(){const properties=${JSON.stringify([...STYLE_PROPERTIES])};const matchedSelectors=${JSON.stringify(manifest.matchedStyleSelectors ?? [])};const style=getComputedStyle(this);const computed=Object.fromEntries(properties.map(name=>[name,style.getPropertyValue(name)]));const clone=this.cloneNode(false);const excluded=['SCRIPT','STYLE','TEMPLATE'].includes(this.nodeName);const hasDirectText=!excluded&&this.getClientRects().length>0&&style.display!=='none'&&style.visibility!=='hidden'&&[...this.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.nodeValue.trim()!=='');const fontKey=[style.fontFamily,style.fontWeight,style.fontStyle,style.fontSize].join('|');const critical=this.matches('button,input,textarea,[role],[aria-label]')||!!this.closest('main,[role=main],[role=dialog]');const matchedEvidence=matchedSelectors.some(selector=>this.matches(selector));return {nodeName:this.nodeName,computed,hasDirectText,fontKey,critical,matchedEvidence,outerHTML:this instanceof SVGElement?this.outerHTML:clone.outerHTML}}`,
					})
					if (called.exceptionDetails || !called.result?.value) throw new Error(`snapshot backendNodeId ${snapshotRefs[index].backendNodeId} provenance evaluation failed`)
					return { backendNodeId: snapshotRefs[index].backendNodeId, ...called.result.value }
				}))
				observedElements = joinSnapshotProvenanceByBackendId(snapshotRefs, records)
				identityFailure = undefined; break
			} catch (error) {
				identityFailure = error
				if (attempt < 2) await Bun.sleep(20)
			}
		}
		if (identityFailure) throw new Error(`snapshot provenance resolution failed after 3 attempts: ${String(identityFailure)}`)
		trace(`snapshot-first provenance ${snapshotRefs.length} elements`)
		const matched = await Promise.all(nodeIds.map((nodeId, index) =>
			manifest.includeMatchedStyles || observedElements[index].matchedEvidence
				? cdp.command("CSS.getMatchedStylesForNode", { nodeId }) : null))
		const fontResults = new Map<number, any>()
		const candidates = nodeIds.map((_, index) => index).filter((index) => observedElements[index].hasDirectText)
		const textIndices: number[] = []
		const add = (index: number) => { if (!textIndices.includes(index) && textIndices.length < 32) textIndices.push(index) }
		const fontKeys = new Set<string>()
		for (const index of candidates) if (!fontKeys.has(observedElements[index].fontKey)) {
			fontKeys.add(observedElements[index].fontKey); add(index)
		}
		for (const index of candidates) if (observedElements[index].critical) add(index)
		for (const index of candidates) add(index)
		await Promise.all(textIndices.map(async (index) => {
			try { fontResults.set(index, await cdp.command("CSS.getPlatformFontsForNode", { nodeId: nodeIds[index] }, 5000)) }
			catch (error) { fontResults.set(index, { error: String(error), fonts: [] }) }
		}))
		if (textIndices.length && ![...fontResults.values()].some((result) => result.fonts?.length))
			throw new Error("runtime font evidence returned no used fonts for rendered text")
		trace(`font evidence ${textIndices.length}`)
		const provenance = observedElements.map((element, index) => ({
			nodeName: element.nodeName, computed: element.computed, outerHTML: element.outerHTML,
			declarations: provenanceFromMatched(matched[index]),
			usedFonts: (fontResults.get(index)?.fonts ?? []).map((font: any) => ({
				family: font.familyName, postScriptName: font.postScriptName,
				custom: !!font.isCustomFont, glyphCount: font.glyphCount,
			})).sort((a: any, b: any) => stableJson(a).localeCompare(stableJson(b))),
			usedFontsCapture: !element.hasDirectText ? "not-text-bearing" : index >= 0 && textIndices.includes(index)
				? (fontResults.get(index)?.error ? "query-failed" : "queried") : "omitted-limit",
		}))
		const observedDom = domSnapshotToObserved(snapshot, STYLE_PROPERTIES, provenance, manifest.viewport.deviceScaleFactor)
		// CDP allocates backend node IDs afresh on every navigation. They are transport
		// handles, not source evidence, so retaining them would make equal pages differ.
		for (const item of snapshot.documents ?? []) delete item.nodes?.backendNodeId
		const screenshot = Buffer.from((await cdp.command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false })).data, "base64")
		const hostCalls = (await cdp.command("Runtime.evaluate", { expression: "globalThis.__pulpCaptureHostCalls||[]", returnByValue: true })).result.value
		const evidence = { schema: SCHEMA, policy: { viewport: manifest.viewport, clock: manifest.clock, settleFrames: frames, reload: manifest.reload !== false, clearStorage: !!manifest.clearStorage, animations: "disabled", transitions: "disabled", network: "external-denied-source-origin-allowed", hostServices: "recording-fake" }, page: { url: page.url, title: page.title }, observedDom, snapshot, styleProvenanceByDomOrder: provenance, authoredMedia: { rootFontSize, queries: mediaQueries, viewportThresholds: authoredThresholds }, hostCalls }
		await mkdir(staging, { recursive: true })
		const evidenceBytes = stableJson(evidence)
		await writeFile(resolve(staging, "source.png"), screenshot)
		await writeFile(resolve(staging, "source.json"), evidenceBytes)
		const metadata = { schema: SCHEMA, screenshotSha256: sha256(screenshot), evidenceSha256: sha256(evidenceBytes), manifestSha256: sha256(stableJson({ ...manifest, output: "<output>" })) }
		await writeFile(resolve(staging, "meta.json"), stableJson(metadata))
		await rename(staging, output)
		return metadata
	} finally { cdp.close(); await rm(staging, { recursive: true, force: true }) }
}

async function main() {
	const flag = process.argv.indexOf("--manifest")
	if (flag < 0 || !process.argv[flag + 1]) throw new Error("usage: capture-source-cdp.ts --manifest capture.json")
	const manifest = validateManifest(JSON.parse(await readFile(resolve(process.argv[flag + 1]), "utf8")))
	console.log(stableJson(await capture(manifest)).trim())
}

if (import.meta.main) await main()
