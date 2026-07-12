#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { bootstrapSource, Cdp, sha256, stableJson } from "./capture-source-cdp"

export const INTERACTION_SCHEMA = "pulp-runtime-interaction-capture-v1"

type Target = { selector?: string; role?: string; name?: string }
type Action =
	| { type: "pointer"; target: Target }
	| { type: "focus"; target: Target }
	| { type: "key"; target?: Target; key: string; text?: string }
	| { type: "scroll"; target: Target; top: number; left?: number }

interface Manifest {
	schemaVersion: 1
	cdpEndpoint: string
	pageUrlPattern?: string
	output: string
	viewport: { width: number; height: number; deviceScaleFactor: 1 | 2 | 3 }
	clock: string
	security: { mode: "recording-fake" }
	scenarios: Array<{ id: string; action: Action }>
}

export function validateInteractionManifest(value: any): Manifest {
	if (value?.schemaVersion !== 1) throw new Error("schemaVersion must be 1")
	if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(value.cdpEndpoint ?? "")) throw new Error("CDP endpoint must be loopback")
	if (value.security?.mode !== "recording-fake") throw new Error("security must be recording-fake")
	if (!Array.isArray(value.scenarios) || !value.scenarios.length) throw new Error("scenarios must not be empty")
	const ids = new Set<string>()
	for (const scenario of value.scenarios) {
		if (!scenario.id || ids.has(scenario.id)) throw new Error("scenario IDs must be unique and non-empty")
		ids.add(scenario.id)
		const action = scenario.action
		if (!["pointer", "focus", "key", "scroll"].includes(action?.type)) throw new Error(`${scenario.id}: unsupported action`)
		if (action.target && !action.target.selector && !action.target.role) throw new Error(`${scenario.id}: target needs selector or role`)
		if (["pointer", "focus", "scroll"].includes(action.type) && !action.target) throw new Error(`${scenario.id}: target required`)
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

const instrumentation = `(() => {
if(globalThis.__pulpInteractionInstrumentation)return;globalThis.__pulpInteractionInstrumentation=true;
globalThis.__pulpInteractionEvents=[];let sequence=0;
const sid=(element)=>{const parts=[];for(let e=element;e&&e.nodeType===1;e=e.parentElement){const p=e.parentElement;parts.push(e.tagName.toLowerCase()+":"+(p?Array.from(p.children).indexOf(e)+1:1))}return parts.reverse().join("/")};
for(const type of ["pointerover","pointerenter","pointerdown","pointerup","click","focusin","focusout","keydown","beforeinput","input","keyup","scroll"]){
document.addEventListener(type,event=>{const target=event.target;globalThis.__pulpInteractionEvents.push({sequence:++sequence,type,target:sid(target),key:event.key??null,inputType:event.inputType??null,value:"value" in target?target.value:null,scrollTop:target.scrollTop??null,scrollLeft:target.scrollLeft??null,defaultPrevented:event.defaultPrevented})},true)
}
globalThis.__pulpSourceId=sid;
})();`

function targetExpression(target: Target): string {
	if (target.selector) return `document.querySelector(${JSON.stringify(target.selector)})`
	return `[...document.querySelectorAll('[role],button,input,textarea,select,a[href]')].find(e=>(e.getAttribute('role')||({BUTTON:'button',TEXTAREA:'textbox',INPUT:'textbox',A:'link'})[e.tagName]||'')===${JSON.stringify(target.role)}&&(!${JSON.stringify(target.name ?? "")}||(e.getAttribute('aria-label')||e.textContent||'').trim()===${JSON.stringify(target.name ?? "")}))`
}

async function evaluate(cdp: Cdp, expression: string): Promise<any> {
	const result = await cdp.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "runtime evaluation failed")
	return result.result.value
}

export async function captureInteractions(manifest: Manifest): Promise<Record<string, unknown>> {
	const pages = await fetch(`${manifest.cdpEndpoint}/json/list`).then((response) => response.json()) as any[]
	const page = pages.find((item) => item.type === "page" && (!manifest.pageUrlPattern || new RegExp(manifest.pageUrlPattern).test(item.url)))
	if (!page?.webSocketDebuggerUrl) throw new Error("no matching CDP page")
	const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
	try {
		for (const domain of ["Page", "Runtime", "DOM", "Accessibility", "Network"]) await cdp.command(`${domain}.enable`)
		await cdp.command("Network.setBlockedURLs", { urls: ["http://*/*", "https://*/*"] })
		await cdp.command("Emulation.setDeviceMetricsOverride", { ...manifest.viewport, mobile: false })
		await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: `${bootstrapSource(manifest.clock)}\n${instrumentation}` })
		await cdp.command("Page.reload", { ignoreCache: true })
		await evaluate(cdp, "document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))")
		const initialAx = normalizeAxTree((await cdp.command("Accessibility.getFullAXTree")).nodes)
		const focusOrder = await evaluate(cdp, `(() => [...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&getComputedStyle(e).display!=='none').map(e=>({sourceId:__pulpSourceId(e),role:e.getAttribute('role')||e.tagName.toLowerCase(),name:(e.getAttribute('aria-label')||e.textContent||e.value||'').trim(),tabIndex:e.tabIndex})))()`)
		const scenarios = []
		for (const scenario of manifest.scenarios) {
			await evaluate(cdp, "__pulpInteractionEvents.length=0")
			const action = scenario.action
			const target = action.target ? await evaluate(cdp, `(()=>{const e=${targetExpression(action.target)};if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,disabled:!!(e.disabled||e.getAttribute('aria-disabled')==='true'),selected:!!(e.selected||e.getAttribute('aria-selected')==='true'),sourceId:__pulpSourceId(e)}})()`) : null
			if (action.target && !target) throw new Error(`${scenario.id}: target unavailable`)
			if (action.type === "pointer") {
				const x = target.x + target.width / 2, y = target.y + target.height / 2
				for (const command of [{ type: "mouseMoved" }, { type: "mousePressed", button: "left", clickCount: 1 }, { type: "mouseReleased", button: "left", clickCount: 1 }]) await cdp.command("Input.dispatchMouseEvent", { ...command, x, y })
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
			}
			await evaluate(cdp, "new Promise(r=>requestAnimationFrame(r))")
			const events = await evaluate(cdp, "__pulpInteractionEvents")
			const state = action.target ? await evaluate(cdp, `(()=>{const e=${targetExpression(action.target)};return{focused:document.activeElement===e,disabled:!!(e.disabled||e.getAttribute('aria-disabled')==='true'),selected:!!(e.selected||e.getAttribute('aria-selected')==='true'),value:'value'in e?e.value:null,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft}})()`) : null
			const ax = normalizeAxTree((await cdp.command("Accessibility.getFullAXTree")).nodes)
			scenarios.push({ id: scenario.id, action, target, events, state, ax })
		}
		const evidence = { schema: INTERACTION_SCHEMA, policy: { viewport: manifest.viewport, clock: manifest.clock, network: "denied", hostServices: "recording-fake" }, focusOrder, initialAx, scenarios }
		const bytes = stableJson(evidence); await mkdir(resolve(manifest.output), { recursive: true }); await writeFile(resolve(manifest.output, "interactions.json"), bytes)
		const metadata = { schema: INTERACTION_SCHEMA, evidenceSha256: sha256(bytes), manifestSha256: sha256(stableJson({ ...manifest, output: "<output>" })) }
		await writeFile(resolve(manifest.output, "interactions-meta.json"), stableJson(metadata)); return metadata
	} finally { cdp.close() }
}

async function main() {
	const index = process.argv.indexOf("--manifest")
	if (index < 0 || !process.argv[index + 1]) throw new Error("usage: capture-interactions-cdp.ts --manifest interactions.json")
	const manifest = validateInteractionManifest(JSON.parse(await readFile(resolve(process.argv[index + 1]), "utf8")))
	console.log(stableJson(await captureInteractions(manifest)).trim())
}
if (import.meta.main) await main()
