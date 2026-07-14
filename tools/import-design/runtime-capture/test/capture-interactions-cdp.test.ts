import { describe, expect, test } from "bun:test"
import { INTERACTION_SCHEMA, normalizeAxTree, resolveScenarioBinding, selectAssociatedControlCandidate, shouldNeutralizePointerForStateCapture, validateInteractionManifest } from "../capture-interactions-cdp"
import { isAllowedCaptureRequest } from "../capture-source-cdp"

const valid = { schemaVersion: 1, cdpEndpoint: "http://localhost:9333", output: "/tmp/x", viewport: { width: 800, height: 600, deviceScaleFactor: 2 }, clock: "2026-01-02T03:04:05Z", security: { mode: "recording-fake" }, scenarios: [{ id: "click", action: { type: "pointer", target: { role: "button", name: "Save" } } }] }

describe("interaction capture contract", () => {
	test("accepts generic role targets", () => expect(validateInteractionManifest(valid).scenarios[0].id).toBe("click"))
	test("requires isolated deterministic storage for runtime preferences", () => {
		const runtimeState = { localStorage: { "ui:theme": "dark" } }
		expect(validateInteractionManifest({ ...valid, clearStorage: true,
			security: { mode: "recording-fake", isolatedProfile: true }, runtimeState }).runtimeState).toEqual(runtimeState)
		expect(() => validateInteractionManifest({ ...valid, runtimeState })).toThrow("isolatedProfile")
	})
	test("accepts explicit semantic activation targets", () => {
		const captured = validateInteractionManifest({ ...valid,
			scenarios: [{ id: "activate", action: { type: "activate", target: { role: "button", name: "Save" } } }] })
		expect(captured.scenarios[0].action.type).toBe("activate")
	})
	test("accepts captured action binding metadata and rejects targetless bindings", () => {
		const captured = validateInteractionManifest({ ...valid,
			scenarios: [{ id: "toggle", action: { type: "pointer", target: { role: "button", name: "More" } },
				binding: { action: "disclosure.toggle", payload: "details.open" } }] })
		expect(captured.scenarios[0].binding?.payload).toBe("details.open")
		expect(() => validateInteractionManifest({ ...valid,
			scenarios: [{ id: "bad", action: { type: "key", key: "Enter" }, binding: { action: "x" } }] })).toThrow("binding")
		expect(validateInteractionManifest({ ...valid,
			bindings: [{ target: { selector: "button.more" }, action: "disclosure.toggle" }] }).bindings).toHaveLength(1)
	})
	test("retains the exact action contract for scenario and inherited bindings", () => {
		const inherited = validateInteractionManifest({ ...valid,
			bindings: [{ target: { role: "button", name: "Save" }, action: "settings.open" }] })
		expect(resolveScenarioBinding(inherited, inherited.scenarios[0])?.action).toBe("settings.open")
		const explicit = validateInteractionManifest({ ...valid,
			bindings: [{ target: { role: "button", name: "Save" }, action: "wrong" }],
			scenarios: [{ ...valid.scenarios[0], binding: { action: "settings.open", payload: "general" } }] })
		expect(resolveScenarioBinding(explicit, explicit.scenarios[0])).toEqual({
			action: "settings.open", payload: "general",
		})
	})
	test("accepts observed select value receipts without accepting label-derived payloads", () => {
		const captured = validateInteractionManifest({ ...valid,
			bindings: [{ target: { role: "option", name: "Adaptive" }, action: "composer.variant.select",
				payloadReceipt: { source: "associated-control-value" } }],
			scenarios: [{ id: "adaptive", action: { type: "pointer", target: { role: "option", name: "Adaptive" } } }] })
		expect(resolveScenarioBinding(captured, captured.scenarios[0])?.payloadReceipt).toEqual({
			source: "associated-control-value",
		})
		expect(() => validateInteractionManifest({ ...valid,
			bindings: [{ target: { role: "option", name: "Adaptive" }, action: "composer.variant.select",
				payload: "Adaptive", payloadReceipt: { source: "associated-control-value" } }] })).toThrow("cannot combine")
		expect(() => validateInteractionManifest({ ...valid,
			bindings: [{ target: { role: "option", name: "Adaptive" }, action: "composer.variant.select",
				payloadReceipt: { source: "label" } }] })).toThrow("unsupported")
	})
	test("requires exact runtime command receipts and trusted safe activation", () => {
		const safe = validateInteractionManifest({ ...valid, scenarios: [{ id: "theme", action: {
			type: "pointer", target: { selector: "[data-slot=command-item][data-value='Theme: System']" } },
			binding: { action: "appearance.theme.select",
				payloadReceipt: { source: "command-item-react-key" },
				activationReceipt: { source: "command-item-runtime", policy: "reversible" } } }] })
		expect(safe.scenarios[0].binding?.activationReceipt?.policy).toBe("reversible")
		expect(() => validateInteractionManifest({ ...valid, scenarios: [{ id: "synthetic", action: {
			type: "activate", target: { selector: "[data-slot=command-item]" } }, binding: {
			action: "command.run", activationReceipt: { source: "command-item-runtime", policy: "reversible" } } }] }))
			.toThrow("trusted pointer or keyboard")
		expect(() => validateInteractionManifest({ ...valid, scenarios: [{ id: "unsafe", action: {
			type: "pointer", target: { selector: "[data-slot=command-item]" } }, binding: {
			action: "session.fork", activationReceipt: { source: "command-item-runtime", policy: "unsafe" } } }] }))
			.toThrow("receipt-only")
		const classified = validateInteractionManifest({ ...valid, scenarios: [{ id: "disabled", action: {
			type: "hover", target: { selector: "[data-slot=command-item][aria-disabled=true]" } }, binding: {
			action: "conversation.compact",
			activationReceipt: { source: "command-item-runtime", policy: "disabled" } } }] })
		expect(classified.scenarios[0].binding?.activationReceipt?.policy).toBe("disabled")
	})
	test("selects the nearest associated control deterministically and rejects ambiguity", () => {
		expect(selectAssociatedControlCandidate([
			{ sourceId: "build", value: "Build", distance: 3, afterTrigger: false },
			{ sourceId: "variant", value: "__default__", distance: 1, afterTrigger: true },
		])).toEqual({ sourceId: "variant", value: "__default__", distance: 1, afterTrigger: true })
		expect(() => selectAssociatedControlCandidate([])).toThrow("no associated")
		expect(() => selectAssociatedControlCandidate([
			{ sourceId: "a", value: "A", distance: 1, afterTrigger: true },
			{ sourceId: "b", value: "B", distance: 1, afterTrigger: true },
		])).toThrow("ambiguous")
	})
	test("accepts hover and bounded deterministic setup actions", () => {
		const captured = validateInteractionManifest({ ...valid, scenarios: [
			{ id: "tip", action: { type: "hover", target: { selector: "button.help" } }, settleMs: 800 },
			{ id: "setup", action: { type: "evaluate", expression: "document.documentElement.dataset.fixture='loaded'" } },
		] })
		expect(captured.scenarios.map((scenario) => scenario.action.type)).toEqual(["hover", "evaluate"])
		expect(() => validateInteractionManifest({ ...valid,
			scenarios: [{ id: "bad", action: { type: "evaluate", expression: "" } }] })).toThrow("bounded")
		expect(() => validateInteractionManifest({ ...valid,
			scenarios: [{ id: "bad", action: { type: "hover", target: { selector: "x" } }, settleMs: 30001 }] })).toThrow("settleMs")
	})
	test("neutralizes synthetic pointer hover before non-hover state snapshots", () => {
		expect(shouldNeutralizePointerForStateCapture("pointer")).toBe(true)
		expect(shouldNeutralizePointerForStateCapture("activate")).toBe(true)
		expect(shouldNeutralizePointerForStateCapture("hover")).toBe(false)
	})
	test("rejects duplicate IDs and unscoped targets", () => {
		expect(() => validateInteractionManifest({ ...valid, scenarios: [...valid.scenarios, ...valid.scenarios] })).toThrow("unique")
		expect(() => validateInteractionManifest({ ...valid, scenarios: [{ id: "bad", action: { type: "pointer", target: {} } }] })).toThrow("selector or role")
	})
	test("state snapshots require immutable build provenance and unique states", () => {
		expect(() => validateInteractionManifest({ ...valid, initialStateCapture: { state: "closed", output: "/tmp/closed" } })).toThrow("sourceRevision")
		const captured = validateInteractionManifest({ ...valid, sourceRevision: "abc123",
			initialStateCapture: { state: "closed", output: "/tmp/closed" },
			scenarios: [{ ...valid.scenarios[0], stateCapture: { state: "open", output: "/tmp/open" } }] })
		expect(captured.scenarios[0].stateCapture?.state).toBe("open")
		expect(() => validateInteractionManifest({ ...captured,
			scenarios: [{ ...captured.scenarios[0], stateCapture: { state: "closed", output: "/tmp/open" } }] })).toThrow("unique")
	})
	test("normalizes ephemeral AX IDs to deterministic indexes", () => {
		const a = normalizeAxTree([{ nodeId: "91", role: { value: "button" }, name: { value: "Save" }, childIds: ["92"] }, { nodeId: "92", role: { value: "StaticText" }, name: { value: "Save" } }])
		const b = normalizeAxTree([{ nodeId: "700", role: { value: "button" }, name: { value: "Save" }, childIds: ["800"] }, { nodeId: "800", role: { value: "StaticText" }, name: { value: "Save" } }])
		expect(a).toEqual(b); expect(INTERACTION_SCHEMA).toContain("interaction")
	})
	test("allows only source-origin resources while reloading the captured application", () => {
		const source = new URL("http://localhost:1420/#/fixture")
		expect(isAllowedCaptureRequest(source, "http://localhost:1420/src/main.tsx")).toBe(true)
		expect(isAllowedCaptureRequest(source, "https://example.com/tracker.js")).toBe(false)
		expect(isAllowedCaptureRequest(source, "data:image/png;base64,AA==")).toBe(true)
	})
})
