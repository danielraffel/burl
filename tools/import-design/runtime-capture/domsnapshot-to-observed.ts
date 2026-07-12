export interface ObservedDomRect { x: number; y: number; width: number; height: number }
export interface ObservedDomContent {
	kind: "text" | "child"
	text?: string
	sourceId?: string
	rect?: ObservedDomRect
}
export interface ObservedDomNode {
	sourceId: string
	tagName: string
	attributes: Record<string, string>
	computedStyle: Record<string, string>
	styleProvenance?: Record<string, Array<Record<string, unknown>>>
	rect: ObservedDomRect
	children: ObservedDomNode[]
	content: ObservedDomContent[]
	outerHTML?: string
	inlineSvg?: string
	provenanceIndex: number
	usedFonts?: Array<{ family: string; postScriptName: string; custom: boolean; glyphCount: number }>
	motion?: Array<{ name: string; durationMs: number; delayMs: number; easing: string; iterations: number | "infinite"; direction: string; fill: string; playState: string; keyframes: Array<Record<string, unknown>> }>
	generated?: { kind: "pseudo-element"; pseudoType: string }
}

const value = (strings: string[], index: unknown): string => {
	if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= strings.length)
		throw new Error(`DOMSnapshot string index is invalid: ${String(index)}`)
	return strings[index as number]
}
const optionalValue = (strings: string[], index: unknown): string => index === -1 ? "" : value(strings, index)
const cssKey = (name: string) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
const slug = (input: string) => input.toLowerCase().replace(/\s+/g, " ").trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
const hash = (input: string) => {
	let value = 0x811c9dc5
	for (let i = 0; i < input.length; i++) { value ^= input.charCodeAt(i); value = Math.imul(value, 0x01000193) }
	return (value >>> 0).toString(16).padStart(8, "0")
}

function rect(bounds: unknown, coordinateScale = 1): ObservedDomRect {
	if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite))
		throw new Error("DOMSnapshot layout bounds must contain four finite numbers")
	if (!Number.isFinite(coordinateScale) || coordinateScale <= 0)
		throw new Error("DOMSnapshot coordinate scale must be positive")
	return { x: bounds[0] * coordinateScale, y: bounds[1] * coordinateScale,
		width: bounds[2] * coordinateScale, height: bounds[3] * coordinateScale }
}

function unionRect(a: ObservedDomRect, b: ObservedDomRect): ObservedDomRect {
	const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y)
	const right = Math.max(a.x + a.width, b.x + b.width)
	const bottom = Math.max(a.y + a.height, b.y + b.height)
	return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Deterministically lowers one CDP DOMSnapshot document to the adapter contract. */
export function domSnapshotToObserved(snapshot: any, styleProperties: readonly string[], provenance: any[], deviceScaleFactor = 1, coordinateScale = 1): ObservedDomNode {
	if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0) throw new Error("deviceScaleFactor must be positive")
	if (!Array.isArray(snapshot?.documents) || snapshot.documents.length !== 1)
		throw new Error("DOMSnapshot conversion requires exactly one document")
	const strings = snapshot.strings
	const document = snapshot.documents[0]
	const nodes = document?.nodes
	if (!Array.isArray(strings) || !nodes || !Array.isArray(nodes.parentIndex) ||
		!Array.isArray(nodes.nodeType) || !Array.isArray(nodes.nodeName) || !Array.isArray(nodes.nodeValue))
		throw new Error("DOMSnapshot node tables are incomplete")
	const count = nodes.nodeType.length
	for (const column of [nodes.parentIndex, nodes.nodeName, nodes.nodeValue, nodes.attributes])
		if (!Array.isArray(column) || column.length !== count) throw new Error("DOMSnapshot node columns have mismatched lengths")
	const rareIndices = (column: any, name: string): number[] => {
		if (column === undefined) return []
		if (!Array.isArray(column?.index) || !Array.isArray(column?.value) || column.index.length !== column.value.length)
			throw new Error(`DOMSnapshot ${name} classification is malformed`)
		for (const index of column.index) if (!Number.isInteger(index) || index < 0 || index >= count)
			throw new Error(`DOMSnapshot ${name} classification has invalid node index`)
		return column.index
	}
	const pseudoIndices = rareIndices(nodes.pseudoType, "pseudoType")
	const shadowIndices = rareIndices(nodes.shadowRootType, "shadowRootType")
	const contentDocumentIndices = rareIndices(nodes.contentDocumentIndex, "contentDocumentIndex")
	const pseudoByNode = new Map(pseudoIndices.map((index) => {
		const position = nodes.pseudoType.index.indexOf(index)
		const pseudoType = value(strings, nodes.pseudoType.value[position])
		if (!['before', 'after'].includes(pseudoType))
			throw new Error(`DOMSnapshot generated pseudo-element at node ${index} has unsupported explicit type ${pseudoType}`)
		return [index, pseudoType]
	}))
	if (shadowIndices.length)
		throw new Error(`DOMSnapshot shadow tree at node ${shadowIndices[0]} requires explicit tree provenance`)
	if (contentDocumentIndices.length)
		throw new Error(`DOMSnapshot nested document at node ${contentDocumentIndices[0]} requires explicit document provenance`)

	const childIndices: number[][] = Array.from({ length: count }, () => [])
	for (let index = 0; index < count; index++) {
		const parent = nodes.parentIndex[index]
		if (parent === -1) continue
		if (!Number.isInteger(parent) || parent < 0 || parent >= count || parent >= index)
			throw new Error(`DOMSnapshot parent/order is ambiguous at node ${index}`)
		childIndices[parent].push(index)
	}
	const layoutByNode = new Map<number, { bounds: ObservedDomRect; style: Record<string, string> }>()
	const layout = document.layout
	if (!layout || !Array.isArray(layout.nodeIndex) || !Array.isArray(layout.bounds) || !Array.isArray(layout.styles) ||
		layout.nodeIndex.length !== layout.bounds.length || layout.nodeIndex.length !== layout.styles.length)
		throw new Error("DOMSnapshot layout tables are incomplete")
	layout.nodeIndex.forEach((nodeIndex: number, position: number) => {
		const encoded = layout.styles[position]
		if (!Array.isArray(encoded)) throw new Error(`DOMSnapshot computed styles are malformed at node ${nodeIndex}`)
		const existing = layoutByNode.get(nodeIndex)
		if (existing) {
			const priorPosition = layout.nodeIndex.indexOf(nodeIndex)
			if (JSON.stringify(layout.styles[priorPosition]) !== JSON.stringify(encoded))
				throw new Error(`DOMSnapshot fragment styles disagree for node ${nodeIndex}`)
			existing.bounds = unionRect(existing.bounds, rect(layout.bounds[position], coordinateScale))
			return
		}
		// CDP is allowed to elide default style slots on non-element layout
		// entries. Element styles below come from the independently captured,
		// complete CSS.getComputedStyleForNode table.
		layoutByNode.set(nodeIndex, {
			bounds: rect(layout.bounds[position], coordinateScale),
			style: Object.fromEntries(encoded.slice(0, styleProperties.length).map((item: number, i: number) => [styleProperties[i], optionalValue(strings, item)])),
		})
	})

	const elementIndices = Array.from({ length: count }, (_, i) => i)
		.filter((i) => nodes.nodeType[i] === 1 && !pseudoByNode.has(i))
	if (elementIndices.length !== provenance.length) throw new Error(`DOMSnapshot/provenance element count mismatch (${elementIndices.length} != ${provenance.length})`)
	const provenanceByNode = new Map(elementIndices.map((nodeIndex, i) => {
		const tag = value(strings, nodes.nodeName[nodeIndex]).toLowerCase()
		if (String(provenance[i]?.nodeName ?? "").toLowerCase() !== tag)
			throw new Error(`DOMSnapshot/provenance order mismatch at element ${i}`)
		return [nodeIndex, i]
	}))

	const elementChildren = (index: number) => childIndices[index].flatMap((child) => {
		if (nodes.nodeType[child] === 1) return [child]
		if (nodes.nodeType[child] === 3) return []
		// Comments are inert; nested document/shadow roots are not safely lowerable.
		if (nodes.nodeType[child] === 8) return []
		if (childIndices[child].some((nested) => nodes.nodeType[nested] === 1))
			throw new Error(`DOMSnapshot contains an ambiguous non-element parent at node ${child}`)
		return []
	})
	const roots = elementIndices.filter((index) => {
		let parent = nodes.parentIndex[index]
		while (parent >= 0 && nodes.nodeType[parent] !== 1) parent = nodes.parentIndex[parent]
		return parent < 0
	})
	if (roots.length !== 1) throw new Error(`DOMSnapshot conversion requires one element root, found ${roots.length}`)

	const attributesFor = (index: number) => {
		const rawAttributes = nodes.attributes[index]
		if (!Array.isArray(rawAttributes) || rawAttributes.length % 2 !== 0)
			throw new Error(`DOMSnapshot attributes are malformed at node ${index}`)
		const attributes: Record<string, string> = {}
		for (let i = 0; i < rawAttributes.length; i += 2) {
			const name = value(strings, rawAttributes[i])
			if (Object.hasOwn(attributes, name)) throw new Error(`duplicate attribute ${name} at node ${index}`)
			attributes[name] = optionalValue(strings, rawAttributes[i + 1])
		}
		return attributes
	}
	const signatureFor = (index: number) => {
		if (pseudoByNode.has(index)) return `pseudo-${slug(pseudoByNode.get(index)!)}`
		const tag = value(strings, nodes.nodeName[index]).toLowerCase()
		const attributes = attributesFor(index)
		const volatileIdentifier = (identifier: string) => /(?:base-ui|radix)-_?r_/i.test(identifier)
		for (const name of ['id', 'data-testid', 'data-slot', 'data-pulp-semantic-id', 'data-pulp-list-key', 'name'])
			if (attributes[name] && !(name === 'id' && volatileIdentifier(attributes[name])))
				return `${tag}-${slug(name)}-${slug(attributes[name])}`
		const role = attributes.role ?? ''
		const accessible = attributes['aria-label'] ?? attributes.title ?? ''
		if (role || accessible) return `${tag}-${slug(role || 'semantic')}-${slug(accessible || 'unnamed')}`
		const stableClass = (attributes.class ?? '').split(/\s+/).filter((item) => item && !/^(css-|sc-|_[a-z0-9]{6,})/i.test(item)).sort().join('.')
		return `${tag}-shape-${hash(`${tag}|${stableClass}`)}`
	}
	const build = (index: number, sourceId: string): ObservedDomNode => {
		const tagName = value(strings, nodes.nodeName[index]).toLowerCase()
		const attributes = attributesFor(index)
		const layoutEntry = layoutByNode.get(index)
		const generated = pseudoByNode.has(index)
		const provenanceIndex = generated ? -1 : provenanceByNode.get(index)!
		const capturedStyle = { ...(layoutEntry?.style ?? {}), ...(!generated ? provenance[provenanceIndex].computed ?? {} : {}) }
		const missingStyles = styleProperties.filter((name) => typeof capturedStyle[name] !== "string")
		if (missingStyles.length)
			throw new Error(`full selected computed style missing at node ${index}: ${missingStyles.join(",")}`)
		const computedStyle = Object.fromEntries(styleProperties.map((name) => [cssKey(name), capturedStyle[name]]))
		const childElements = elementChildren(index)
		const signatureCounts = new Map<string, number>()
		const children = childElements.map((child) => {
			const signature = signatureFor(child)
			const ordinal = signatureCounts.get(signature) ?? 0
			signatureCounts.set(signature, ordinal + 1)
			return build(child, `${sourceId}/${signature}:${ordinal}`)
		})
		const byIndex = new Map(childElements.map((child, i) => [child, children[i]]))
		const content: ObservedDomContent[] = []
		for (const child of childIndices[index]) {
			if (nodes.nodeType[child] === 1) content.push({ kind: "child", sourceId: byIndex.get(child)!.sourceId })
			else if (nodes.nodeType[child] === 3) {
				const text = optionalValue(strings, nodes.nodeValue[child])
				if (text !== "") content.push({ kind: "text", text, ...(layoutByNode.has(child) ? { rect: layoutByNode.get(child)!.bounds } : {}) })
			}
		}
		const outerHTML = !generated ? provenance[provenanceIndex].outerHTML : undefined
		return {
			sourceId, tagName, attributes, computedStyle,
			...(!generated ? { styleProvenance: provenance[provenanceIndex].declarations ?? {} } : {}),
			rect: layoutEntry?.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
			children, content, ...(typeof outerHTML === "string" ? { outerHTML } : {}),
			...(tagName === "svg" && typeof outerHTML === "string" ? { inlineSvg: outerHTML } : {}),
			provenanceIndex,
			...(generated ? { generated: { kind: "pseudo-element" as const, pseudoType: pseudoByNode.get(index)! } } : {}),
			...(!generated && provenance[provenanceIndex].usedFonts?.length ? { usedFonts: provenance[provenanceIndex].usedFonts } : {}),
			...(!generated && provenance[provenanceIndex].motion?.length ? { motion: provenance[provenanceIndex].motion } : {}),
		}
	}
	return build(roots[0], `dom/${signatureFor(roots[0])}:0`)
}
