import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState, type Dispatch, type SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { getBatteryInfo, startBatteryNotificationMonitor } from "@/utils/ble";
import { defaultConfig, FETCH_INTERVAL_AUTO, NotificationType } from "@/utils/config";
import { sendNotification } from "@/utils/notification";

const { mockMoveWindowToTrayCenter, mockResizeWindowToContent } = vi.hoisted(() => ({
	mockMoveWindowToTrayCenter: vi.fn(async () => undefined),
	mockResizeWindowToContent: vi.fn(async () => undefined),
}));

const mockStore = {
	get: vi.fn(),
	set: vi.fn(async () => undefined),
};

const mockListen = vi.fn();
const mockUnlistenBatteryInfo = vi.fn();
const mockUnlistenMonitorStatus = vi.fn();

let monitorStatusHandler: ((event: { payload: { id: string; connected: boolean } }) => void) | undefined;
let batteryInfoNotificationHandler:
	| ((event: {
			payload: {
				id: string;
				battery_info: { battery_level: number | null; user_description: string | null };
			};
	  }) => void)
	| undefined;

/** Resolves every in-flight `mockStore.get("devices")` promise (e.g. React StrictMode double effect). */
let deviceGetResolvers: Array<(value: unknown) => void> = [];
let mockedConfig = defaultConfig;
let setMockedConfigInApp: Dispatch<SetStateAction<typeof defaultConfig>> | undefined;

function resolveDeviceStoreGets(payload: unknown) {
	while (deviceGetResolvers.length > 0) {
		const resolve = deviceGetResolvers.shift()!;
		resolve(payload);
	}
}

function getStoreSetCalls(): [string, unknown][] {
	return mockStore.set.mock.calls as unknown as [string, unknown][];
}

vi.mock("@/context/ConfigContext", () => ({
	useConfigContext: () => {
		const [config, setConfig] = useState(mockedConfig);
		setMockedConfigInApp = setConfig;
		return {
			config,
			isConfigLoaded: true,
			setConfig,
		};
	},
}));

vi.mock("@/utils/storage", () => ({
	load: vi.fn(async () => mockStore),
	getStorePath: vi.fn(async (filename: string) => filename),
}));

vi.mock("@/utils/ble", () => ({
	listBatteryDevices: vi.fn(async () => [{ id: "kbd-1", name: "MockBoard One" }]),
	getBatteryInfo: vi.fn(async () => [{ battery_level: 87, user_description: "Central" }]),
	startBatteryNotificationMonitor: vi.fn(async () => [{ battery_level: 87, user_description: "Central" }]),
	stopBatteryNotificationMonitor: vi.fn(async () => undefined),
	stopAllBatteryMonitors: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/useWindowEvents", () => ({
	useWindowEvents: vi.fn(),
}));

vi.mock("@/hooks/useTrayEvents", () => ({
	useTrayEvents: vi.fn(),
}));

vi.mock("@/utils/window", () => ({
	moveWindowToTrayCenter: mockMoveWindowToTrayCenter,
	resizeWindowToContent: mockResizeWindowToContent,
}));

vi.mock("@/utils/notification", () => ({
	sendNotification: vi.fn(async () => true),
}));

vi.mock("@/utils/batteryHistory", () => ({
	appendBatteryHistory: vi.fn(async () => undefined),
	recordBatteryReadings: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
	platform: () => "windows",
}));

vi.mock("@tauri-apps/api/event", () => ({
	emit: vi.fn(async () => undefined),
	listen: (...args: unknown[]) => mockListen(...args),
}));

describe("App", () => {
	beforeEach(() => {
		mockStore.set.mockClear();
		mockStore.get.mockClear();
		mockListen.mockReset();
		mockUnlistenBatteryInfo.mockReset();
		mockUnlistenMonitorStatus.mockReset();
		mockMoveWindowToTrayCenter.mockClear();
		mockResizeWindowToContent.mockClear();
		monitorStatusHandler = undefined;
		batteryInfoNotificationHandler = undefined;
		deviceGetResolvers = [];
		mockedConfig = defaultConfig;
		setMockedConfigInApp = undefined;
		vi.mocked(getBatteryInfo).mockReset();
		vi.mocked(getBatteryInfo).mockResolvedValue([{ battery_level: 87, user_description: "Central" }]);

		mockListen.mockImplementation(async (event: string, handler: unknown) => {
			if (event === "battery-info-notification") {
				batteryInfoNotificationHandler = handler as typeof batteryInfoNotificationHandler;
				return mockUnlistenBatteryInfo;
			}
			if (event === "battery-monitor-status") {
				monitorStatusHandler = handler as typeof monitorStatusHandler;
				return mockUnlistenMonitorStatus;
			}
			return vi.fn();
		});

		mockStore.get.mockImplementation(() => {
			return new Promise((resolve) => {
				deviceGetResolvers.push(resolve);
			});
		});
	});

	it("does not persist devices before initial load completes", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});
		expect(mockStore.set).not.toHaveBeenCalled();
		const deviceSetCallsBeforeHydrate = getStoreSetCalls().filter((c) => c[0] === "devices");
		expect(deviceSetCallsBeforeHydrate).toHaveLength(0);

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(mockStore.set).toHaveBeenCalledWith("devices", expect.any(Array));
		});
		const persistedWhileEmpty = getStoreSetCalls().some(
			(c) => c[0] === "devices" && Array.isArray(c[1]) && (c[1] as unknown[]).length === 0,
		);
		expect(persistedWhileEmpty).toBe(false);
	});

	it("updates disconnected state from battery-monitor-status events", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		await act(async () => {
			monitorStatusHandler?.({ payload: { id: "kbd-1", connected: false } });
		});
		expect(screen.getByLabelText("Disconnected")).toBeTruthy();

		await act(async () => {
			monitorStatusHandler?.({ payload: { id: "kbd-1", connected: true } });
		});
		expect(screen.queryByLabelText("Disconnected")).toBeNull();
	});

	it("collapses a device when it becomes disconnected and the option is enabled", async () => {
		mockedConfig = {
			...defaultConfig,
			autoCollapseDisconnectedDevices: true,
		};
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		await act(async () => {
			monitorStatusHandler?.({ payload: { id: "kbd-1", connected: false } });
		});

		expect(screen.getByRole("button", { name: "Expand device" })).toBeTruthy();
		expect(screen.queryByText("87%")).toBeNull();
	});

	it("expands a device when it reconnects and the option is enabled", async () => {
		mockedConfig = {
			...defaultConfig,
			autoCollapseDisconnectedDevices: true,
		};
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Collapse device" })).toBeTruthy();
		});

		await act(async () => {
			monitorStatusHandler?.({ payload: { id: "kbd-1", connected: false } });
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Expand device" })).toBeTruthy();
		});

		await act(async () => {
			monitorStatusHandler?.({ payload: { id: "kbd-1", connected: true } });
		});

		expect(screen.getByRole("button", { name: "Collapse device" })).toBeTruthy();
		expect(screen.getByText("87%")).toBeTruthy();
	});

	it("uses the latest auto collapse setting for battery-monitor-status events after rerender", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Collapse device" })).toBeTruthy();
		});

		await act(async () => {
			setMockedConfigInApp?.((config) => ({
				...config,
				autoCollapseDisconnectedDevices: true,
			}));
		});

		await act(async () => {
			monitorStatusHandler?.({ payload: { id: "kbd-1", connected: false } });
		});

		expect(screen.getByRole("button", { name: "Expand device" })).toBeTruthy();
		expect(screen.queryByText("87%")).toBeNull();
	});

	it("uses the latest auto collapse setting for battery-info-notification events after rerender", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: true,
					isCollapsed: true,
					batteryInfos: [{ battery_level: 40, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Expand device" })).toBeTruthy();
		});

		await act(async () => {
			setMockedConfigInApp?.((config) => ({
				...config,
				autoCollapseDisconnectedDevices: true,
			}));
		});

		await act(async () => {
			batteryInfoNotificationHandler?.({
				payload: {
					id: "kbd-1",
					battery_info: { battery_level: 87, user_description: "Central" },
				},
			});
		});

		expect(screen.getByRole("button", { name: "Collapse device" })).toBeTruthy();
		expect(screen.queryByLabelText("Disconnected")).toBeNull();
		expect(screen.getByText("87%")).toBeTruthy();
	});

	it("uses the latest auto collapse setting for manual reload after rerender", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: true,
					isCollapsed: true,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Expand device" })).toBeTruthy();
		});

		await act(async () => {
			setMockedConfigInApp?.((config) => ({
				...config,
				autoCollapseDisconnectedDevices: true,
			}));
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Reload" }));
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Collapse device" })).toBeTruthy();
		});
		expect(screen.getByText("87%")).toBeTruthy();
	});

	it("marks a device disconnected when switching to auto monitoring and the initial monitor snapshot is empty", async () => {
		vi.mocked(startBatteryNotificationMonitor).mockResolvedValue([]);
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Collapse device" })).toBeTruthy();
		});

		await act(async () => {
			setMockedConfigInApp?.((config) => ({
				...config,
				fetchInterval: FETCH_INTERVAL_AUTO,
				autoCollapseDisconnectedDevices: true,
			}));
		});

		await waitFor(() => {
			expect(startBatteryNotificationMonitor).toHaveBeenCalledWith("kbd-1");
		});

		expect(screen.getByRole("button", { name: "Expand device" })).toBeTruthy();
		expect(screen.getByLabelText("Disconnected")).toBeTruthy();
		expect(screen.queryByText("87%")).toBeNull();
	});

	it("does not refetch battery info when toggling auto collapse in polling mode", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(getBatteryInfo).toHaveBeenCalledTimes(1);
		});

		vi.mocked(getBatteryInfo).mockClear();

		await act(async () => {
			setMockedConfigInApp?.((config) => ({
				...config,
				autoCollapseDisconnectedDevices: true,
			}));
		});

		await act(async () => {
			await Promise.resolve();
		});

		expect(getBatteryInfo).not.toHaveBeenCalled();
	});

	it("cleans up event listeners on unmount", async () => {
		const view = render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([]);
		});

		await waitFor(() => {
			expect(mockListen).toHaveBeenCalledWith("battery-info-notification", expect.any(Function));
			expect(mockListen).toHaveBeenCalledWith("battery-monitor-status", expect.any(Function));
		});

		view.unmount();

		await waitFor(() => {
			expect(mockUnlistenBatteryInfo).toHaveBeenCalledTimes(1);
			expect(mockUnlistenMonitorStatus).toHaveBeenCalledTimes(1);
		});
	});

	it("does not register BLE listeners until the device store has been read from disk", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		const bleChannels = mockListen.mock.calls.map((c) => c[0] as string);
		expect(bleChannels).not.toContain("battery-info-notification");
		expect(bleChannels).not.toContain("battery-monitor-status");

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(mockListen).toHaveBeenCalledWith("battery-info-notification", expect.any(Function));
			expect(mockListen).toHaveBeenCalledWith("battery-monitor-status", expect.any(Function));
		});
	});

	it("battery-info-notification updates persisted devices without writing an empty device list", async () => {
		const saved = [
			{
				id: "kbd-1",
				name: "MockBoard One",
				isDisconnected: false,
				isCollapsed: false,
				batteryInfos: [{ battery_level: 87, user_description: "Central" }],
			},
		];

		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});
		expect(mockStore.set).not.toHaveBeenCalled();

		await act(async () => {
			resolveDeviceStoreGets(saved);
		});

		await waitFor(() => {
			expect(batteryInfoNotificationHandler).toBeDefined();
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		mockStore.set.mockClear();

		await act(async () => {
			batteryInfoNotificationHandler?.({
				payload: {
					id: "kbd-1",
					battery_info: { battery_level: 42, user_description: "Central" },
				},
			});
		});

		await waitFor(() => {
			expect(mockStore.set).toHaveBeenCalled();
		});
		const emptyPersist = getStoreSetCalls().some(
			(c) => c[0] === "devices" && Array.isArray(c[1]) && (c[1] as unknown[]).length === 0,
		);
		expect(emptyPersist).toBe(false);
		const lastDevicesWrite = [...getStoreSetCalls()].reverse().find((c) => c[0] === "devices");
		expect(lastDevicesWrite?.[1]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "kbd-1",
					batteryInfos: expect.arrayContaining([
						expect.objectContaining({ battery_level: 42, user_description: "Central" }),
					]),
				}),
			]),
		);
	});

	it("hydrates saved devices when StrictMode runs the load effect more than once", async () => {
		const saved = [
			{
				id: "kbd-1",
				name: "MockBoard One",
				isDisconnected: false,
				isCollapsed: false,
				batteryInfos: [{ battery_level: 87, user_description: "Central" }],
			},
		];

		render(
			<StrictMode>
				<App />
			</StrictMode>,
		);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
			expect(deviceGetResolvers.length).toBeGreaterThanOrEqual(1);
		});

		await act(async () => {
			resolveDeviceStoreGets(saved);
		});

		await waitFor(() => {
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		const rows = screen.getAllByText("MockBoard One");
		expect(rows).toHaveLength(1);
	});

	it("hydrates collapsed state and keeps the device collapsed after reload", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: true,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		expect(screen.getByRole("button", { name: "Expand device" })).toBeTruthy();
		expect(screen.queryByText("87%")).toBeNull();
	});

	it("persists collapsed state when the user collapses a device", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		mockStore.set.mockClear();

		await act(async () => {
			screen.getByRole("button", { name: "Collapse device" }).click();
		});

		await waitFor(() => {
			expect(mockStore.set).toHaveBeenCalledWith(
				"devices",
				expect.arrayContaining([
					expect.objectContaining({
						id: "kbd-1",
						isCollapsed: true,
					}),
				]),
			);
		});
	});

	it("resizes the window when the user toggles device collapse", async () => {
		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		mockResizeWindowToContent.mockClear();
		mockMoveWindowToTrayCenter.mockClear();

		await act(async () => {
			screen.getByRole("button", { name: "Collapse device" }).click();
		});

		await waitFor(() => {
			expect(mockResizeWindowToContent).toHaveBeenCalled();
		});

		mockResizeWindowToContent.mockClear();
		mockMoveWindowToTrayCenter.mockClear();

		await act(async () => {
			screen.getByRole("button", { name: "Expand device" }).click();
		});

		await waitFor(() => {
			expect(mockResizeWindowToContent).toHaveBeenCalled();
		});
	});

	it("does not resize the window when only battery level changes in auto mode", async () => {
		mockedConfig = { ...defaultConfig, fetchInterval: FETCH_INTERVAL_AUTO };

		render(<App />);

		await waitFor(() => {
			expect(mockStore.get).toHaveBeenCalledWith("devices");
		});

		await act(async () => {
			resolveDeviceStoreGets([
				{
					id: "kbd-1",
					name: "MockBoard One",
					isDisconnected: false,
					isCollapsed: false,
					batteryInfos: [{ battery_level: 87, user_description: "Central" }],
				},
			]);
		});

		await waitFor(() => {
			expect(screen.getByText("MockBoard One")).toBeTruthy();
		});

		// First notification transitions isDisconnected (loaded devices start as
		// disconnected) which legitimately triggers a layout change. Fire it and
		// let the resulting effects settle.
		await act(async () => {
			batteryInfoNotificationHandler?.({
				payload: {
					id: "kbd-1",
					battery_info: { battery_level: 60, user_description: "Central" },
				},
			});
		});
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 200));
		});

		mockResizeWindowToContent.mockClear();
		mockMoveWindowToTrayCenter.mockClear();

		// Second notification only changes battery level — no layout change
		await act(async () => {
			batteryInfoNotificationHandler?.({
				payload: {
					id: "kbd-1",
					battery_info: { battery_level: 42, user_description: "Central" },
				},
			});
		});

		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 200));
		});

		expect(mockResizeWindowToContent).not.toHaveBeenCalled();
		expect(mockMoveWindowToTrayCenter).not.toHaveBeenCalled();
	});

	describe("polling overlap guard", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("skips a poll cycle when the previous one is still in flight", async () => {
			const fetchInterval = 5_000;
			mockedConfig = { ...defaultConfig, fetchInterval };

			let resolvePoll!: (value: { battery_level: number; user_description: string }[]) => void;
			vi.mocked(getBatteryInfo).mockImplementation(
				() => new Promise((resolve) => { resolvePoll = resolve; }),
			);

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "kbd-1",
						name: "MockBoard One",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 87, user_description: "Central" }],
					},
				]);
			});

			expect(getBatteryInfo).toHaveBeenCalledTimes(1);

			await act(async () => {
				vi.advanceTimersByTime(fetchInterval);
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(1);

			await act(async () => {
				vi.advanceTimersByTime(fetchInterval);
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(1);

			await act(async () => {
				resolvePoll([{ battery_level: 90, user_description: "Central" }]);
			});

			await act(async () => {
				vi.advanceTimersByTime(fetchInterval);
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(2);
		});

		it("queues other devices behind an in-flight BLE read", async () => {
			const fetchInterval = 5_000;
			mockedConfig = { ...defaultConfig, fetchInterval };

			let resolveStalledPoll!: (
				value: { battery_level: number; user_description: string }[],
			) => void;
			vi.mocked(getBatteryInfo).mockImplementation((id: string) => {
				if (id === "stalled-device") {
					return new Promise((resolve) => { resolveStalledPoll = resolve; });
				}
				return Promise.resolve([{ battery_level: 72, user_description: "Central" }]);
			});

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "stalled-device",
						name: "Stalled Device",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 100, user_description: "Central" }],
					},
					{
						id: "responsive-device",
						name: "Responsive Device",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 73, user_description: "Central" }],
					},
				]);
			});

			expect(
				vi.mocked(getBatteryInfo).mock.calls.filter(([id]) => id === "stalled-device"),
			).toHaveLength(1);
			expect(
				vi.mocked(getBatteryInfo).mock.calls.filter(([id]) => id === "responsive-device"),
			).toHaveLength(0);

			await act(async () => {
				vi.advanceTimersByTime(fetchInterval);
			});

			expect(
				vi.mocked(getBatteryInfo).mock.calls.filter(([id]) => id === "stalled-device"),
			).toHaveLength(1);
			expect(
				vi.mocked(getBatteryInfo).mock.calls.filter(([id]) => id === "responsive-device"),
			).toHaveLength(0);

			await act(async () => {
				resolveStalledPoll([{ battery_level: 99, user_description: "Central" }]);
				await Promise.resolve();
			});

			expect(
				vi.mocked(getBatteryInfo).mock.calls.filter(([id]) => id === "responsive-device"),
			).toHaveLength(1);
			expect(screen.getByText("72%")).toBeTruthy();
		});

		it("does not disconnect a device when startup BLE reads share one adapter", async () => {
			const fetchInterval = 60_000;
			mockedConfig = { ...defaultConfig, fetchInterval };

			let activeReads = 0;
			let maxActiveReads = 0;
			let resolveTrackball!: (
				value: { battery_level: number; user_description: string }[],
			) => void;
			vi.mocked(getBatteryInfo).mockImplementation((id: string) => {
				if (activeReads > 0) {
					return Promise.reject(new Error("Bluetooth adapter is busy"));
				}

				activeReads += 1;
				maxActiveReads = Math.max(maxActiveReads, activeReads);
				if (id === "trackball") {
					return new Promise((resolve) => {
						resolveTrackball = (value) => {
							activeReads -= 1;
							resolve(value);
						};
					});
				}

				activeReads -= 1;
				return Promise.resolve([{ battery_level: 70, user_description: "Left" }]);
			});

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "trackball",
						name: "EH TB Mini v3",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 89, user_description: "Trackball" }],
					},
					{
						id: "splits",
						name: "EH_OP36",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 69, user_description: "Left" }],
					},
				]);
			});

			await act(async () => {
				vi.advanceTimersByTime(1_000);
			});

			await act(async () => {
				resolveTrackball([{ battery_level: 88, user_description: "Trackball" }]);
				await Promise.resolve();
			});

			expect(maxActiveReads).toBe(1);
			expect(screen.queryByLabelText("Disconnected")).toBeNull();
			expect(screen.getByText("70%")).toBeTruthy();
		});

		it("keeps manual reload visible and retries after the active poll fails", async () => {
			const fetchInterval = 5_000;
			mockedConfig = { ...defaultConfig, fetchInterval };

			let rejectPoll!: (reason: Error) => void;
			vi.mocked(getBatteryInfo)
				.mockImplementationOnce(
					() => new Promise((_, reject) => { rejectPoll = reject; }),
				)
				.mockResolvedValue([{ battery_level: 94, user_description: "Central" }]);

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "kbd-1",
						name: "MockBoard One",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 100, user_description: "Central" }],
					},
				]);
			});

			// Initial poll cycle is in flight
			expect(getBatteryInfo).toHaveBeenCalledTimes(1);
			expect(screen.getByText("100%")).toBeTruthy();

			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Reload" }));
			});

			// The click joins the active request instead of disappearing without
			// feedback or launching an unsafe concurrent BLE request.
			expect(getBatteryInfo).toHaveBeenCalledTimes(1);
			expect(screen.getByText("Fetching battery info...")).toBeTruthy();

			await act(async () => {
				rejectPoll(new Error("Battery read timed out"));
				await Promise.resolve();
				vi.advanceTimersByTime(500);
			});

			await act(async () => {
				await Promise.resolve();
			});

			expect(getBatteryInfo).toHaveBeenCalledTimes(2);
			expect(screen.getByText("94%")).toBeTruthy();
			expect(screen.queryByText("Fetching battery info...")).toBeNull();
		});

		it("skips a poll cycle while a manual reload is in flight", async () => {
			const fetchInterval = 5_000;
			mockedConfig = { ...defaultConfig, fetchInterval };

			let resolvePoll!: (value: { battery_level: number; user_description: string }[]) => void;
			vi.mocked(getBatteryInfo).mockImplementation(
				() => new Promise((resolve) => { resolvePoll = resolve; }),
			);

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "kbd-1",
						name: "MockBoard One",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 87, user_description: "Central" }],
					},
				]);
			});

			// Let the initial poll cycle finish so the reload owns the guard
			await act(async () => {
				resolvePoll([{ battery_level: 90, user_description: "Central" }]);
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(1);

			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Reload" }));
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(2);

			// Interval fires while the reload is still pending: no extra fetch
			await act(async () => {
				vi.advanceTimersByTime(fetchInterval);
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(2);

			await act(async () => {
				resolvePoll([{ battery_level: 91, user_description: "Central" }]);
			});

			await act(async () => {
				vi.advanceTimersByTime(fetchInterval);
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(3);
		});

		it("reports a manual refresh failure without retrying a timed out read", async () => {
			const fetchInterval = 5_000;
			mockedConfig = { ...defaultConfig, fetchInterval };
			vi.mocked(getBatteryInfo)
				.mockResolvedValueOnce([{ battery_level: 94, user_description: "Central" }])
				.mockRejectedValue(
					new Error("Battery read timed out after 20 seconds for device kbd-1"),
				);

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "kbd-1",
						name: "MockBoard One",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 100, user_description: "Central" }],
					},
				]);
				await Promise.resolve();
			});

			expect(getBatteryInfo).toHaveBeenCalledTimes(1);
			expect(screen.getByText("94%")).toBeTruthy();

			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Reload" }));
				await Promise.resolve();
			});

			expect(getBatteryInfo).toHaveBeenCalledTimes(2);
			expect(screen.getByRole("alert").textContent).toContain(
				"Battery refresh failed. Check the device connection and try again.",
			);

			await act(async () => {
				vi.advanceTimersByTime(1_000);
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(2);
		});

		it("leaves the loading screen when the BLE invoke never settles", async () => {
			const fetchInterval = 60_000;
			mockedConfig = { ...defaultConfig, fetchInterval };
			vi.mocked(getBatteryInfo)
				.mockResolvedValueOnce([{ battery_level: 94, user_description: "Central" }])
				.mockImplementationOnce(() => new Promise(() => {}))
				.mockResolvedValue([{ battery_level: 92, user_description: "Central" }]);

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "kbd-1",
						name: "MockBoard One",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 100, user_description: "Central" }],
					},
				]);
				await Promise.resolve();
			});

			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "Reload" }));
			});
			expect(screen.getByText("Fetching battery info...")).toBeTruthy();
			await act(async () => {
				await Promise.resolve();
			});
			expect(getBatteryInfo).toHaveBeenCalledTimes(2);

			act(() => {
				vi.advanceTimersByTime(22_000);
			});
			await act(async () => {
				for (let index = 0; index < 10; index += 1) {
					await Promise.resolve();
				}
			});

			expect(screen.queryByText("Fetching battery info...")).toBeNull();
			expect(screen.getByRole("alert").textContent).toContain(
				"Battery refresh failed. Check the device connection and try again.",
			);

			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Reload" }));
				for (let index = 0; index < 3; index += 1) {
					await Promise.resolve();
				}
			});

			expect(getBatteryInfo).toHaveBeenCalledTimes(3);
			expect(screen.getByText("92%")).toBeTruthy();
		});

		it("does not cause unhandled rejection when getBatteryInfo and sendNotification both reject", async () => {
			const fetchInterval = 5_000;
			mockedConfig = {
				...defaultConfig,
				fetchInterval,
				pushNotification: true,
				pushNotificationWhen: {
					...defaultConfig.pushNotificationWhen,
					[NotificationType.Disconnected]: true,
					[NotificationType.LowBattery]: true,
				},
			};

			vi.mocked(getBatteryInfo).mockRejectedValue(new Error("BLE error"));
			vi.mocked(sendNotification).mockRejectedValue(new Error("Notification error"));

			await act(async () => {
				render(<App />);
			});

			await act(async () => {
				resolveDeviceStoreGets([
					{
						id: "kbd-1",
						name: "MockBoard One",
						isDisconnected: false,
						isCollapsed: false,
						batteryInfos: [{ battery_level: 87, user_description: "Central" }],
					},
				]);
			});

			// Advance through retry sleeps (3 attempts × 500ms)
			for (let i = 0; i < 3; i++) {
				await act(async () => {
					vi.advanceTimersByTime(500);
				});
			}

			await act(async () => {
				await Promise.resolve();
			});

			expect(screen.getByLabelText("Disconnected")).toBeTruthy();
		});
	});
});
