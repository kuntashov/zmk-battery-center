import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
	syncTrayBatteryIcon,
	trayBatteryPayloadFromPrimaryDevice,
	trayBatterySlotsFromDevices,
} from "../trayBatteryIcon";
import { defaultConfig, TrayIconComponent } from "@/utils/config";
import type { RegisteredDevice } from "@/utils/appHelpers";
import type { BatteryInfo } from "@/utils/ble";

const mockedInvoke = vi.mocked(invoke);

function device(overrides: Partial<RegisteredDevice> = {}): RegisteredDevice {
	return {
		id: "kbd-1",
		name: "MockBoard One",
		batteryInfos: [],
		isDisconnected: false,
		isCollapsed: false,
		...overrides,
	};
}

function info(battery_level: number | null, user_description: string | null): BatteryInfo {
	return { battery_level, user_description };
}

describe("trayBatterySlotsFromDevices", () => {
	it("flattens a split keyboard and trackball in device and battery info order", () => {
		const slots = trayBatterySlotsFromDevices([
			device({
				id: "split",
				batteryInfos: [info(90, "Central"), info(72, "Peripheral")],
			}),
			device({
				id: "trackball",
				batteryInfos: [info(55, "Central")],
			}),
		]);

		expect(slots).toEqual([
			{ percent: 90, disconnected: false },
			{ percent: 72, disconnected: false },
			{ percent: 55, disconnected: false },
		]);
	});

	it("follows top-level device reordering", () => {
		const split = device({
			id: "split",
			batteryInfos: [info(90, "Central"), info(72, "Peripheral")],
		});
		const trackball = device({
			id: "trackball",
			batteryInfos: [info(55, "Central")],
		});

		expect(trayBatterySlotsFromDevices([trackball, split])).toEqual([
			{ percent: 55, disconnected: false },
			{ percent: 90, disconnected: false },
			{ percent: 72, disconnected: false },
		]);
	});

	it("keeps only the first three flattened battery channels", () => {
		const slots = trayBatterySlotsFromDevices([
			device({
				id: "split",
				batteryInfos: [info(90, "Central"), info(72, "Peripheral")],
			}),
			device({
				id: "accessories",
				batteryInfos: [info(55, "Trackball"), info(40, "Touchpad")],
			}),
		]);

		expect(slots).toEqual([
			{ percent: 90, disconnected: false },
			{ percent: 72, disconnected: false },
			{ percent: 55, disconnected: false },
		]);
	});

	it("uses an unknown placeholder for a device with no battery infos", () => {
		const slots = trayBatterySlotsFromDevices([
			device({ id: "pending", isDisconnected: true }),
			device({
				id: "ready",
				batteryInfos: [info(44, "Central")],
			}),
		]);

		expect(slots).toEqual([
			{ percent: null, disconnected: true },
			{ percent: 44, disconnected: false },
		]);
	});

	it("preserves null levels and per-device disconnected state", () => {
		const slots = trayBatterySlotsFromDevices([
			device({
				isDisconnected: true,
				batteryInfos: [info(null, "Central"), info(72, "Peripheral")],
			}),
		]);

		expect(slots).toEqual([
			{ percent: null, disconnected: true },
			{ percent: 72, disconnected: true },
		]);
	});

	it("returns no slots for an empty device list", () => {
		expect(trayBatterySlotsFromDevices([])).toEqual([]);
	});
});

describe("trayBatteryPayloadFromPrimaryDevice", () => {
	it("disables the tray payload for an empty device list", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([]);
		expect(payload.enabled).toBe(false);
		expect(payload.slots).toEqual([]);
		expect(payload.colorLowThreshold).toBe(defaultConfig.trayColorLowThreshold);
		expect(payload.colorHighThreshold).toBe(defaultConfig.trayColorHighThreshold);
		expect(payload.rowCount).toBe(1);
		expect(payload.centralPercent).toBeNull();
		expect(payload.peripheralPercent).toBeNull();
		expect(payload.centralLabel).toBeNull();
		expect(payload.peripheralLabel).toBeNull();
		expect(payload.disconnected).toBe(false);
	});

	it("keeps a disconnected device with no infos enabled with a default label", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ isDisconnected: true }),
		]);
		expect(payload.enabled).toBe(true);
		expect(payload.centralPercent).toBeNull();
		expect(payload.disconnected).toBe(true);
		expect(payload.centralLabel).toBe("C");
	});

	it("uses the custom Central label for a device with no infos", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ batteryPartLabels: { Central: "left" } }),
		]);
		expect(payload.centralLabel).toBe("L");
	});

	it("maps a single info without description to one row labeled C", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ batteryInfos: [info(85, null)] }),
		]);
		expect(payload.rowCount).toBe(1);
		expect(payload.centralPercent).toBe(85);
		expect(payload.centralLabel).toBe("C");
		expect(payload.peripheralPercent).toBeNull();
	});

	it("uppercases a single-character description", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ batteryInfos: [info(85, "x")] }),
		]);
		expect(payload.centralLabel).toBe("X");
	});

	it("maps two Central/Peripheral infos to two rows labeled C and P", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ batteryInfos: [info(90, "Central"), info(72, "Peripheral")] }),
		]);
		expect(payload.rowCount).toBe(2);
		expect(payload.centralPercent).toBe(90);
		expect(payload.peripheralPercent).toBe(72);
		expect(payload.centralLabel).toBe("C");
		expect(payload.peripheralLabel).toBe("P");
	});

	it("uses first-char labels for non-special descriptions", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ batteryInfos: [info(90, "left"), info(72, "right")] }),
		]);
		expect(payload.centralLabel).toBe("L");
		expect(payload.peripheralLabel).toBe("R");
	});

	it("prefers custom labels over descriptions", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({
				batteryInfos: [info(90, "Central"), info(72, "Peripheral")],
				batteryPartLabels: { Central: "aa", Peripheral: "bb" },
			}),
		]);
		expect(payload.centralLabel).toBe("A");
		expect(payload.peripheralLabel).toBe("B");
	});

	it("keeps a null battery level as a null percent", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ batteryInfos: [info(null, "Central"), info(72, "Peripheral")] }),
		]);
		expect(payload.centralPercent).toBeNull();
		expect(payload.peripheralPercent).toBe(72);
	});

	it("renders only the first device in the list", () => {
		const payload = trayBatteryPayloadFromPrimaryDevice([
			device({ batteryInfos: [info(90, "Central")] }),
			device({ id: "kbd-2", batteryInfos: [info(10, "Central")] }),
		]);
		expect(payload.centralPercent).toBe(90);
	});
});

describe("syncTrayBatteryIcon", () => {
	beforeEach(() => {
		mockedInvoke.mockReset();
		mockedInvoke.mockResolvedValue(undefined);
	});

	it("forwards the payload with the given components", async () => {
		await syncTrayBatteryIcon(
			[device({ batteryInfos: [info(85, null)] })],
			[TrayIconComponent.BatteryPercent],
			25,
			60,
		);

		expect(invoke).toHaveBeenCalledWith("update_tray_battery_icon", {
			payload: expect.objectContaining({
				enabled: true,
				centralPercent: 85,
				slots: [{ percent: 85, disconnected: false }],
				colorLowThreshold: 25,
				colorHighThreshold: 60,
				components: [TrayIconComponent.BatteryPercent],
			}),
		});
	});

	it("falls back to the first default component when components is empty", async () => {
		await syncTrayBatteryIcon([device()], []);

		expect(invoke).toHaveBeenCalledWith("update_tray_battery_icon", {
			payload: expect.objectContaining({
				components: [defaultConfig.trayIconComponents[0]],
				colorLowThreshold: defaultConfig.trayColorLowThreshold,
				colorHighThreshold: defaultConfig.trayColorHighThreshold,
			}),
		});
	});
});
