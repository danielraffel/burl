#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { bootstrapSource, captureCohortIdentity, captureCurrentStructuralState, Cdp, isAllowedCaptureRequest, runtimeStateProvenance, runtimeStorageBootstrapSource, sha256, stableJson, validateRuntimeStorageSeed, type RuntimeStorageSeed } from "./capture-source-cdp"

export const INTERACTION_SCHEMA = "pulp-runtime-interaction-capture-v1"

type Target = { selector?: string; role?: string; name?: string }
type PayloadReceipt = { source: "associated-control-value" } |
	{ source: "command-item-react-key" }
type ActivationReceipt = { source: "command-item-runtime";
	policy: "reversible" | "navigation" | "disabled" | "unsafe" }
type ActionBinding = { action: string; payload?: string; payloadReceipt?: PayloadReceipt;
	activationReceipt?: ActivationReceipt; event?: string; required?: boolean }
type Action =
	| { type: "pointer"; target: Target }
	| { type: "activate"; target: Target }
	| { type: "hover"; target: Target }
	| { type: "focus"; target: Target }
	| { type: "key"; target?: Target; key: string; text?: string }
	| { type: "scroll"; target: Target; top: number; left?: number }
	| { type: "evaluate"; expression: string }

export const shouldNeutralizePointerForStateCapture = (actionType: Action["type"]): boolean =>
	actionType !== "hover"

interface Manifest {
	schemaVersion: 1
	cdpEndpoint: string
	pageUrlPattern?: string
	output: string
	viewport: { width: number; height: number; deviceScaleFactor: 1 | 2 | 3 }
	clock: string
	sourceRevision?: string
	reload?: boolean
	clearStorage?: boolean
	runtimeState?: RuntimeStorageSeed
	security: { mode: "recording-fake"; isolatedProfile?: boolean }
	bindings?: Array<ActionBinding & { target: Target }>
	initialStateCapture?: { state: string; output: string }
	scenarios: Array<{ id: string; action: Action; settleMs?: number;
		binding?: ActionBinding;
		stateCapture?: { state: string; output: string } }>
}

export function resolveScenarioBinding(manifest: Pick<Manifest, "bindings">,
	                                    scenario: Manifest["scenarios"][number]) {
	if (scenario.binding) return scenario.binding
	if (!("target" in scenario.action) || !scenario.action.target) return undefined
	const inherited = manifest.bindings?.find((binding) =>
		JSON.stringify(binding.target) === JSON.stringify(scenario.action.target))
	return inherited ? { action: inherited.action, payload: inherited.payload,
		payloadReceipt: inherited.payloadReceipt,
		activationReceipt: inherited.activationReceipt,
		event: inherited.event, required: inherited.required } : undefined
}

const RECEIPT_ONLY_POLICIES = new Set(["disabled", "unsafe"])
const isTrustedActivation = (action: Action) => action.type === "pointer" ||
	(action.type === "key" && ["Enter", " "].includes(action.key))

function validateBindingReceipts(binding: ActionBinding, action: Action | undefined, context: string) {
	if (binding.payload !== undefined && binding.payloadReceipt !== undefined)
		throw new Error(`${context} cannot combine payload and payloadReceipt`)
	if (binding.payloadReceipt && !["associated-control-value", "command-item-react-key"].includes(binding.payloadReceipt.source))
		throw new Error(`${context} unsupported payloadReceipt source`)
	if (binding.activationReceipt) {
		if (binding.activationReceipt.source !== "command-item-runtime" ||
			!["reversible", "navigation", "disabled", "unsafe"].includes(binding.activationReceipt.policy))
			throw new Error(`${context} unsupported activationReceipt`)
		if (action && RECEIPT_ONLY_POLICIES.has(binding.activationReceipt.policy) && isTrustedActivation(action))
			throw new Error(`${context} ${binding.activationReceipt.policy} command items are receipt-only`)
		if (action && !RECEIPT_ONLY_POLICIES.has(binding.activationReceipt.policy) && !isTrustedActivation(action))
			throw new Error(`${context} command item activation must use trusted pointer or keyboard input`)
	}
}

export function validateInteractionManifest(value: any): Manifest {
	if (value?.schemaVersion !== 1) throw new Error("schemaVersion must be 1")
	if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(value.cdpEndpoint ?? "")) throw new Error("CDP endpoint must be loopback")
	if (value.security?.mode !== "recording-fake") throw new Error("security must be recording-fake")
	if (value.runtimeState !== undefined) {
		validateRuntimeStorageSeed(value.runtimeState)
		if (value.clearStorage !== true || value.security?.isolatedProfile !== true || value.reload === false)
			throw new Error("runtimeState requires clearStorage=true, isolatedProfile=true, and reload")
	}
	if (!Array.isArray(value.scenarios) || !value.scenarios.length) throw new Error("scenarios must not be empty")
	const ids = new Set<string>()
	const states = new Set<string>()
	if (value.initialStateCapture) {
		if (!value.sourceRevision) throw new Error("state captures require sourceRevision")
		if (!value.initialStateCapture.state || !value.initialStateCapture.output) throw new Error("initialStateCapture requires state and output")
		states.add(value.initialStateCapture.state)
	}
	for (const scenario of value.scenarios) {
		if (!scenario.id || ids.has(scenario.id)) throw new Error("scenario IDs must be unique and non-empty")
		ids.add(scenario.id)
		if (scenario.stateCapture) {
			if (!value.sourceRevision) throw new Error("state captures require sourceRevision")
			if (!scenario.stateCapture.state || !scenario.stateCapture.output || states.has(scenario.stateCapture.state))
				throw new Error(`${scenario.id}: state capture names must be unique and non-empty`)
			states.add(scenario.stateCapture.state)
		}
		const action = scenario.action
		if (!["pointer", "activate", "hover", "focus", "key", "scroll", "evaluate"].includes(action?.type)) throw new Error(`${scenario.id}: unsupported action`)
		if (action.target && !action.target.selector && !action.target.role) throw new Error(`${scenario.id}: target needs selector or role`)
		if (["pointer", "activate", "hover", "focus", "scroll"].includes(action.type) && !action.target) throw new Error(`${scenario.id}: target required`)
		if (action.type === "evaluate" && (!action.expression?.trim() || action.expression.length > 8192))
			throw new Error(`${scenario.id}: evaluate requires a bounded expression`)
		if (scenario.settleMs !== undefined && (!Number.isInteger(scenario.settleMs) || scenario.settleMs < 0 || scenario.settleMs > 30000))
			throw new Error(`${scenario.id}: settleMs must be an integer from 0 through 30000`)
		if (scenario.binding && (!scenario.binding.action.trim() || !action.target))
			throw new Error(`${scenario.id}: binding requires an action ID and target`)
		if (scenario.binding) validateBindingReceipts(scenario.binding, action, `${scenario.id}: binding`)
	}
	for (const binding of value.bindings ?? []) {
		if (!binding?.target || (!binding.target.selector && !binding.target.role) || !binding.action?.trim())
			throw new Error("capture bindings require a target and action ID")
		validateBindingReceipts(binding, undefined, "capture binding")
	}
	return value
}

export function normalizeAxTree(nodes: any[]): any[] {
	const byId = new Map(nodes.map((node, index) => [node.nodeId, index]))
	return nodes.map((node) => ({
		index: byId.get(node.nodeId),
		role: node.role?.value ?? null,
		name: node.name?.value ?? null,
		description: node.description?.value ?? null,
		ignored: !!node.ignored,
		properties: Object.fromEntries((node.properties ?? []).map((property: any) => [property.name, property.value?.value ?? null]).sort(([a]: any, [b]: any) => a.localeCompare(b))),
		children: (node.childIds ?? []).map((id: string) => byId.get(id)).filter((index: unknown) => index !== undefined),
	})).filter((node) => !node.ignored)
}

interface AssociatedControlCandidate {
	sourceId: string
	value: string
	distance: number
	afterTrigger: boolean
}

export function selectAssociatedControlCandidate(candidates: AssociatedControlCandidate[]): AssociatedControlCandidate {
	const eligible = candidates.filter((candidate) => candidate.sourceId && typeof candidate.value === "string" &&
		Number.isFinite(candidate.distance) && candidate.distance > 0)
		.sort((a, b) => a.distance - b.distance || Number(b.afterTrigger) - Number(a.afterTrigger) ||
			a.sourceId.localeCompare(b.sourceId))
	if (!eligible.length) throw new Error("select option has no associated value control")
	const best = eligible[0]
	const ambiguous = eligible.find((candidate, index) => index > 0 && candidate.distance === best.distance &&
		candidate.afterTrigger === best.afterTrigger)
	if (ambiguous) throw new Error("select option has ambiguous associated value controls")
	return best
}

const instrumentation = `(() => {
const sid=(element)=>{const parts=[];for(let e=element;e&&e.nodeType===1;e=e.parentElement){const p=e.parentElement;parts.push(e.tagName.toLowerCase()+":"+(p?Array.from(p.children).indexOf(e)+1:1))}return parts.reverse().join("/")};globalThis.__pulpSourceId=sid;
if(globalThis.__pulpInteractionInstrumentation){globalThis.__pulpInteractionEvents??=[];return}globalThis.__pulpInteractionInstrumentation=true;
globalThis.__pulpInteractionEvents=[];let sequence=0;
for(const type of ["pointerover","pointerenter","pointerdown","pointerup","click","focusin","focusout","keydown","beforeinput","input","keyup","scroll"]){
document.addEventListener(type,event=>{const target=event.target;globalThis.__pulpInteractionEvents.push({sequence:++sequence,type,target:sid(target),key:event.key??null,inputType:event.inputType??null,value:"value" in target?target.value:null,scrollTop:target.scrollTop??null,scrollLeft:target.scrollLeft??null,defaultPrevented:event.defaultPrevented,isTrusted:event.isTrusted})},true)
}
})();`

function targetExpression(target: Target): string {
	if (target.selector) return `document.querySelector(${JSON.stringify(target.selector)})`
	return `(()=>{const matches=${targetElementsExpression(target)};return matches.find(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[data-closed],[hidden],[aria-hidden="true"]')})??matches[0]??null})()`
}

function targetElementsExpression(target: Target): string {
	if (target.selector) return `[...document.querySelectorAll(${JSON.stringify(target.selector)})]`
	return `[...document.querySelectorAll('[role],button,input,textarea,select,a[href]')].filter(e=>(e.getAttribute('role')||({BUTTON:'button',TEXTAREA:'textbox',INPUT:'textbox',A:'link'})[e.tagName]||'')===${JSON.stringify(target.role)}&&(!${JSON.stringify(target.name ?? "")}||(e.getAttribute('aria-label')||e.textContent||'').trim()===${JSON.stringify(target.name ?? "")}))`
}

async function evaluate(cdp: Cdp, expression: string): Promise<any> {
	for (let attempt = 0;; attempt++) {
		try {
			const result = await cdp.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
			if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "runtime evaluation failed")
			return result.result.value
		} catch (error) {
			if (attempt >= 9 || !/Execution context was destroyed|Promise was collected/.test(String(error))) throw error
			await Bun.sleep(100)
		}
	}
}

export async function captureInteractions(manifest: Manifest): Promise<Record<string, unknown>> {
	const pages = await fetch(`${manifest.cdpEndpoint}/json/list`).then((response) => response.json()) as any[]
	const page = pages.find((item) => item.type === "page" && (!manifest.pageUrlPattern || new RegExp(manifest.pageUrlPattern).test(item.url)))
	if (!page?.webSocketDebuggerUrl) throw new Error("no matching CDP page")
	const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
	try {
		for (const domain of ["Page", "Runtime", "DOM", "CSS", "Accessibility", "Network"]) await cdp.command(`${domain}.enable`)
		const source = new URL(page.url)
		if (manifest.reload !== false) {
			cdp.on("Fetch.requestPaused", (event) => {
				const allowed = isAllowedCaptureRequest(source, event.request.url)
				void cdp.command(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
					allowed ? { requestId: event.requestId } : { requestId: event.requestId, errorReason: "BlockedByClient" })
			})
			await cdp.command("Fetch.enable", { patterns: [{ urlPattern: "*" }] })
		}
		if (manifest.reload !== false)
			await cdp.command("Emulation.setDeviceMetricsOverride", { ...manifest.viewport, mobile: false })
		else {
			const metrics = await cdp.command("Page.getLayoutMetrics")
			const viewport = metrics.cssLayoutViewport
			if (Math.abs(viewport?.clientWidth - manifest.viewport.width) > .5 ||
				Math.abs(viewport?.clientHeight - manifest.viewport.height) > .5)
				throw new Error(`live interaction viewport ${viewport?.clientWidth}x${viewport?.clientHeight} does not match manifest ${manifest.viewport.width}x${manifest.viewport.height}`)
		}
		if (manifest.clearStorage) {
			const storageBootstrap = runtimeStorageBootstrapSource(manifest.runtimeState, true)
			if (source.protocol !== "file:")
				await cdp.command("Storage.clearDataForOrigin", { origin: source.origin, storageTypes: "all" })
			await cdp.command("Runtime.evaluate", { expression: storageBootstrap })
			await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: storageBootstrap })
		}
		const cohortSha256 = captureCohortIdentity(manifest)
		if (manifest.reload === false) await cdp.command("Runtime.evaluate", { expression: instrumentation })
		else {
			await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: `${bootstrapSource(manifest.clock)}\n${instrumentation}` })
			await cdp.command("Page.reload", { ignoreCache: true })
		}
		// Trusted CDP pointer/key events are delivered only to the frontmost page.
		// Live-session capture still needs this; reload:false means preserve state,
		// not capture an unfocused page with silently dropped input.
		await cdp.command("Page.bringToFront")
		if (manifest.reload !== false) for (let attempt = 0;; attempt++) {
			try {
				await evaluate(cdp, "document.fonts.ready")
				await Bun.sleep(100)
				break
			} catch (error) {
				if (attempt >= 9 || (!String(error).includes("Execution context was destroyed") &&
					!String(error).includes("Promise was collected"))) throw error
				await Bun.sleep(100)
			}
		}
		const initialAx = normalizeAxTree((await cdp.command("Accessibility.getFullAXTree")).nodes)
		if (manifest.reload !== false) {
			await evaluate(cdp, "window.focus()")
			await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: -1, y: -1 })
			await Bun.sleep(100)
		}
		const dynamicPayloads = new Map<string, string>()
		const bindingKey = (target: Target, binding: ActionBinding) => stableJson({ target, action: binding.action }).trim()
		const payloadFor = (target: Target, binding: ActionBinding) => binding.payload ?? dynamicPayloads.get(bindingKey(target, binding))
		const applyBinding = async (target: Target, binding: ActionBinding, requireTarget: boolean,
		                           allowUnreceipted: boolean) => {
			const payload = payloadFor(target, binding)
			const result = await evaluate(cdp, `(()=>{const elements=${targetElementsExpression(target)};if(!elements.length){${requireTarget ? "throw new Error('binding target unavailable')" : "return {count:0,visible:0}"}}const visible=elements.filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[data-closed],[hidden],[aria-hidden="true"]')}).length;for(const e of elements){e.setAttribute('data-pulp-action',${JSON.stringify(binding.action)});e.setAttribute('data-pulp-event',${JSON.stringify(binding.event ?? "click")});e.setAttribute('data-pulp-action-required',${JSON.stringify(binding.required === false ? "false" : "true")});${payload !== undefined ? `e.setAttribute('data-pulp-payload-contract',${JSON.stringify(payload)});` : "e.removeAttribute('data-pulp-payload-contract');"}}return{count:elements.length,visible}})()`)
			if (binding.payloadReceipt && payload === undefined && result.visible > 0 && !allowUnreceipted)
				throw new Error(`binding ${binding.action} has visible targets but no observed payload receipt`)
			return result
		}
		const applyManifestBindings = async (requireAll: boolean) => {
			for (const binding of manifest.bindings ?? []) {
				await applyBinding(binding.target, binding, requireAll && !binding.payloadReceipt, false)
			}
		}
		await applyManifestBindings(manifest.reload !== false)
		const captureState = async (spec: { state: string; output: string }) => {
			const output = resolve(spec.output)
			const metadata = await captureCurrentStructuralState(cdp, { output,
				viewport: manifest.viewport, clock: manifest.clock,
				sourceRevision: manifest.sourceRevision!, cohortSha256,
				runtimeState: manifest.runtimeState })
			return { state: spec.state, output, metadata }
		}
		const neutralizePointer = async () => {
			await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: -1, y: -1 })
			await Bun.sleep(50)
		}
		if (manifest.initialStateCapture) await neutralizePointer()
		const initialState = manifest.initialStateCapture ? await captureState(manifest.initialStateCapture) : undefined
		await evaluate(cdp, instrumentation)
		const focusOrder = await evaluate(cdp, `(() => [...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&getComputedStyle(e).display!=='none').map(e=>({sourceId:__pulpSourceId(e),role:e.getAttribute('role')||e.tagName.toLowerCase(),name:(e.getAttribute('aria-label')||e.textContent||e.value||'').trim(),tabIndex:e.tabIndex})))()`)
		const scenarios = []
		for (const scenario of manifest.scenarios) {
			await evaluate(cdp, "__pulpInteractionEvents.length=0")
			const action = scenario.action
			const binding = resolveScenarioBinding(manifest, scenario)
			let payloadReceipt: Record<string, unknown> | undefined
			let commandItemReceipt: Record<string, unknown> | undefined
			if ((binding?.activationReceipt?.source === "command-item-runtime" ||
				binding?.payloadReceipt?.source === "command-item-react-key") && action.target) {
				const observed = await evaluate(cdp, `(()=>{const e=${targetExpression(action.target)};if(!e)throw new Error('command receipt target unavailable');if(e.getAttribute('data-slot')!=='command-item'||!e.hasAttribute('cmdk-item')||e.getAttribute('role')!=='option')throw new Error('command receipt target is not a runtime command item');const identity=e.getAttribute('data-value');if(!identity)throw new Error('command item runtime identity is empty');const fiberProperty=Object.keys(e).find(key=>key.startsWith('__reactFiber$'));if(!fiberProperty)throw new Error('command item React fiber unavailable');let fiber=e[fiberProperty],component=null;for(let depth=0;fiber&&depth<16;depth++,fiber=fiber.return){const type=typeof fiber.type==='string'?fiber.type:(fiber.type?.displayName||fiber.type?.name||'');if(type==='CommandItem'&&typeof fiber.memoizedProps?.onSelect==='function'){component=fiber;break}}if(!component)throw new Error('command item source handler unavailable');return{identity,componentKey:component.key??null,disabled:!!(e.getAttribute('aria-disabled')==='true'||component.memoizedProps?.disabled),handlerSource:String(component.memoizedProps.onSelect)}})()`)
				commandItemReceipt = { source: "command-item-runtime",
					policy: binding.activationReceipt?.policy,
					identity: observed.identity, componentKey: observed.componentKey,
					disabled: observed.disabled, handlerSource: observed.handlerSource,
					handlerSha256: sha256(observed.handlerSource) }
				if (binding.payloadReceipt?.source === "command-item-react-key") {
					if (typeof observed.componentKey !== "string" || !observed.componentKey)
						throw new Error(`${scenario.id}: command item React key receipt is empty`)
					dynamicPayloads.set(bindingKey(action.target, binding), observed.componentKey)
					payloadReceipt = { source: binding.payloadReceipt.source,
						componentKey: observed.componentKey }
				}
				if (binding.activationReceipt?.policy === "disabled" && observed.disabled !== true)
					throw new Error(`${scenario.id}: disabled command receipt target is enabled`)
			}
			if (binding && action.target) await applyBinding(action.target, binding, true, true)
			let associatedControl: AssociatedControlCandidate | undefined
			let associatedTriggerId: string | undefined
			if (binding?.payloadReceipt?.source === "associated-control-value" && action.target) {
				const association = await evaluate(cdp, `(()=>{const option=${targetExpression(action.target)};if(!option)throw new Error('payload receipt target unavailable');const listbox=option.closest('[role=listbox]');if(!listbox?.id?.endsWith('-list'))throw new Error('select option is not associated with an identified listbox');const trigger=document.getElementById(listbox.id.slice(0,-5));if(!trigger||trigger.getAttribute('role')!=='combobox')throw new Error('select listbox controller unavailable');const scope=trigger.parentElement;if(!scope)throw new Error('select controller scope unavailable');const ordered=[...scope.querySelectorAll('[role=combobox],input,textarea,select')];const triggerIndex=ordered.indexOf(trigger);if(triggerIndex<0)throw new Error('select controller is outside its value scope');return{triggerId:trigger.id,candidates:ordered.map((e,index)=>({element:e,index})).filter(({element})=>element!==trigger&&/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)&&element.type!=='file').map(({element,index})=>({sourceId:__pulpSourceId(element),value:String(element.value??''),distance:Math.abs(index-triggerIndex),afterTrigger:index>triggerIndex}))}})()`)
				associatedTriggerId = association.triggerId
				associatedControl = selectAssociatedControlCandidate(association.candidates)
			}
			const target = action.target ? await evaluate(cdp, `(()=>{const e=${targetExpression(action.target)};if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,disabled:!!(e.disabled||e.getAttribute('aria-disabled')==='true'),selected:!!(e.selected||e.getAttribute('aria-selected')==='true'),sourceId:__pulpSourceId(e)}})()`) : null
			if (action.target && !target) throw new Error(`${scenario.id}: target unavailable`)
			if (action.type === "pointer") {
				const x = target.x + target.width / 2, y = target.y + target.height / 2
				for (const command of [{ type: "mouseMoved" }, { type: "mousePressed", button: "left", clickCount: 1 }, { type: "mouseReleased", button: "left", clickCount: 1 }]) await cdp.command("Input.dispatchMouseEvent", { ...command, x, y })
			} else if (action.type === "activate") {
				await evaluate(cdp, `(${targetExpression(action.target)}).click()`)
			} else if (action.type === "hover") {
				const x = target.x + target.width / 2, y = target.y + target.height / 2
				await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
			} else if (action.type === "focus") {
				await evaluate(cdp, `(${targetExpression(action.target)}).focus()`)
			} else if (action.type === "key") {
				if (action.target) await evaluate(cdp, `(${targetExpression(action.target)}).focus()`)
				const activation = action.key === "Enter" ? { code: "Enter", windowsVirtualKeyCode: 13 } : action.key === " " ? { code: "Space", windowsVirtualKeyCode: 32 } : {}
				await cdp.command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: action.key, ...activation })
				if (action.text || action.key.length === 1) await cdp.command("Input.dispatchKeyEvent", { type: "char", key: action.key, text: action.text ?? action.key, ...activation })
				else if (action.key === "Enter") await cdp.command("Input.dispatchKeyEvent", { type: "char", key: action.key, text: "\r", ...activation })
				await cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key: action.key, ...activation })
			} else if (action.type === "scroll") {
				await evaluate(cdp, `(()=>{const e=${targetExpression(action.target)};e.scrollTo(${action.left ?? 0},${action.top})})()`)
			} else if (action.type === "evaluate") {
				await evaluate(cdp, action.expression)
			}
			await Bun.sleep(scenario.settleMs ?? (manifest.reload === false ? 200 : 250))
			if (binding?.payloadReceipt?.source === "associated-control-value" && action.target && associatedControl && associatedTriggerId) {
				const afterCandidates = await evaluate(cdp, `(()=>{const trigger=document.getElementById(${JSON.stringify(associatedTriggerId)});if(!trigger||trigger.getAttribute('role')!=='combobox')throw new Error('associated select controller was removed');const scope=trigger.parentElement;if(!scope)throw new Error('associated select controller scope was removed');const ordered=[...scope.querySelectorAll('[role=combobox],input,textarea,select')];const triggerIndex=ordered.indexOf(trigger);return ordered.map((e,index)=>({element:e,index})).filter(({element})=>element!==trigger&&/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)&&element.type!=='file').map(({element,index})=>({sourceId:__pulpSourceId(element),value:String(element.value??''),distance:Math.abs(index-triggerIndex),afterTrigger:index>triggerIndex}))})()`)
				const observedControl = selectAssociatedControlCandidate(afterCandidates)
				if (!observedControl.value) throw new Error(`${scenario.id}: associated select value receipt is empty`)
				dynamicPayloads.set(bindingKey(action.target, binding), observedControl.value)
				payloadReceipt = { source: binding.payloadReceipt.source,
					controlSourceId: observedControl.sourceId, beforeValue: associatedControl.value, value: observedControl.value }
			}
			// A click necessarily leaves the synthetic pointer over its target.
			// Snapshotting there folds :hover paint into an application-state
			// candidate and makes independent dimensions appear to conflict.
			// Explicit hover scenarios intentionally retain their pointer state.
			if (scenario.stateCapture && shouldNeutralizePointerForStateCapture(action.type)) {
				await neutralizePointer()
			}
			// Reset/evaluate scenarios may recreate or reveal binding targets.
			// Reapply every currently available binding immediately before the
			// structural snapshot so reload:false cohorts retain action evidence.
			if (scenario.stateCapture) await applyManifestBindings(false)
			const stateCapture = scenario.stateCapture ? await captureState(scenario.stateCapture) : undefined
			const events = await evaluate(cdp, "globalThis.__pulpInteractionEvents??[]")
			if (commandItemReceipt && isTrustedActivation(action)) {
				const trustedClick = events.some((event: any) => event.type === "click" && event.isTrusted === true)
				if (!trustedClick) throw new Error(`${scenario.id}: command item activation produced no trusted click receipt`)
				commandItemReceipt.trustedClickObserved = true
			}
			const state = action.target ? await evaluate(cdp, `(()=>{const sid=(element)=>{const parts=[];for(let e=element;e&&e.nodeType===1;e=e.parentElement){const p=e.parentElement;parts.push(e.tagName.toLowerCase()+":"+(p?Array.from(p.children).indexOf(e)+1:1))}return parts.reverse().join('/')};const e=[...document.querySelectorAll('*')].find(candidate=>sid(candidate)===${JSON.stringify(target.sourceId)});if(!e)return{removed:true};return{focused:document.activeElement===e,disabled:!!(e.disabled||e.getAttribute('aria-disabled')==='true'),selected:!!(e.selected||e.getAttribute('aria-selected')==='true'),expanded:e.getAttribute('aria-expanded'),value:'value'in e?e.value:null,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft}})()`) : null
			const ax = normalizeAxTree((await cdp.command("Accessibility.getFullAXTree")).nodes)
			scenarios.push({ id: scenario.id, action, binding, payloadReceipt,
				activationReceipt: commandItemReceipt, target, events, state, ax, stateCapture })
		}
		const evidence = { schema: INTERACTION_SCHEMA, policy: { viewport: manifest.viewport, clock: manifest.clock, sourceRevision: manifest.sourceRevision, runtimeState: runtimeStateProvenance(manifest.runtimeState), cohortSha256, network: manifest.reload === false ? "unchanged-live-session" : "external-denied-source-origin-allowed", hostServices: manifest.reload === false ? "live-existing" : "recording-fake" }, focusOrder, initialAx, initialState, scenarios }
		const bytes = stableJson(evidence); await mkdir(resolve(manifest.output), { recursive: true }); await writeFile(resolve(manifest.output, "interactions.json"), bytes)
		const metadata = { schema: INTERACTION_SCHEMA, evidenceSha256: sha256(bytes), manifestSha256: sha256(stableJson({ ...manifest, output: "<output>" })), cohortSha256 }
		await writeFile(resolve(manifest.output, "interactions-meta.json"), stableJson(metadata)); return metadata
	} finally {
		try { await cdp.command("Fetch.disable") } catch {}
		cdp.close()
	}
}

async function main() {
	const index = process.argv.indexOf("--manifest")
	if (index < 0 || !process.argv[index + 1]) throw new Error("usage: capture-interactions-cdp.ts --manifest interactions.json")
	const manifest = validateInteractionManifest(JSON.parse(await readFile(resolve(process.argv[index + 1]), "utf8")))
	console.log(stableJson(await captureInteractions(manifest)).trim())
}
if (import.meta.main) await main()
