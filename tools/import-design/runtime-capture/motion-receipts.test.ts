import { describe, expect, test } from "bun:test"
import { validateMotionReceipts } from "./capture-source-cdp"

describe("motion receipt validation", () => {
	test("accepts a neutral CSS rotation receipt", () => {
		const [receipt] = validateMotionReceipts([{ name: "turn", durationMs: 800, delayMs: 0,
			easing: "linear", iterations: "infinite", direction: "normal", fill: "none",
			playState: "running", keyframes: [
				{ offset: 0, easing: "linear", composite: "auto", transform: "none" },
				{ offset: 1, easing: "linear", composite: "auto", transform: "rotate(360deg)" },
			] }])
		expect(receipt.iterations).toBe("infinite")
	})

	test("rejects unsupported transform functions loudly", () => {
		expect(() => validateMotionReceipts([{ name: "move", durationMs: 100, delayMs: 0,
			easing: "linear", iterations: 1, direction: "normal", fill: "none", playState: "running",
			keyframes: [{ offset: 1, easing: "linear", composite: "auto", transform: "translateX(10px)" }] }]))
			.toThrow("unsupported transform")
	})
})
