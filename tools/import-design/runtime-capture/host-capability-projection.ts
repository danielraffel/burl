import { createHash } from "node:crypto"

export type HostProjectionJson =
	| null | boolean | number | string
	| HostProjectionJson[]
	| { [key: string]: HostProjectionJson }

export interface HostCapabilityProjectionEntry {
	path: string
	kind: "property" | "method"
	value: HostProjectionJson
	returnMode?: "sync" | "promise"
}

export interface HostCapabilityProjection {
	schemaVersion: 1
	entries: HostCapabilityProjectionEntry[]
}

export interface HostCapabilityProjectionReceipt {
	schema: "burl-host-capability-projection-v1"
	mode: "declarative-projection"
	provenanceSha256: string
	entryCount: number
	paths: Array<{ path: string; kind: "property" | "method"; returnMode?: "sync" | "promise" }>
}

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"])
const forbiddenRoots = new Set([
	"Date", "Function", "JSON", "Math", "Object", "Promise", "Reflect",
	"document", "eval", "fetch", "globalThis", "history", "indexedDB",
	"localStorage", "location", "navigator", "performance", "sessionStorage", "window",
])
const sensitiveName = /(?:password|passwd|secret|credential|cookie|auth(?:entication|orization)?|token|api[-_.$:]?key)/i

function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
			: item)
}

function validateJsonValue(value: unknown, label: string): asserts value is HostProjectionJson {
	let nodes = 0
	const visit = (item: unknown, depth: number, path: string): void => {
		nodes++
		if (nodes > 128) throw new Error(`${label} exceeds 128 JSON value nodes`)
		if (depth > 4) throw new Error(`${label} exceeds JSON depth 4 at ${path}`)
		if (item === null || typeof item === "string" || typeof item === "boolean") return
		if (typeof item === "number") {
			if (!Number.isFinite(item)) throw new Error(`${label} contains a non-finite number at ${path}`)
			return
		}
		if (Array.isArray(item)) {
			if (item.length > 32) throw new Error(`${label} array exceeds 32 items at ${path}`)
			item.forEach((child, index) => visit(child, depth + 1, `${path}[${index}]`))
			return
		}
		if (!item || typeof item !== "object")
			throw new Error(`${label} contains a non-JSON value at ${path}`)
		const keys = Object.keys(item)
		if (keys.length > 32) throw new Error(`${label} object exceeds 32 keys at ${path}`)
		for (const key of keys) {
			if (forbiddenSegments.has(key) || sensitiveName.test(key))
				throw new Error(`${label} contains a forbidden object key at ${path}.${key}`)
			visit((item as Record<string, unknown>)[key], depth + 1, `${path}.${key}`)
		}
	}
	visit(value, 0, label)
	if (new TextEncoder().encode(JSON.stringify(value)).length > 4096)
		throw new Error(`${label} exceeds 4096 encoded bytes`)
}

export function validateHostCapabilityProjection(input: unknown): HostCapabilityProjection {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("hostCapabilityProjection must be an object")
	const projection = input as Record<string, unknown>
	const topKeys = Object.keys(projection)
	if (topKeys.some((key) => !["schemaVersion", "entries"].includes(key)))
		throw new Error("hostCapabilityProjection has unsupported fields")
	if (projection.schemaVersion !== 1)
		throw new Error("hostCapabilityProjection.schemaVersion must be 1")
	if (!Array.isArray(projection.entries) || projection.entries.length < 1 || projection.entries.length > 32)
		throw new Error("hostCapabilityProjection.entries must contain from 1 through 32 entries")

	const paths: string[] = []
	for (const [index, raw] of projection.entries.entries()) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			throw new Error(`hostCapabilityProjection.entries[${index}] must be an object`)
		const entry = raw as Record<string, unknown>
		if (Object.keys(entry).some((key) => !["path", "kind", "value", "returnMode"].includes(key)))
			throw new Error(`hostCapabilityProjection.entries[${index}] has unsupported fields`)
		if (typeof entry.path !== "string" || entry.path.length > 160)
			throw new Error(`hostCapabilityProjection.entries[${index}].path is invalid`)
		const segments = entry.path.split(".")
		if (segments.length < 2 || segments.length > 8 || segments.some((part) => !identifier.test(part) || forbiddenSegments.has(part)))
			throw new Error(`hostCapabilityProjection.entries[${index}].path must contain 2 through 8 safe identifiers`)
		if (forbiddenRoots.has(segments[0]) || sensitiveName.test(entry.path))
			throw new Error(`hostCapabilityProjection.entries[${index}].path is forbidden`)
		if (!Object.prototype.hasOwnProperty.call(entry, "value"))
			throw new Error(`hostCapabilityProjection.entries[${index}] requires value`)
		validateJsonValue(entry.value, `hostCapabilityProjection.entries[${index}].value`)
		if (entry.kind === "method") {
			if (!["sync", "promise"].includes(entry.returnMode as string))
				throw new Error(`hostCapabilityProjection.entries[${index}] method requires explicit returnMode`)
		} else if (entry.kind === "property") {
			if (entry.returnMode !== undefined)
				throw new Error(`hostCapabilityProjection.entries[${index}] property cannot declare returnMode`)
		} else throw new Error(`hostCapabilityProjection.entries[${index}].kind is unsupported`)
		paths.push(entry.path)
	}
	const ordered = [...paths].sort()
	for (let index = 0; index < ordered.length; index++) {
		if (ordered[index] === ordered[index - 1])
			throw new Error(`hostCapabilityProjection has duplicate path ${ordered[index]}`)
		if (ordered[index - 1] && ordered[index].startsWith(`${ordered[index - 1]}.`))
			throw new Error(`hostCapabilityProjection has conflicting paths ${ordered[index - 1]} and ${ordered[index]}`)
	}
	if (new TextEncoder().encode(canonicalJson(projection)).length > 32768)
		throw new Error("hostCapabilityProjection exceeds 32768 encoded bytes")
	return input as HostCapabilityProjection
}

export function hostCapabilityProjectionReceipt(input: unknown): HostCapabilityProjectionReceipt {
	const projection = validateHostCapabilityProjection(input)
	return {
		schema: "burl-host-capability-projection-v1",
		mode: "declarative-projection",
		provenanceSha256: createHash("sha256").update(canonicalJson(projection)).digest("hex"),
		entryCount: projection.entries.length,
		paths: projection.entries.map((entry) => ({
			path: entry.path, kind: entry.kind,
			...(entry.returnMode ? { returnMode: entry.returnMode } : {}),
		})),
	}
}

export function hostCapabilityProjectionBootstrapSource(input: unknown): string {
	const projection = validateHostCapabilityProjection(input)
	return `(()=>{const entries=${JSON.stringify(projection.entries)};const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));const calls=globalThis.__pulpCaptureHostCalls??=[];for(const entry of entries){const parts=entry.path.split('.');let target=globalThis;for(const part of parts.slice(0,-1)){const existing=Object.prototype.hasOwnProperty.call(target,part)?target[part]:undefined;if(existing!==undefined&&(existing===null||typeof existing!=='object'))throw new Error('capture host projection path conflicts: '+entry.path);if(existing===undefined)Object.defineProperty(target,part,{value:{},configurable:true});target=target[part]}const leaf=parts.at(-1);if(Object.prototype.hasOwnProperty.call(target,leaf))throw new Error('capture host projection leaf conflicts: '+entry.path);if(entry.kind==='property')Object.defineProperty(target,leaf,{value:clone(entry.value),configurable:false,writable:false});else Object.defineProperty(target,leaf,{configurable:false,writable:false,value:(...args)=>{if(calls.length>=128)throw new Error('capture host projection call limit exceeded');calls.push({name:entry.path,args:clone(args),source:'declarative-projection'});const value=clone(entry.value);return entry.returnMode==='promise'?Promise.resolve(value):value}})}})();`
}
