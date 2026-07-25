import { fireEvent, render, screen } from "@testing-library/react";
import { platform } from "@tauri-apps/plugin-os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "../Settings";
import { defaultConfig, type Config } from "@/utils/config";

const mockSetConfig = vi.fn();
let mockConfig: Config = defaultConfig;

vi.mock("@/context/ConfigContext", () => ({
	useConfigContext: () => ({
		config: mockConfig,
		setConfig: mockSetConfig,
		isConfigLoaded: true,
	}),
}));

vi.mock("@/context/theme-provider", () => ({
	useTheme: () => ({
		theme: mockConfig.theme,
		setTheme: vi.fn(),
	}),
}));

describe("Settings tray color thresholds", () => {
	beforeEach(() => {
		mockConfig = { ...defaultConfig };
		mockSetConfig.mockReset();
		vi.mocked(platform).mockReturnValue("windows");
	});

	it("shows always-enabled tray color thresholds only on Windows", () => {
		const view = render(<Settings onExit={vi.fn()} />);

		expect(screen.getByText("Tray icon color thresholds")).toBeTruthy();
		expect((screen.getByLabelText("Tray icon red threshold") as HTMLInputElement).disabled).toBe(false);
		expect((screen.getByLabelText("Tray icon green threshold") as HTMLInputElement).disabled).toBe(false);
		expect(screen.queryByText("Tray icon components [macOS only]")).toBeNull();

		view.unmount();
		vi.mocked(platform).mockReturnValue("macos");
		render(<Settings onExit={vi.fn()} />);

		expect(screen.queryByText("Tray icon color thresholds")).toBeNull();
		expect(screen.getByText("Tray icon components [macOS only]")).toBeTruthy();
	});

	it("commits clamped tray color thresholds without changing notification thresholds", () => {
		render(<Settings onExit={vi.fn()} />);

		const redThreshold = screen.getByLabelText("Tray icon red threshold");
		fireEvent.change(redThreshold, { target: { value: "90" } });
		fireEvent.blur(redThreshold);

		const greenThreshold = screen.getByLabelText("Tray icon green threshold");
		fireEvent.change(greenThreshold, { target: { value: "2" } });
		fireEvent.blur(greenThreshold);

		const updateLow = mockSetConfig.mock.calls[0][0] as (config: Config) => Config;
		const updateHigh = mockSetConfig.mock.calls[1][0] as (config: Config) => Config;

		expect(updateLow(defaultConfig)).toEqual({
			...defaultConfig,
			trayColorLowThreshold: 49,
		});
		expect(updateHigh(defaultConfig)).toEqual({
			...defaultConfig,
			trayColorHighThreshold: 21,
		});
	});
});
