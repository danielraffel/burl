#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

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
	"overflow-x", "overflow-y", "visibility", "z-index",
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
	state?: { selector: string; pseudo?: "hover" | "active" | "focus" }
	security: { mode: "recording-fake" }
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
	if (input.security?.mode !== "recording-fake") throw new Error("security.mode must be recording-fake")
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
globalThis.__pulpCaptureHostCalls=[];
const denied=(name)=>(...args)=>{globalThis.__pulpCaptureHostCalls.push({name,args});throw new Error("capture host service denied: "+name)};
const fake={invoke:denied("invoke"),send:denied("send"),on:denied("on"),openExternal:denied("openExternal")};
for(const name of ["electron","electronAPI","api","hostBridge"])try{Object.defineProperty(globalThis,name,{value:fake,configurable:true})}catch{}
const apply=()=>{const s=document.createElement("style");s.dataset.pulpCapturePolicy="true";s.textContent="*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";document.documentElement.appendChild(s)};
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
	private constructor(private socket: WebSocket) {
		socket.addEventListener("message", (event) => {
			const payload = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString())
			if (!payload.id) return
			const waiter = this.pending.get(payload.id); if (!waiter) return
			this.pending.delete(payload.id)
			payload.error ? waiter.reject(new Error(JSON.stringify(payload.error))) : waiter.resolve(payload.result)
		})
	}
	static async connect(url: string): Promise<Cdp> {
		const socket = new WebSocket(url)
		await new Promise<void>((ok, fail) => { socket.addEventListener("open", () => ok(), { once: true }); socket.addEventListener("error", () => fail(new Error("CDP connection failed")), { once: true }) })
		return new Cdp(socket)
	}
	command(method: string, params: Json = {}): Promise<any> {
		const id = this.nextId++
		return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })) })
	}
	close() { this.socket.close() }
}

export function provenanceFromMatched(matched: any): Record<string, Array<Json>> {
	const result: Record<string, Array<Json>> = {}
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

export async function capture(manifest: CaptureManifest): Promise<Json> {
	const pages = await fetch(`${manifest.cdpEndpoint}/json/list`).then((r) => r.json()) as any[]
	const page = pages.find((p) => p.type === "page" && (!manifest.pageUrlPattern || new RegExp(manifest.pageUrlPattern).test(p.url)))
	if (!page?.webSocketDebuggerUrl) throw new Error("no matching CDP page")
	const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
	try {
		for (const domain of ["Page", "Runtime", "DOM", "CSS", "Network"]) await cdp.command(`${domain}.enable`)
		await cdp.command("Network.setBlockedURLs", { urls: ["http://*/*", "https://*/*"] })
		await cdp.command("Emulation.setDeviceMetricsOverride", { ...manifest.viewport, mobile: false, screenWidth: manifest.viewport.width, screenHeight: manifest.viewport.height })
		await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: bootstrapSource(manifest.clock) })
		await cdp.command("Page.reload", { ignoreCache: true })
		const frames = manifest.settleFrames ?? 2
		await cdp.command("Runtime.evaluate", { expression: `document.fonts.ready.then(()=>new Promise(done=>{let n=${frames};const tick=()=>--n<=0?done():requestAnimationFrame(tick);requestAnimationFrame(tick)}))`, awaitPromise: true })
		const document = await cdp.command("DOM.getDocument", { depth: -1, pierce: true })
		if (manifest.state) {
			const chosen = await cdp.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: manifest.state.selector })
			if (!chosen.nodeId) throw new Error("state selector did not match")
			await cdp.command("CSS.forcePseudoState", { nodeId: chosen.nodeId, forcedPseudoClasses: [manifest.state.pseudo] })
		}
		const nodeIds = (await cdp.command("DOM.querySelectorAll", { nodeId: document.root.nodeId, selector: "*" })).nodeIds as number[]
		const provenance: unknown[] = []
		for (const nodeId of nodeIds) {
			const [description, matched, computed] = await Promise.all([
				cdp.command("DOM.describeNode", { nodeId }), cdp.command("CSS.getMatchedStylesForNode", { nodeId }), cdp.command("CSS.getComputedStyleForNode", { nodeId }),
			])
			provenance.push({ nodeName: description.node.nodeName, computed: Object.fromEntries(computed.computedStyle.filter((p: any) => STYLE_PROPERTIES.includes(p.name)).map((p: any) => [p.name, p.value])), declarations: provenanceFromMatched(matched) })
		}
		const snapshot = await cdp.command("DOMSnapshot.captureSnapshot", { computedStyles: [...STYLE_PROPERTIES], includePaintOrder: true, includeDOMRects: true, includeBlendedBackgroundColors: true, includeTextColorOpacities: true })
		// CDP allocates backend node IDs afresh on every navigation. They are transport
		// handles, not source evidence, so retaining them would make equal pages differ.
		for (const item of snapshot.documents ?? []) delete item.nodes?.backendNodeId
		const screenshot = Buffer.from((await cdp.command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false })).data, "base64")
		const hostCalls = (await cdp.command("Runtime.evaluate", { expression: "globalThis.__pulpCaptureHostCalls||[]", returnByValue: true })).result.value
		const evidence = { schema: SCHEMA, policy: { viewport: manifest.viewport, clock: manifest.clock, settleFrames: frames, animations: "disabled", transitions: "disabled", network: "denied", hostServices: "recording-fake" }, page: { url: page.url, title: page.title }, snapshot, styleProvenanceByDomOrder: provenance, hostCalls }
		const output = resolve(manifest.output); await mkdir(output, { recursive: true })
		const evidenceBytes = stableJson(evidence)
		await writeFile(resolve(output, "source.png"), screenshot)
		await writeFile(resolve(output, "source.json"), evidenceBytes)
		const metadata = { schema: SCHEMA, screenshotSha256: sha256(screenshot), evidenceSha256: sha256(evidenceBytes), manifestSha256: sha256(stableJson({ ...manifest, output: "<output>" })) }
		await writeFile(resolve(output, "meta.json"), stableJson(metadata))
		return metadata
	} finally { cdp.close() }
}

async function main() {
	const flag = process.argv.indexOf("--manifest")
	if (flag < 0 || !process.argv[flag + 1]) throw new Error("usage: capture-source-cdp.ts --manifest capture.json")
	const manifest = validateManifest(JSON.parse(await readFile(resolve(process.argv[flag + 1]), "utf8")))
	console.log(stableJson(await capture(manifest)).trim())
}

if (import.meta.main) await main()
