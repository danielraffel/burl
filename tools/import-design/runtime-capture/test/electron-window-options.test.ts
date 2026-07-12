import { describe, expect, test } from "bun:test"
import { lowerElectronWindowChrome } from "../electron-window-options"

describe("Electron window chrome lowering", () => {
	test("lowers a generic transparent hidden-inset vibrancy fixture", () => {
		expect(lowerElectronWindowChrome({
			transparent: true,
			backgroundColor: "#10203000",
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 12, y: 14 },
			vibrancy: "menu",
			visualEffectState: "active",
			show: false,
		})).toEqual({
			transparent: true,
			backgroundRgba: "#10203000",
			titleBarStyle: "hidden-inset",
			trafficLightPosition: { x: 12, y: 14 },
			backdropEffect: "vibrancy-menu",
			backdropState: "active",
			deferShowUntilFirstFrame: true,
		})
	})
	test("rejects unsupported effects instead of approximating silently", () => {
		expect(() => lowerElectronWindowChrome({ backgroundColor: "#000000ff", vibrancy: "sidebar" })).toThrow("unsupported Electron vibrancy")
	})
})
