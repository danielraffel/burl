export interface ElectronWindowChromeEvidence {
	transparent: boolean
	backgroundColor: string
	titleBarStyle: "system" | "hiddenInset"
	trafficLightPosition?: { x: number; y: number }
	vibrancy?: "menu"
	visualEffectState?: "active" | "inactive" | "followWindow"
	show: boolean
}

export interface PortableWindowChromeContract {
	transparent: boolean
	backgroundRgba: string
	titleBarStyle: "system" | "hidden-inset"
	trafficLightPosition?: { x: number; y: number }
	backdropEffect: "none" | "vibrancy-menu"
	backdropState: "active" | "inactive" | "follow-window"
	deferShowUntilFirstFrame: boolean
}

export function lowerElectronWindowChrome(input: Record<string, unknown>): PortableWindowChromeContract {
	const color = String(input.backgroundColor ?? "#1e1e2eff")
	if (!/^#[0-9a-f]{8}$/i.test(color)) throw new Error(`Electron backgroundColor must be #RRGGBBAA: ${color}`)
	if (input.titleBarStyle !== undefined && input.titleBarStyle !== "hiddenInset")
		throw new Error(`unsupported Electron titleBarStyle ${String(input.titleBarStyle)}`)
	if (input.vibrancy !== undefined && input.vibrancy !== "menu")
		throw new Error(`unsupported Electron vibrancy ${String(input.vibrancy)}`)
	const point = input.trafficLightPosition as { x?: unknown; y?: unknown } | undefined
	if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y)))
		throw new Error("Electron trafficLightPosition must contain finite x/y")
	const state = input.visualEffectState ?? "followWindow"
	if (!["active", "inactive", "followWindow"].includes(String(state)))
		throw new Error(`unsupported Electron visualEffectState ${String(state)}`)
	return {
		transparent: input.transparent === true,
		backgroundRgba: color.toLowerCase(),
		titleBarStyle: input.titleBarStyle === "hiddenInset" ? "hidden-inset" : "system",
		...(point ? { trafficLightPosition: { x: Number(point.x), y: Number(point.y) } } : {}),
		backdropEffect: input.vibrancy === "menu" ? "vibrancy-menu" : "none",
		backdropState: state === "followWindow" ? "follow-window" : state as "active" | "inactive",
		deferShowUntilFirstFrame: input.show === false,
	}
}
