import { createHash } from "node:crypto"

export interface RootStatePredicateAttribute {
	name: string
	value?: string
}

export interface RootStatePredicate {
	selector: string
	requiredClasses?: string[]
	requiredAttributes?: RootStatePredicateAttribute[]
}

export interface RootStatePredicateReceipt {
	schema: "burl-root-state-predicate-receipt-v1"
	status: "passed"
	provenanceSha256: string
	declaration: RootStatePredicate
	matchedCount: 1
}

const safeClass = /^-?[_A-Za-z][_A-Za-z0-9-]*$/
const safeAttribute = /^(?:data-|aria-)?[_A-Za-z][_A-Za-z0-9:.-]*$/

function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
			: item)
}

export function validateRootStatePredicate(input: unknown): RootStatePredicate {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("rootStatePredicate must be an object")
	const value = input as Record<string, unknown>
	if (Object.keys(value).some((key) => !["selector", "requiredClasses", "requiredAttributes"].includes(key)))
		throw new Error("rootStatePredicate has unsupported fields")
	if (typeof value.selector !== "string" || !value.selector.trim() || value.selector.length > 256 ||
		/[\0-\x1f\x7f]/.test(value.selector))
		throw new Error("rootStatePredicate.selector must be a bounded CSS selector")
	const classes = value.requiredClasses ?? []
	if (!Array.isArray(classes) || classes.length > 16 ||
		classes.some((item) => typeof item !== "string" || !safeClass.test(item)))
		throw new Error("rootStatePredicate.requiredClasses must contain at most 16 safe class names")
	if (new Set(classes).size !== classes.length)
		throw new Error("rootStatePredicate.requiredClasses has duplicates")
	const attributes = value.requiredAttributes ?? []
	if (!Array.isArray(attributes) || attributes.length > 16)
		throw new Error("rootStatePredicate.requiredAttributes must contain at most 16 entries")
	const names = new Set<string>()
	for (const [index, raw] of attributes.entries()) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			throw new Error(`rootStatePredicate.requiredAttributes[${index}] must be an object`)
		const attribute = raw as Record<string, unknown>
		if (Object.keys(attribute).some((key) => !["name", "value"].includes(key)) ||
			typeof attribute.name !== "string" || !safeAttribute.test(attribute.name) ||
			(attribute.value !== undefined && (typeof attribute.value !== "string" || attribute.value.length > 1024)))
			throw new Error(`rootStatePredicate.requiredAttributes[${index}] is invalid`)
		if (names.has(attribute.name))
			throw new Error(`rootStatePredicate.requiredAttributes has duplicate ${attribute.name}`)
		names.add(attribute.name)
	}
	if (classes.length === 0 && attributes.length === 0)
		throw new Error("rootStatePredicate must require at least one class or attribute")
	return input as RootStatePredicate
}

export function rootStatePredicateProvenance(input: unknown): string {
	return createHash("sha256").update(canonicalJson(validateRootStatePredicate(input))).digest("hex")
}

export function rootStatePredicateExpression(input: unknown): string {
	const predicate = validateRootStatePredicate(input)
	return `(()=>{const declaration=${JSON.stringify(predicate)};let matches;try{matches=[...document.querySelectorAll(declaration.selector)]}catch(error){return{status:'failed',reason:'invalid-selector',detail:String(error),matchedCount:0}}if(matches.length!==1)return{status:'failed',reason:'match-count',matchedCount:matches.length};const element=matches[0];for(const name of declaration.requiredClasses??[])if(!element.classList.contains(name))return{status:'failed',reason:'missing-class',detail:name,matchedCount:1};for(const attribute of declaration.requiredAttributes??[]){if(!element.hasAttribute(attribute.name))return{status:'failed',reason:'missing-attribute',detail:attribute.name,matchedCount:1};if(Object.prototype.hasOwnProperty.call(attribute,'value')&&element.getAttribute(attribute.name)!==attribute.value)return{status:'failed',reason:'attribute-value',detail:attribute.name,matchedCount:1}}return{status:'passed',matchedCount:1}})()`
}

export function rootStatePredicateReceipt(
	declaration: unknown, evaluation: unknown,
): RootStatePredicateReceipt {
	const predicate = validateRootStatePredicate(declaration)
	const result = evaluation as Record<string, unknown> | null
	if (!result || result.status !== "passed" || result.matchedCount !== 1) {
		const reason = typeof result?.reason === "string" ? result.reason : "malformed-result"
		const detail = typeof result?.detail === "string" ? ` (${result.detail})` : ""
		throw new Error(`root-state predicate did not pass: ${reason}${detail}`)
	}
	return {
		schema: "burl-root-state-predicate-receipt-v1",
		status: "passed",
		provenanceSha256: rootStatePredicateProvenance(predicate),
		declaration: predicate,
		matchedCount: 1,
	}
}
