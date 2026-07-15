#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { once } from "node:events"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { domSnapshotToObserved } from "./domsnapshot-to-observed"
import {
	hostCapabilityProjectionBootstrapSource,
	hostCapabilityProjectionReceipt,
	type HostCapabilityProjection,
	validateHostCapabilityProjection,
} from "./host-capability-projection"
import {
	rootStatePredicateExpression,
	rootStatePredicateProvenance,
	rootStatePredicateReceipt,
	type RootStatePredicate,
	validateRootStatePredicate,
} from "./root-state-predicate"

export type Json = Record<string, unknown>

export const SCHEMA = "pulp-runtime-source-capture-v1"
export const STYLE_PROPERTIES = [
	"display", "position", "flex-direction", "flex-grow", "flex-shrink", "flex-basis",
	"flex-wrap", "align-items", "align-self", "align-content", "justify-content", "gap",
	"padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right",
	"margin-bottom", "margin-left", "width", "height", "min-width", "min-height", "max-width",
	"max-height", "top", "right", "bottom", "left", "color", "background-color",
	"background-image", "transform", "filter", "backdrop-filter", "font-family", "font-size",
	"font-weight", "font-style", "font-feature-settings", "text-rendering", "line-height", "white-space", "text-align", "text-overflow",
	"overflow-wrap", "letter-spacing", "border-top-width", "border-right-width",
	"border-bottom-width", "border-left-width", "border-top-color", "border-right-color",
	"border-bottom-color", "border-left-color", "border-top-left-radius", "border-top-right-radius",
	"border-bottom-right-radius", "border-bottom-left-radius", "corner-shape", "opacity", "box-shadow", "cursor",
	"overflow-x", "overflow-y", "scrollbar-color", "scrollbar-width", "contain-intrinsic-size",
	"stroke-dasharray", "visibility", "z-index", "pointer-events",
] as const

export const LAYOUT_PROVENANCE_PROPERTIES = [
	"height",
	"margin-bottom",
	"margin-left",
	"margin-right",
	"margin-top",
	"max-height",
	"max-width",
	"min-height",
	"min-width",
	"width",
] as const

export function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex")
}

export function stableJson(value: unknown): string {
	// Sort one object at a time through JSON.stringify's replacer. Building a
	// fully recursive sorted clone first doubles the live size of DOMSnapshot
	// evidence and can exhaust the capture process on real application trees.
	// The replacer retains array order and produces the same canonical key order
	// without keeping a second complete evidence graph alive.
	return `${JSON.stringify(value, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
			: item, 2)}\n`
}

export async function writeStableJson(path: string, value: unknown): Promise<string> {
	const output = createWriteStream(path, { encoding: "utf8" })
	const digest = createHash("sha256")
	const active = new WeakSet<object>()
	let pending = ""
	const flush = async (force = false) => {
		if (!pending.length || (!force && pending.length < 256 * 1024)) return
		const chunk = pending
		pending = ""
		digest.update(chunk)
		if (!output.write(chunk)) await once(output, "drain")
	}
	const append = async (chunk: string) => {
		pending += chunk
		await flush()
	}
	const indent = (depth: number) => "  ".repeat(depth)
	const writeValue = async (item: unknown, depth: number): Promise<void> => {
		if (item === null) { await append("null"); return }
		if (typeof item === "string" || typeof item === "boolean") {
			await append(JSON.stringify(item)); return
		}
		if (typeof item === "number") {
			await append(Number.isFinite(item) ? String(item) : "null"); return
		}
		if (typeof item !== "object") throw new TypeError(`unsupported canonical JSON value: ${typeof item}`)
		if (active.has(item)) throw new TypeError("circular canonical JSON value")
		active.add(item)
		if (Array.isArray(item)) {
			if (!item.length) await append("[]")
			else {
				await append("[\n")
				for (let index = 0; index < item.length; index++) {
					await append(indent(depth + 1))
					const child = item[index]
					await writeValue(child === undefined || typeof child === "function" || typeof child === "symbol" ? null : child, depth + 1)
					await append(index + 1 === item.length ? "\n" : ",\n")
				}
				await append(`${indent(depth)}]`)
			}
		} else {
			const record = item as Record<string, unknown>
			const keys = Object.keys(record).sort().filter((key) => {
				const child = record[key]
				return child !== undefined && typeof child !== "function" && typeof child !== "symbol"
			})
			if (!keys.length) await append("{}")
			else {
				await append("{\n")
				for (let index = 0; index < keys.length; index++) {
					const key = keys[index]
					await append(`${indent(depth + 1)}${JSON.stringify(key)}: `)
					await writeValue(record[key], depth + 1)
					await append(index + 1 === keys.length ? "\n" : ",\n")
				}
				await append(`${indent(depth)}}`)
			}
		}
		active.delete(item)
	}
	try {
		await writeValue(value, 0)
		await append("\n")
		await flush(true)
		output.end()
		await once(output, "finish")
		return digest.digest("hex")
	} catch (error) {
		output.destroy()
		throw error
	}
}

export interface LocalizedRemoteImageReceipt {
	sourceUrl: string
	authoredUrls?: string[]
	mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml"
	byteLength: number
	contentSha256: string
	dataUri: string
}

const localizedImageMimes = new Set<LocalizedRemoteImageReceipt["mime"]>([
	"image/png", "image/jpeg", "image/webp", "image/svg+xml",
])
const maxLocalizedImageBytes = 1024 * 1024

export async function localizeRemoteImageUrls(
	urls: readonly string[],
	request: typeof fetch = fetch,
): Promise<LocalizedRemoteImageReceipt[]> {
	const unique = [...new Set(urls)].sort()
	if (unique.length > 64) throw new Error("capture contains more than 64 remote image resources")
	return mapWithConcurrency(unique, 4, async (sourceUrl) => {
		const parsed = new URL(sourceUrl)
		if (!['http:', 'https:'].includes(parsed.protocol))
			throw new Error(`remote image URL has unsupported scheme: ${sourceUrl}`)
		const response = await request(sourceUrl, { signal: AbortSignal.timeout(10000), redirect: "follow" })
		if (!response.ok) throw new Error(`remote image fetch failed (${response.status}): ${sourceUrl}`)
		const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase()
		if (!localizedImageMimes.has(mime as LocalizedRemoteImageReceipt["mime"]))
			throw new Error(`remote image has unsupported MIME ${mime || "<missing>"}: ${sourceUrl}`)
		const declaredLength = Number(response.headers.get("content-length"))
		if (Number.isFinite(declaredLength) && declaredLength > maxLocalizedImageBytes)
			throw new Error(`remote image exceeds ${maxLocalizedImageBytes} bytes: ${sourceUrl}`)
		const bytes = new Uint8Array(await response.arrayBuffer())
		if (bytes.length === 0 || bytes.length > maxLocalizedImageBytes)
			throw new Error(`remote image has invalid bounded length ${bytes.length}: ${sourceUrl}`)
		if (!hasExpectedImageSignature(mime as LocalizedRemoteImageReceipt["mime"], bytes))
			throw new Error(`remote image bytes do not match declared MIME ${mime}: ${sourceUrl}`)
		const base64 = Buffer.from(bytes).toString("base64")
		return {
			sourceUrl,
			mime: mime as LocalizedRemoteImageReceipt["mime"],
			byteLength: bytes.length,
			contentSha256: sha256(bytes),
			dataUri: `data:${mime};base64,${base64}`,
		}
	})
}

function hasExpectedImageSignature(mime: LocalizedRemoteImageReceipt["mime"], bytes: Uint8Array): boolean {
	if (mime === "image/png")
		return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
			.every((value, index) => bytes[index] === value)
	if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
	if (mime === "image/webp")
		return bytes.length >= 12 && new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" &&
			new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
	try { return /^<svg(?:\s|>)/i.test(new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim()) }
	catch { return false }
}

async function captureRemoteImageReceipts(cdp: Cdp, allowedOrigin?: string): Promise<LocalizedRemoteImageReceipt[]> {
	const value = (await cdp.command("Runtime.evaluate", {
		expression: `JSON.stringify([...document.images].map(image=>({sourceUrl:image.currentSrc||image.src,authoredUrl:image.getAttribute('src')||''})).filter(image=>/^https?:\\/\\//i.test(image.sourceUrl)))`,
		returnByValue: true,
	})).result?.value
	const inventory = JSON.parse(typeof value === "string" ? value : "[]")
	if (!Array.isArray(inventory) || inventory.some((item) => typeof item?.sourceUrl !== "string" || typeof item?.authoredUrl !== "string"))
		throw new Error("remote image inventory is malformed")
	const eligible = allowedOrigin
		? inventory.filter((item) => new URL(item.sourceUrl).origin === allowedOrigin)
		: inventory
	const localized = await localizeRemoteImageUrls(eligible.map((item) => item.sourceUrl))
	return localized.map((receipt) => ({
		...receipt,
		authoredUrls: [...new Set(inventory.filter((item) => item.sourceUrl === receipt.sourceUrl)
			.map((item) => item.authoredUrl).filter(Boolean))].sort() as string[],
	}))
}

export function applyLocalizedRemoteImages(root: any, receipts: readonly LocalizedRemoteImageReceipt[]): void {
	const byUrl = new Map(receipts.flatMap((receipt) => [receipt.sourceUrl, ...(receipt.authoredUrls ?? [])]
		.map((url) => [url, receipt.dataUri] as const)))
	const visit = (node: any) => {
		if (node?.tagName?.toLowerCase?.() === "img" && typeof node.attributes?.src === "string") {
			const localized = byUrl.get(node.attributes.src)
			if (localized) node.attributes.src = localized
		}
		for (const child of node?.children ?? []) visit(child)
	}
	visit(root)
}

export interface CaptureManifest {
	schemaVersion: 1
	cdpEndpoint: string
	pageUrlPattern?: string
	output: string
	viewport: { width: number; height: number; deviceScaleFactor: number }
	clock: string
	sourceRevision?: string
	settleFrames?: number
	timeoutMs?: number
	reload?: boolean
	preserveLivePage?: boolean
	structuralStateCapture?: boolean
	includeMatchedStyles?: boolean
	matchedStyleScope?: "all" | "text-and-interactive"
	matchedStyleSelectors?: string[]
	semanticRoleProbes?: Array<{
		containerSelector: string
		roles: Array<"paragraph" | "strong" | "inline-code" | "metadata">
	}>
	clearStorage?: boolean
	runtimeState?: RuntimeStorageSeed
	hostCapabilityProjection?: HostCapabilityProjection
	rootStatePredicate?: RootStatePredicate
	windowSurfaceState?: "transparent-preference" | "opaque-preference"
	state?: { selector: string; pseudo?: "hover" | "active" | "focus" }
	security: { mode: "recording-fake"; isolatedProfile?: boolean }
}

export interface RuntimeStorageSeed {
	localStorage?: Record<string, string>
	sessionStorage?: Record<string, string>
}

const sensitiveStorageKey = /(?:password|passwd|secret|credential|cookie|auth(?:entication|orization)?|(?:^|[-_:])token(?:$|[-_:])|access[-_]?token|refresh[-_]?token|api[-_]?key|session[-_]?id)/i

export function validateRuntimeStorageSeed(input: unknown): RuntimeStorageSeed {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("runtimeState must be an object")
	const allowed = new Set(["localStorage", "sessionStorage"])
	for (const key of Object.keys(input as Record<string, unknown>))
		if (!allowed.has(key)) throw new Error(`runtimeState has unsupported store ${key}`)
	let total = 0
	for (const storeName of allowed) {
		const store = (input as any)[storeName]
		if (store === undefined) continue
		if (!store || typeof store !== "object" || Array.isArray(store))
			throw new Error(`runtimeState.${storeName} must be a string map`)
		for (const [key, value] of Object.entries(store)) {
			total++
			if (!key || key.length > 256) throw new Error(`runtimeState.${storeName} has an invalid key`)
			if (sensitiveStorageKey.test(key)) throw new Error(`runtimeState.${storeName} key is credential-like and cannot be captured`)
			if (typeof value !== "string" || value.length > 4096)
				throw new Error(`runtimeState.${storeName}.${key} must be a bounded string`)
		}
	}
	if (total === 0 || total > 64) throw new Error("runtimeState must contain from 1 through 64 entries")
	return input as RuntimeStorageSeed
}

export function runtimeStateProvenance(seed?: RuntimeStorageSeed): Record<string, unknown> {
	if (!seed) return { mode: "unspecified" }
	const canonical = stableJson(seed)
	return {
		mode: "explicit-storage-seed",
		sha256: sha256(canonical),
		localStorageEntries: Object.keys(seed.localStorage ?? {}).length,
		sessionStorageEntries: Object.keys(seed.sessionStorage ?? {}).length,
	}
}

export function captureCohortIdentity(manifest: Pick<CaptureManifest,
	"clock" | "sourceRevision" | "pageUrlPattern" | "viewport" | "settleFrames" |
	"reload" | "clearStorage" | "runtimeState" | "hostCapabilityProjection" |
	"rootStatePredicate" | "windowSurfaceState" | "security">): string {
	return sha256(stableJson({
		schema: "pulp-runtime-source-capture-cohort-v1",
		clock: manifest.clock,
		sourceRevision: manifest.sourceRevision ?? null,
		pageUrlPattern: manifest.pageUrlPattern ?? null,
		deviceScaleFactor: manifest.viewport.deviceScaleFactor,
		settleFrames: manifest.settleFrames ?? 2,
		reload: manifest.reload !== false,
		clearStorage: !!manifest.clearStorage,
		runtimeState: runtimeStateProvenance(manifest.runtimeState),
		hostCapabilityProjection: manifest.hostCapabilityProjection
			? hostCapabilityProjectionReceipt(manifest.hostCapabilityProjection) : { mode: "unspecified" },
		rootStatePredicate: manifest.rootStatePredicate
			? { provenanceSha256: rootStatePredicateProvenance(manifest.rootStatePredicate) }
			: { mode: "unspecified" },
		windowSurfaceState: manifest.windowSurfaceState ?? null,
		security: { mode: manifest.security.mode, isolatedProfile: !!manifest.security.isolatedProfile },
	}))
}

export function runtimeStorageBootstrapSource(seed?: RuntimeStorageSeed, clear = false): string {
	const local = seed?.localStorage ?? {}, session = seed?.sessionStorage ?? {}
	return `(()=>{const apply=(store,entries)=>{${clear ? "store.clear();" : ""}for(const [key,value] of entries)store.setItem(key,value)};apply(localStorage,${JSON.stringify(Object.entries(local))});apply(sessionStorage,${JSON.stringify(Object.entries(session))})})()`
}

export async function captureRootStatePredicate(
	cdp: Pick<Cdp, "command">, declaration: RootStatePredicate,
) {
	const evaluated = await cdp.command("Runtime.evaluate", {
		expression: rootStatePredicateExpression(declaration),
		returnByValue: true,
	})
	if (evaluated.exceptionDetails)
		throw new Error("root-state predicate evaluation raised an exception")
	return rootStatePredicateReceipt(declaration, evaluated.result?.value)
}

export interface SnapshotElementRef { nodeIndex: number; backendNodeId: number; nodeName: string }

export interface SemanticRoleReceipt {
	containerSelector: string
	role: "paragraph" | "strong" | "inline-code" | "metadata"
	tagName: string
	computedStyle: Record<string, string>
	method: "authored-cascade-offscreen-clone"
}

export function semanticRoleProbeExpression(
	probes: NonNullable<CaptureManifest["semanticRoleProbes"]>,
): string {
	return `(() => {const specs=${JSON.stringify(probes)};const properties=${JSON.stringify([...STYLE_PROPERTIES])};const tags={paragraph:'p',strong:'strong','inline-code':'code',metadata:'small'};const selectors={paragraph:'p',strong:'strong,b','inline-code':'code,[data-streamdown="inline-code"]',metadata:'small'};const out=[];for(const spec of specs){const source=document.querySelector(spec.containerSelector);if(!source)throw new Error('semantic role probe container not found: '+spec.containerSelector);const shell=source.cloneNode(false);shell.removeAttribute('id');shell.setAttribute('aria-hidden','true');Object.assign(shell.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none',contain:'strict'});source.parentNode.insertBefore(shell,source.nextSibling);try{for(const role of spec.roles){const representative=source.matches(selectors[role])?source:source.querySelector(selectors[role]);let target;if(representative){const ancestry=[];for(let current=representative;current&&current!==source;current=current.parentElement)ancestry.push(current);let parent=shell;for(const current of ancestry.reverse()){const clone=current.cloneNode(false);clone.removeAttribute('id');parent.appendChild(clone);parent=clone}target=parent}else{const paragraph=document.createElement('p');target=role==='paragraph'?paragraph:document.createElement(tags[role]);if(target!==paragraph)paragraph.appendChild(target);shell.appendChild(paragraph)}target.textContent='M';const style=getComputedStyle(target);out.push({containerSelector:spec.containerSelector,role,tagName:target.tagName.toLowerCase(),computedStyle:Object.fromEntries(properties.map(name=>[name,style.getPropertyValue(name)])),method:'authored-cascade-offscreen-clone'});while(shell.firstChild)shell.firstChild.remove()}}finally{shell.remove()}}return out})()`
}

export function validateSemanticRoleReceipts(
	input: unknown,
	probes: NonNullable<CaptureManifest["semanticRoleProbes"]>,
): SemanticRoleReceipt[] {
	if (!Array.isArray(input)) throw new Error("semantic role probe evaluation returned no receipts")
	const expected = probes.flatMap((probe) => probe.roles.map((role) => ({
		containerSelector: probe.containerSelector, role,
	})))
	if (input.length !== expected.length)
		throw new Error(`semantic role probe receipt count mismatch: expected ${expected.length}, got ${input.length}`)
	return input.map((receipt: any, index) => {
		if (receipt?.containerSelector !== expected[index].containerSelector ||
			receipt?.role !== expected[index].role ||
			receipt?.method !== "authored-cascade-offscreen-clone" ||
			typeof receipt?.tagName !== "string" || !receipt.tagName ||
			!receipt.computedStyle || Object.values(receipt.computedStyle).some((value) => typeof value !== "string"))
			throw new Error(`semantic role probe receipt ${index} is malformed or out of order`)
		return receipt as SemanticRoleReceipt
	})
}

export interface MotionReceipt {
	name: string; durationMs: number; delayMs: number; easing: string; iterations: number | "infinite"
	direction: string; fill: string; playState: string
	keyframes: Array<{ offset: number; easing: string; composite: string; transform?: string; opacity?: string }>
}

export interface TransientStyleGateReceipt {
	status: "passed"
	settleMs: number
	styleSamples: number
	activeTransitions: number
	unstableElements: number
}

export function validateTransientStyleGateReceipt(input: unknown): TransientStyleGateReceipt {
	const receipt = input as Partial<TransientStyleGateReceipt> | null
	if (!receipt || receipt.status !== "passed" || !Number.isFinite(receipt.settleMs) ||
		!Number.isInteger(receipt.styleSamples) || (receipt.styleSamples ?? 0) < 2 ||
		!Number.isInteger(receipt.activeTransitions) || receipt.activeTransitions !== 0 ||
		!Number.isInteger(receipt.unstableElements) || receipt.unstableElements !== 0)
		throw new Error("transient-style capture poison gate did not prove a settled style frontier")
	return receipt as TransientStyleGateReceipt
}

export function validateMotionReceipts(input: unknown): MotionReceipt[] {
	if (!Array.isArray(input)) throw new Error("motion receipt must be an array")
	return input.map((item: any, index) => {
		if (!item || typeof item.name !== "string" || !item.name) throw new Error(`motion receipt ${index} has no animation name`)
		for (const field of ["durationMs", "delayMs"]) if (!Number.isFinite(item[field])) throw new Error(`motion receipt ${index} has invalid ${field}`)
		if (!(item.iterations === "infinite" || Number.isFinite(item.iterations))) throw new Error(`motion receipt ${index} has invalid iterations`)
		for (const field of ["easing", "direction", "fill", "playState"]) if (typeof item[field] !== "string") throw new Error(`motion receipt ${index} has invalid ${field}`)
		if (!Array.isArray(item.keyframes) || item.keyframes.length === 0) throw new Error(`motion receipt ${index} has no keyframes`)
		for (const [frameIndex, frame] of item.keyframes.entries()) {
			if (!Number.isFinite(frame.offset) || frame.offset < 0 || frame.offset > 1) throw new Error(`motion receipt ${index} keyframe ${frameIndex} has invalid offset`)
			const keys = Object.keys(frame).filter((key) => !["offset", "easing", "composite", "transform", "opacity", "computedOffset"].includes(key))
			if (keys.length) throw new Error(`motion receipt ${index} keyframe ${frameIndex} has unsupported properties: ${keys.join(",")}`)
			if (frame.transform !== undefined && !/^(none|rotate\(\s*-?(?:\d+|\d*\.\d+)deg\s*\))$/.test(frame.transform))
				throw new Error(`motion receipt ${index} keyframe ${frameIndex} has unsupported transform: ${frame.transform}`)
			if (frame.opacity !== undefined && !Number.isFinite(Number(frame.opacity))) throw new Error(`motion receipt ${index} keyframe ${frameIndex} has unsupported opacity`)
		}
		return item as MotionReceipt
	})
}

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
	if (input.runtimeState !== undefined) {
		validateRuntimeStorageSeed(input.runtimeState)
		if (input.security?.isolatedProfile !== true || input.clearStorage !== true)
			throw new Error("runtimeState requires clearStorage=true and security.isolatedProfile=true")
		if (input.reload === false || input.preserveLivePage)
			throw new Error("runtimeState requires a reloaded isolated capture")
	}
	if (input.preserveLivePage && input.reload !== false)
		throw new Error("preserveLivePage requires reload=false")
	if (input.hostCapabilityProjection !== undefined) {
		validateHostCapabilityProjection(input.hostCapabilityProjection)
		if (input.preserveLivePage)
			throw new Error("hostCapabilityProjection cannot replace capabilities on a preserved live page")
	}
	if (input.rootStatePredicate !== undefined)
		validateRootStatePredicate(input.rootStatePredicate)
	if (input.windowSurfaceState !== undefined &&
		!["transparent-preference", "opaque-preference"].includes(input.windowSurfaceState))
		throw new Error("windowSurfaceState is unsupported")
	if (input.windowSurfaceState !== undefined && input.rootStatePredicate === undefined)
		throw new Error("windowSurfaceState requires rootStatePredicate proof")
	if (input.hostCapabilityProjection !== undefined && input.rootStatePredicate === undefined)
		throw new Error("hostCapabilityProjection requires rootStatePredicate proof of the projected application state")
	if (input.state?.pseudo && !["hover", "active", "focus"].includes(input.state.pseudo))
		throw new Error("unsupported forced pseudo state")
	if (input.matchedStyleScope !== undefined &&
		!["all", "text-and-interactive"].includes(input.matchedStyleScope))
		throw new Error("matchedStyleScope must be all or text-and-interactive")
	for (const [index, probe] of (input.semanticRoleProbes ?? []).entries()) {
		if (typeof probe?.containerSelector !== "string" || !probe.containerSelector.trim())
			throw new Error(`semanticRoleProbes[${index}] requires a containerSelector`)
		if (!Array.isArray(probe.roles) || probe.roles.length === 0 ||
			probe.roles.some((role: string) => !["paragraph", "strong", "inline-code", "metadata"].includes(role)))
			throw new Error(`semanticRoleProbes[${index}] has unsupported roles`)
		if (new Set(probe.roles).size !== probe.roles.length)
			throw new Error(`semanticRoleProbes[${index}] has duplicate roles`)
	}
	return input
}

export function shouldCaptureMatchedStyles(
	manifest: Pick<CaptureManifest, "includeMatchedStyles" | "matchedStyleScope">,
	element: { hasDirectText?: boolean; critical?: boolean; matchedEvidence?: boolean; matchedEvidenceProperties?: string[] },
): boolean {
	if (manifest.matchedStyleScope === "all" || manifest.includeMatchedStyles) return true
	if (manifest.matchedStyleScope === "text-and-interactive")
		return !!element.hasDirectText || !!element.critical || !!element.matchedEvidence ||
			!!element.matchedEvidenceProperties?.length
	return !!element.matchedEvidence || !!element.matchedEvidenceProperties?.length
}

export async function captureMatchedStyleReceipts(
	cdp: Pick<Cdp, "command">,
	nodeIds: readonly number[],
	elements: readonly Array<{
		hasDirectText?: boolean
		critical?: boolean
		matchedEvidence?: boolean
		matchedEvidenceProperties?: string[]
	}>,
	manifest: Pick<CaptureManifest,
		"includeMatchedStyles" | "matchedStyleScope" | "structuralStateCapture">,
): Promise<any[]> {
	if (nodeIds.length !== elements.length)
		throw new Error("matched-style capture node and element counts differ")
	return mapWithConcurrency(nodeIds, 32, (nodeId, index) =>
		!manifest.structuralStateCapture && shouldCaptureMatchedStyles(manifest, elements[index])
			? cdp.command("CSS.getMatchedStylesForNode", { nodeId })
			: Promise.resolve(null))
}

export function elementProvenanceFunctionDeclaration(matchedSelectors: readonly string[] = []): string {
	return `function(){const properties=${JSON.stringify([...STYLE_PROPERTIES])};const layoutProvenanceProperties=${JSON.stringify([...LAYOUT_PROVENANCE_PROPERTIES])};const matchedSelectors=${JSON.stringify(matchedSelectors)};const style=getComputedStyle(this);const computed=Object.fromEntries(properties.map(name=>[name,style.getPropertyValue(name)]));let winningDeclarations={};try{const typed=this.computedStyleMap?.();if(typed)winningDeclarations=Object.fromEntries(properties.map(name=>[name,typed.get(name)?.toString?.()??'']).filter(([,value])=>value!==''))}catch{}const clone=this.cloneNode(false);const excluded=['SCRIPT','STYLE','TEMPLATE'].includes(this.nodeName);const hasDirectText=!excluded&&this.getClientRects().length>0&&style.display!=='none'&&style.visibility!=='hidden'&&[...this.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.nodeValue.trim()!=='');const fontKey=[style.fontFamily,style.fontWeight,style.fontStyle,style.fontSize].join('|');const critical=this.matches('button,input,textarea,[role],[aria-label]')||!!this.closest('main,[role=main],[role=dialog]');const matchedEvidenceProperties=layoutProvenanceProperties;const matchedEvidence=matchedSelectors.some(selector=>this.matches(selector));const scrollGeometry={clientWidth:this.clientWidth,clientHeight:this.clientHeight,scrollWidth:this.scrollWidth,scrollHeight:this.scrollHeight,scrollLeft:this.scrollLeft,scrollTop:this.scrollTop};return {nodeName:this.nodeName,computed,winningDeclarations,hasDirectText,fontKey,critical,matchedEvidence,matchedEvidenceProperties,scrollGeometry,outerHTML:this instanceof SVGElement?this.outerHTML:clone.outerHTML}}`
}

function matchedStylesAreNodeComplete(manifest: CaptureManifest, element: any): boolean {
	if (manifest.matchedStyleScope === "all" || manifest.includeMatchedStyles) return true
	if (manifest.matchedStyleScope === "text-and-interactive" &&
		(element.hasDirectText || element.critical)) return true
	return !!element.matchedEvidence
}

export function bootstrapSource(clock: string, hostCapabilityProjection?: HostCapabilityProjection): string {
	const epoch = Date.parse(clock)
	const projectionSource = hostCapabilityProjection
		? hostCapabilityProjectionBootstrapSource(hostCapabilityProjection) : ""
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
})();${projectionSource}`
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

export async function mapWithConcurrency<T, U>(
	items: readonly T[], limit: number, transform: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
	if (!Number.isInteger(limit) || limit < 1) throw new Error("concurrency limit must be a positive integer")
	const result = new Array<U>(items.length)
	let cursor = 0
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++
			result[index] = await transform(items[index], index)
		}
	}))
	return result
}

async function settleTransientStyles(cdp: Cdp, timeoutMs = 5000): Promise<TransientStyleGateReceipt> {
	const properties = ["display", "visibility", "opacity", "transform", "filter", "width", "height", "top", "right", "bottom", "left"]
	const evaluated = await cdp.command("Runtime.evaluate", {
		expression: `(async()=>{const timeoutMs=${timeoutMs};const properties=${JSON.stringify(properties)};const start=performance.now();const active=()=>document.getAnimations({subtree:true}).filter(animation=>animation?.constructor?.name==='CSSTransition'&&!['finished','idle'].includes(animation.playState));const transitions=active();for(const animation of transitions){const endTime=Number(animation.effect?.getComputedTiming?.().endTime);if(Number.isFinite(endTime))try{animation.finish()}catch{}}await Promise.resolve();const remaining=active();if(remaining.length)return{status:'failed',reason:'active-transitions',settleMs:performance.now()-start,styleSamples:0,activeTransitions:remaining.length,unstableElements:0,transitions:remaining.slice(0,20).map(animation=>({property:animation.transitionProperty??'<unknown>',playState:animation.playState,currentTime:Number(animation.currentTime),endTime:Number(animation.effect?.getComputedTiming?.().endTime)}))};const sample=()=>[...document.querySelectorAll('*')].map((element,index)=>{const style=getComputedStyle(element);return[index,properties.map(property=>style.getPropertyValue(property))]});let previous=sample();let samples=1;for(let round=0;round<2;round++){await Promise.resolve();const current=sample();samples++;const unstable=[];for(let index=0;index<Math.max(previous.length,current.length);index++)if(JSON.stringify(previous[index])!==JSON.stringify(current[index]))unstable.push(index);if(unstable.length)return{status:'failed',reason:'unstable-computed-style',settleMs:performance.now()-start,styleSamples:samples,activeTransitions:0,unstableElements:unstable.length,unstable:unstable.slice(0,20)};previous=current}return{status:'passed',settleMs:performance.now()-start,styleSamples:samples,activeTransitions:0,unstableElements:0}})()`,
		awaitPromise: true, returnByValue: true,
	}, timeoutMs + 10000)
	if (evaluated.exceptionDetails) throw new Error("transient-style capture poison gate evaluation failed")
	try { return validateTransientStyleGateReceipt(evaluated.result?.value) }
	catch (error) {
		throw new Error(`${error}: ${JSON.stringify(evaluated.result?.value ?? null)}`)
	}
}

export async function captureCurrentStructuralState(cdp: Cdp, options: {
	output: string; viewport: { width: number; height: number; deviceScaleFactor: number }
	clock: string; sourceRevision: string; cohortSha256?: string; runtimeState?: RuntimeStorageSeed
}): Promise<Record<string, string>> {
	const output = resolve(options.output), staging = `${output}.capturing-${process.pid}`
	await rm(staging, { recursive: true, force: true })
	try {
		// A structural state must represent a stable application state, never a
		// sample from the middle of a CSS transition. Wait for finite authored
		// transitions to finish and require two identical computed-style frames
		// before installing the static capture policy. Infinite CSS animations
		// are motion intent and remain handled by the separate motion lane.
		const transientStyleGate = await settleTransientStyles(cdp)
		const remoteImageReceipts = await captureRemoteImageReceipts(cdp)
		// Application-state candidates describe discrete topology and paint,
		// not an arbitrary sample from an unrelated animation timeline. Motion
		// intent is captured separately by the canonical source capture.
		await cdp.command("Runtime.evaluate", { expression: `(()=>{let s=document.querySelector('style[data-pulp-capture-policy]');if(!s){s=document.createElement('style');s.dataset.pulpCapturePolicy='true';document.documentElement.appendChild(s)}s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'})()` })
		await Bun.sleep(16)
		await cdp.command("DOM.getDocument", { depth: -1, pierce: true })
		const metrics = await cdp.command("Page.getLayoutMetrics"), cssViewport = metrics.cssLayoutViewport
		if (Math.abs(cssViewport?.clientWidth - options.viewport.width) > .5 || Math.abs(cssViewport?.clientHeight - options.viewport.height) > .5)
			throw new Error(`live state viewport ${cssViewport?.clientWidth}x${cssViewport?.clientHeight} does not match manifest ${options.viewport.width}x${options.viewport.height}`)
		const snapshot = await cdp.command("DOMSnapshot.captureSnapshot", { computedStyles: [...STYLE_PROPERTIES], includePaintOrder: true, includeDOMRects: true, includeBlendedBackgroundColors: true, includeTextColorOpacities: true })
		const refs = snapshotOrdinaryElementRefs(snapshot)
		const nodeIds = (await cdp.command("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: refs.map(ref => ref.backendNodeId) })).nodeIds as number[]
		const records = await mapWithConcurrency(nodeIds, 32, async (nodeId, index) => {
			const resolved = await cdp.command("DOM.resolveNode", { nodeId })
			if (!resolved.object?.objectId) throw new Error(`live state node ${refs[index].backendNodeId} is stale`)
			const called = await cdp.command("Runtime.callFunctionOn", { objectId: resolved.object.objectId, returnByValue: true,
				functionDeclaration: `function(){const properties=${JSON.stringify([...STYLE_PROPERTIES])};const style=getComputedStyle(this);const clone=this.cloneNode(false);const scrollGeometry={clientWidth:this.clientWidth,clientHeight:this.clientHeight,scrollWidth:this.scrollWidth,scrollHeight:this.scrollHeight,scrollLeft:this.scrollLeft,scrollTop:this.scrollTop};return{nodeName:this.nodeName,computed:Object.fromEntries(properties.map(name=>[name,style.getPropertyValue(name)])),scrollGeometry,outerHTML:this instanceof SVGElement?this.outerHTML:clone.outerHTML}}` })
			if (called.exceptionDetails || !called.result?.value) throw new Error(`live state node ${refs[index].backendNodeId} evaluation failed`)
			return { backendNodeId: refs[index].backendNodeId, ...called.result.value }
		})
			const provenance = joinSnapshotProvenanceByBackendId(refs, records).map(record => ({ nodeName: record.nodeName, computed: record.computed, scrollGeometry: record.scrollGeometry, outerHTML: record.outerHTML, matchedStylesCapture: "omitted", matchedStylesCompleteProperties: [], winningDeclarations: {}, declarations: {}, usedFonts: [], usedFontsCapture: "omitted-state-structural", motion: [] }))
		const scale = cssViewport.clientWidth / metrics.layoutViewport.clientWidth
		const observedDom = domSnapshotToObserved(snapshot, STYLE_PROPERTIES, provenance, options.viewport.deviceScaleFactor, scale)
		applyLocalizedRemoteImages(observedDom, remoteImageReceipts)
		for (const document of snapshot.documents ?? []) delete document.nodes?.backendNodeId
		const screenshot = Buffer.from((await cdp.command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false })).data, "base64")
		const page = (await cdp.command("Runtime.evaluate", {
			expression: "({url:location.href,title:document.title})", returnByValue: true,
		})).result?.value
		if (!page?.url) throw new Error("live state page provenance is unavailable")
		const mediaQueries = ((await cdp.command("CSS.getMediaQueries")).medias ?? []).map((entry: any) => {
			const { styleSheetId: _styleSheetId, ...stable } = entry
			return stable
		})
		const rootFontSize = Number.parseFloat((await cdp.command("Runtime.evaluate", {
			expression: "getComputedStyle(document.documentElement).fontSize", returnByValue: true,
		})).result.value) || 16
		const authoredThresholds = authoredViewportThresholds(mediaQueries, rootFontSize)
		const evidence = { schema: SCHEMA, policy: { viewport: options.viewport, clock: options.clock, sourceRevision: options.sourceRevision, settleFrames: 0, reload: false, clearStorage: false, runtimeState: runtimeStateProvenance(options.runtimeState), cohortSha256: options.cohortSha256, animations: "disabled-state-structural", transitions: "settled-then-disabled", transientStyleGate, network: "unchanged-live-session", hostServices: "live-existing" }, page, observedDom, snapshot, styleProvenanceByDomOrder: provenance, semanticRoleReceipts: [], motionReceipts: [], remoteImageReceipts, authoredMedia: { rootFontSize, queries: mediaQueries, viewportThresholds: authoredThresholds }, hostCalls: [] }
		await mkdir(staging, { recursive: true }); const bytes = stableJson(evidence)
		await writeFile(resolve(staging, "source.png"), screenshot); await writeFile(resolve(staging, "source.json"), bytes)
		const metadata = { schema: SCHEMA, screenshotSha256: sha256(screenshot), evidenceSha256: sha256(bytes), sourceRevision: options.sourceRevision }
		await writeFile(resolve(staging, "meta.json"), stableJson(metadata))
		await rm(output, { recursive: true, force: true }); await rename(staging, output); return metadata
	} finally { await rm(staging, { recursive: true, force: true }) }
}

export function provenanceFromMatched(
	matched: any,
	completeProperties?: readonly string[],
): Record<string, Array<Json>> {
	const result: Record<string, Array<Json>> = {}
	if (!matched) return result
	const propertyScope = completeProperties ? new Set(completeProperties) : undefined
	const collect = (rules: any[], inherited: boolean) => {
		for (const entry of rules ?? []) {
			const rule = entry.rule ?? entry
			for (const property of rule.style?.cssProperties ?? []) {
				if (!property.name || property.disabled || (propertyScope && !propertyScope.has(property.name))) continue
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
		if (!manifest.preserveLivePage) cdp.on("Fetch.requestPaused", (event) => {
			const allowed = isAllowedCaptureRequest(source, event.request.url)
			void cdp.command(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
				allowed ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: "BlockedByClient" })
		})
		if (!manifest.preserveLivePage)
			await cdp.command("Fetch.enable", { patterns: [{ urlPattern: "*" }] })
		if (!manifest.preserveLivePage)
			await cdp.command("Emulation.setDeviceMetricsOverride", { ...manifest.viewport, mobile: false, screenWidth: manifest.viewport.width, screenHeight: manifest.viewport.height })
		const layoutMetrics = await cdp.command("Page.getLayoutMetrics")
		const legacyViewport = layoutMetrics.layoutViewport
		const cssViewport = layoutMetrics.cssLayoutViewport
		if (!Number.isFinite(legacyViewport?.clientWidth) || !Number.isFinite(legacyViewport?.clientHeight) ||
			!Number.isFinite(cssViewport?.clientWidth) || !Number.isFinite(cssViewport?.clientHeight) ||
			legacyViewport.clientWidth <= 0 || legacyViewport.clientHeight <= 0)
			throw new Error("CDP layout metrics have no usable CSS coordinate conversion")
		const coordinateScaleX = cssViewport.clientWidth / legacyViewport.clientWidth
		const coordinateScaleY = cssViewport.clientHeight / legacyViewport.clientHeight
		if (Math.abs(coordinateScaleX - coordinateScaleY) > 0.0001)
			throw new Error(`CDP layout coordinate scale is anisotropic: ${coordinateScaleX} x ${coordinateScaleY}`)
		if (manifest.preserveLivePage &&
			(Math.abs(cssViewport.clientWidth - manifest.viewport.width) > 0.5 ||
			 Math.abs(cssViewport.clientHeight - manifest.viewport.height) > 0.5))
			throw new Error(`live page viewport ${cssViewport.clientWidth}x${cssViewport.clientHeight} does not match manifest ${manifest.viewport.width}x${manifest.viewport.height}`)
		if (manifest.clearStorage) {
			const storageBootstrap = runtimeStorageBootstrapSource(manifest.runtimeState, true)
			if (source.protocol !== "file:")
				await cdp.command("Storage.clearDataForOrigin", { origin: source.origin, storageTypes: "all" })
			await cdp.command("Runtime.evaluate", { expression: storageBootstrap })
			await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: storageBootstrap })
		}
		if (!manifest.preserveLivePage)
			await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: bootstrapSource(manifest.clock, manifest.hostCapabilityProjection) })
		if (manifest.reload === false) {
			if (!manifest.preserveLivePage)
				await cdp.command("Runtime.evaluate", { expression: bootstrapSource(manifest.clock, manifest.hostCapabilityProjection) })
		} else await cdp.command("Page.reload", { ignoreCache: true })
		const frames = manifest.settleFrames ?? 2
		for (let attempt = 0;; attempt++) {
			try { await cdp.command("Runtime.evaluate", { expression: `document.fonts.ready.then(()=>new Promise(done=>setTimeout(done,${frames}*16)))`, awaitPromise: true }); break }
			catch (error) {
				if (attempt >= 9 || !String(error).includes("Execution context was destroyed")) throw error
				await Bun.sleep(100)
			}
		}
		// Capture motion intent while the authored timeline is still live. The
		// static screenshot policy is installed only after these receipts exist.
		await cdp.command("DOM.getDocument", { depth: 0, pierce: true })
		const motionByBackendId = new Map<number, MotionReceipt[]>()
		if (!manifest.structuralStateCapture) {
		const motionSnapshot = await cdp.command("DOMSnapshot.captureSnapshot", {
			computedStyles: [], includePaintOrder: false, includeDOMRects: false,
		})
		const motionRefs = snapshotOrdinaryElementRefs(motionSnapshot)
		const motionNodeIds = (await cdp.command("DOM.pushNodesByBackendIdsToFrontend", {
			backendNodeIds: motionRefs.map((ref) => ref.backendNodeId),
		})).nodeIds as number[]
		await Promise.all(motionNodeIds.map(async (nodeId, index) => {
			const resolved = await cdp.command("DOM.resolveNode", { nodeId })
			if (!resolved.object?.objectId) throw new Error(`motion backendNodeId ${motionRefs[index].backendNodeId} is stale`)
			const called = await cdp.command("Runtime.callFunctionOn", {
				objectId: resolved.object.objectId, returnByValue: true,
				functionDeclaration: `function(){return this.getAnimations({subtree:false}).filter(animation=>typeof animation.animationName==='string'&&animation.animationName.length>0).map(animation=>{const effect=animation.effect;if(!(effect instanceof KeyframeEffect))throw new Error('unsupported non-keyframe animation');const timing=effect.getTiming();return{name:animation.animationName,durationMs:Number(timing.duration),delayMs:Number(timing.delay),easing:String(timing.easing),iterations:timing.iterations===Infinity?'infinite':Number(timing.iterations),direction:String(timing.direction),fill:String(timing.fill),playState:String(animation.playState),keyframes:effect.getKeyframes().map(frame=>Object.fromEntries(Object.entries(frame).filter(([key])=>!['offset','computedOffset'].includes(key)||key==='offset')))}})}`,
			})
			if (called.exceptionDetails) throw new Error(`motion receipt evaluation failed for backendNodeId ${motionRefs[index].backendNodeId}`)
			const receipts = validateMotionReceipts(called.result?.value ?? [])
			if (receipts.length) motionByBackendId.set(motionRefs[index].backendNodeId, receipts)
		}))
		await cdp.command("Runtime.evaluate", { expression: `(()=>{let s=document.querySelector('style[data-pulp-capture-policy]');if(!s){s=document.createElement('style');s.dataset.pulpCapturePolicy='true';document.documentElement.appendChild(s)}s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'})()` })
		// Let application startup use rAF, then prevent motion loops from
		// mutating inline styles between evidence and screenshot capture.
		await cdp.command("Runtime.evaluate", { expression: `(()=>{globalThis.requestAnimationFrame=()=>0;globalThis.cancelAnimationFrame=()=>{}})()` })
		await cdp.command("Runtime.evaluate", { expression: `(()=>{window.scrollTo(0,0);for(const element of document.querySelectorAll('*')){element.scrollLeft=0;element.scrollTop=0}document.activeElement?.blur?.()})()` })
		await cdp.command("Runtime.evaluate", { expression: `new Promise(done=>setTimeout(done,${frames}*16))`, awaitPromise: true })
		} else {
			await cdp.command("Runtime.evaluate", { expression: `(()=>{let s=document.querySelector('style[data-pulp-capture-policy]');if(!s){s=document.createElement('style');s.dataset.pulpCapturePolicy='true';document.documentElement.appendChild(s)}s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'})()` })
			await Bun.sleep(frames * 16)
		}
		let priorDomSignature = "", stableDomSamples = 0
		for (let attempt = 0; attempt < 100 && stableDomSamples < 2; attempt++) {
			const signature = (await cdp.command("Runtime.evaluate", { expression: `JSON.stringify([...document.querySelectorAll('*')].map(element=>{const clone=element.cloneNode(false);const text=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.nodeValue).join('');return[element.tagName,clone.outerHTML,text]}))`, returnByValue: true })).result.value
			stableDomSamples = signature === priorDomSignature ? stableDomSamples + 1 : 0
			priorDomSignature = signature
			if (stableDomSamples < 2) await Bun.sleep(20)
		}
		if (stableDomSamples < 2) throw new Error("DOM did not reach a stable provenance window")
		trace("settled")
		const rootPredicateReceipt = manifest.rootStatePredicate
			? await captureRootStatePredicate(cdp, manifest.rootStatePredicate)
			: undefined
		if (rootPredicateReceipt) trace("root-state predicate passed")
		const remoteImageReceipts = await captureRemoteImageReceipts(cdp,
			manifest.preserveLivePage ? undefined : source.origin)
		trace(`localized remote images ${remoteImageReceipts.length}`)
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
						functionDeclaration: elementProvenanceFunctionDeclaration(manifest.matchedStyleSelectors),
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
		const matched = await captureMatchedStyleReceipts(cdp, nodeIds, observedElements, manifest)
		const fontResults = new Map<number, any>()
		const candidates = manifest.structuralStateCapture ? [] :
			nodeIds.map((_, index) => index).filter((index) => observedElements[index].hasDirectText)
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
		// One queried representative is sufficient for every direct-text node
		// with the exact same computed font request. Propagate that receipt by
		// font key instead of leaving later nodes receipt-less because of the
		// bounded CDP query budget. This keeps the capture deterministic while
		// preserving per-node evidence through the observed-DOM adapter.
		const fontResultByKey = new Map<string, any>()
		for (const index of textIndices) {
			const result = fontResults.get(index)
			if (result?.fonts?.length && !fontResultByKey.has(observedElements[index].fontKey))
				fontResultByKey.set(observedElements[index].fontKey, result)
		}
		if (textIndices.length && ![...fontResults.values()].some((result) => result.fonts?.length))
			throw new Error("runtime font evidence returned no used fonts for rendered text")
		trace(`font evidence ${textIndices.length}`)
		const semanticRoleReceiptValue = manifest.semanticRoleProbes?.length
			? (await cdp.command("Runtime.evaluate", {
				expression: semanticRoleProbeExpression(manifest.semanticRoleProbes),
				returnByValue: true,
			})).result?.value
			: []
		const semanticRoleReceipts = validateSemanticRoleReceipts(
			semanticRoleReceiptValue, manifest.semanticRoleProbes ?? [])
		trace(`semantic role receipts ${semanticRoleReceipts.length}`)
		const provenance = observedElements.map((element, index) => {
			const directFontResult = fontResults.get(index)
			const fontResult = directFontResult?.fonts?.length ? directFontResult : fontResultByKey.get(element.fontKey)
			const stylesComplete = matched[index] && matchedStylesAreNodeComplete(manifest, element)
			const completeProperties = matched[index] && !stylesComplete
				? element.matchedEvidenceProperties ?? [] : undefined
			return ({
			nodeName: element.nodeName, computed: element.computed, scrollGeometry: element.scrollGeometry, outerHTML: element.outerHTML,
			matchedStylesCapture: matched[index]
				? (stylesComplete ? "complete" : "property-scoped") : "omitted",
			matchedStylesCompleteProperties: completeProperties ?? [],
			winningDeclarations: matched[index] ? element.winningDeclarations ?? {} : {},
			motion: motionByBackendId.get(snapshotRefs[index].backendNodeId) ?? [],
			declarations: provenanceFromMatched(matched[index], completeProperties),
			usedFonts: (fontResult?.fonts ?? []).map((font: any) => ({
				family: font.familyName, postScriptName: font.postScriptName,
				custom: !!font.isCustomFont, glyphCount: font.glyphCount,
			})).sort((a: any, b: any) => stableJson(a).localeCompare(stableJson(b))),
			usedFontsCapture: !element.hasDirectText ? "not-text-bearing" : index >= 0 && textIndices.includes(index)
				? (directFontResult?.error && !fontResult?.fonts?.length ? "query-failed" : "queried")
				: fontResult?.fonts?.length ? "font-key-reused" : "omitted-limit",
		})})
		const observedDom = domSnapshotToObserved(snapshot, STYLE_PROPERTIES, provenance,
			manifest.viewport.deviceScaleFactor, coordinateScaleX)
		applyLocalizedRemoteImages(observedDom, remoteImageReceipts)
		trace("observed DOM lowered")
		const sourceIdByProvenance: string[] = []
		const indexObserved = (node: any) => { if (node.provenanceIndex >= 0) sourceIdByProvenance[node.provenanceIndex] = node.sourceId; for (const child of node.children ?? []) indexObserved(child) }
		indexObserved(observedDom)
		// CDP allocates backend node IDs afresh on every navigation. They are transport
		// handles, not source evidence, so retaining them would make equal pages differ.
		for (const item of snapshot.documents ?? []) delete item.nodes?.backendNodeId
		const screenshot = Buffer.from((await cdp.command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false })).data, "base64")
		trace(`screenshot ${screenshot.length} bytes`)
		const hostCalls = (await cdp.command("Runtime.evaluate", { expression: "globalThis.__pulpCaptureHostCalls||[]", returnByValue: true })).result.value
		trace(`host calls ${hostCalls.length}`)
		const cohortSha256 = captureCohortIdentity(manifest)
		const hostProjectionReceipt = manifest.hostCapabilityProjection
			? hostCapabilityProjectionReceipt(manifest.hostCapabilityProjection) : undefined
		const evidence = { schema: SCHEMA, policy: { viewport: manifest.viewport, clock: manifest.clock, sourceRevision: manifest.sourceRevision, settleFrames: frames, reload: manifest.reload !== false, clearStorage: !!manifest.clearStorage, runtimeState: runtimeStateProvenance(manifest.runtimeState), cohortSha256, animations: manifest.structuralStateCapture ? "disabled-state-structural" : "captured-before-disabled", transitions: "disabled", network: manifest.preserveLivePage ? "unchanged-live-session" : "external-denied-source-origin-allowed", hostServices: manifest.preserveLivePage ? "live-existing" : hostProjectionReceipt ? "declarative-projection" : "recording-fake", ...(hostProjectionReceipt ? { hostCapabilityProjection: hostProjectionReceipt } : {}), ...(rootPredicateReceipt ? { rootStatePredicate: rootPredicateReceipt } : {}), ...(manifest.windowSurfaceState ? { windowSurfaceState: manifest.windowSurfaceState } : {}) }, page: { url: page.url, title: page.title }, observedDom, snapshot, styleProvenanceByDomOrder: provenance, semanticRoleReceipts, motionReceipts: snapshotRefs.flatMap((ref,index)=>{const animations=motionByBackendId.get(ref.backendNodeId);return animations?.length?[{backendNodeId:ref.backendNodeId,sourceId:sourceIdByProvenance[index],provenanceIndex:index,animations}]:[]}), remoteImageReceipts, authoredMedia: { rootFontSize, queries: mediaQueries, viewportThresholds: authoredThresholds }, hostCalls }
		await mkdir(staging, { recursive: true })
		await writeFile(resolve(staging, "source.png"), screenshot)
		const evidenceSha256 = await writeStableJson(resolve(staging, "source.json"), evidence)
		const metadata = { schema: SCHEMA, screenshotSha256: sha256(screenshot), evidenceSha256, manifestSha256: sha256(stableJson({ ...manifest, output: "<output>" })), cohortSha256 }
		await writeFile(resolve(staging, "meta.json"), stableJson(metadata))
		await rename(staging, output)
		return metadata
	} finally {
		try { await cdp.command("Fetch.disable") } catch {}
		cdp.close()
		await rm(staging, { recursive: true, force: true })
	}
}

export function isAllowedCaptureRequest(source: URL, requestedUrl: string): boolean {
	try {
		const requested = new URL(requestedUrl)
		return ["data:", "blob:", "file:"].includes(requested.protocol) ||
			(requested.origin === source.origin && ["127.0.0.1", "localhost"].includes(requested.hostname))
	} catch { return false }
}

async function main() {
	const flag = process.argv.indexOf("--manifest")
	if (flag < 0 || !process.argv[flag + 1]) throw new Error("usage: capture-source-cdp.ts --manifest capture.json")
	const manifest = validateManifest(JSON.parse(await readFile(resolve(process.argv[flag + 1]), "utf8")))
	console.log(stableJson(await capture(manifest)).trim())
}

if (import.meta.main) await main()
