import { describe, expect, test } from "bun:test"
import {
	rootStatePredicateExpression,
	rootStatePredicateProvenance,
	rootStatePredicateReceipt,
	validateRootStatePredicate,
} from "./root-state-predicate"

const predicate = {
	selector: "#application-root",
	requiredClasses: ["transparent-surface"],
	requiredAttributes: [
		{ name: "data-platform", value: "desktop" },
		{ name: "aria-busy" },
	],
}

describe("root state predicate", () => {
	test("is bounded, declarative, and hash-addressed", () => {
		expect(validateRootStatePredicate(predicate)).toEqual(predicate)
		expect(rootStatePredicateProvenance(predicate)).toMatch(/^[0-9a-f]{64}$/)
		expect(rootStatePredicateProvenance({ ...predicate, requiredClasses: ["opaque-surface"] }))
			.not.toBe(rootStatePredicateProvenance(predicate))
	})

	test("rejects empty, duplicate, and unbounded declarations", () => {
		expect(() => validateRootStatePredicate({ selector: ":root" })).toThrow("at least one")
		expect(() => validateRootStatePredicate({ selector: ":root", requiredClasses: ["ready", "ready"] }))
			.toThrow("duplicates")
		expect(() => validateRootStatePredicate({ selector: "x".repeat(257), requiredClasses: ["ready"] }))
			.toThrow("bounded CSS selector")
		expect(() => validateRootStatePredicate({ selector: ":root", requiredAttributes: [
			{ name: "data-state" }, { name: "data-state", value: "ready" },
		] })).toThrow("duplicate data-state")
	})

	test("evaluation source embeds data, not executable manifest text", () => {
		const source = rootStatePredicateExpression(predicate)
		expect(source).toContain("document.querySelectorAll")
		expect(source).toContain("missing-class")
		expect(source).toContain("attribute-value")
		expect(source).not.toContain("eval(")
	})

	test("only a unique passed evaluation becomes a receipt", () => {
		const receipt = rootStatePredicateReceipt(predicate, { status: "passed", matchedCount: 1 })
		expect(receipt.schema).toBe("burl-root-state-predicate-receipt-v1")
		expect(receipt.declaration).toEqual(predicate)
		expect(receipt.matchedCount).toBe(1)
		expect(() => rootStatePredicateReceipt(predicate,
			{ status: "failed", reason: "match-count", matchedCount: 2 })).toThrow("match-count")
	})
})
