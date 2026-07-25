import { invoke } from "@tauri-apps/api/core";
import type { RegisteredDevice } from "@/utils/appHelpers";
import type { BatteryInfo } from "@/utils/ble";
import { batteryPartLabelStorageKey } from "@/utils/batteryLabels";
import { defaultConfig, type TrayIconComponent } from "@/utils/config";

export type TrayBatterySlot = {
	percent: number | null;
	disconnected: boolean;
};

export type TrayBatteryIconPayload = {
	enabled: boolean;
	slots: TrayBatterySlot[];
	colorLowThreshold: number;
	colorHighThreshold: number;
	components: TrayIconComponent[];
	rowCount: 1 | 2;
	centralPercent: number | null;
	peripheralPercent: number | null;
	centralLabel: string | null;
	peripheralLabel: string | null;
	disconnected: boolean;
};

const MAX_TRAY_BATTERY_SLOTS = 3;

export function trayBatterySlotsFromDevices(devices: RegisteredDevice[]): TrayBatterySlot[] {
	const slots: TrayBatterySlot[] = [];
	for (const device of devices) {
		if (device.batteryInfos.length === 0) {
			slots.push({
				percent: null,
				disconnected: device.isDisconnected,
			});
		} else {
			for (const info of device.batteryInfos) {
				slots.push({
					percent: info.battery_level ?? null,
					disconnected: device.isDisconnected,
				});
				if (slots.length === MAX_TRAY_BATTERY_SLOTS) {
					return slots;
				}
			}
		}
		if (slots.length === MAX_TRAY_BATTERY_SLOTS) {
			return slots;
		}
	}
	return slots;
}

function labelForInfo(info: BatteryInfo | undefined, fallback: "Central" | "Peripheral"): string {
	if (!info?.user_description) {
		return fallback === "Central" ? "C" : "P";
	}
	const raw = info.user_description.trim();
	if (raw.length === 1) return raw.toUpperCase();
	const lower = raw.toLowerCase();
	if (lower === "central") return "C";
	if (lower === "peripheral") return "P";
	return raw.charAt(0).toUpperCase();
}

function trayGlyphFromCustomOrInfo(
	info: BatteryInfo | undefined,
	fallback: "Central" | "Peripheral",
	customLabel: string | undefined,
): string {
	if (customLabel != null && customLabel.trim() !== "") {
		const t = customLabel.trim();
		if (t.length === 1) return t.toUpperCase();
		return t.charAt(0).toUpperCase();
	}
	return labelForInfo(info, fallback);
}

export function trayBatteryPayloadFromPrimaryDevice(
	devices: RegisteredDevice[],
	colorLowThreshold: number = defaultConfig.trayColorLowThreshold,
	colorHighThreshold: number = defaultConfig.trayColorHighThreshold,
): TrayBatteryIconPayload {
	const windowsFields = {
		slots: trayBatterySlotsFromDevices(devices),
		colorLowThreshold,
		colorHighThreshold,
	};
	if (devices.length === 0) {
		return {
			enabled: false,
			...windowsFields,
			components: defaultConfig.trayIconComponents,
			rowCount: 1,
			centralPercent: null,
			peripheralPercent: null,
			centralLabel: null,
			peripheralLabel: null,
			disconnected: false,
		};
	}
	const d = devices[0];
	const infos = d.batteryInfos;
	if (infos.length === 0) {
		return {
			enabled: true,
			...windowsFields,
			components: defaultConfig.trayIconComponents,
			rowCount: 1,
			centralPercent: null,
			peripheralPercent: null,
			centralLabel: trayGlyphFromCustomOrInfo(undefined, "Central", d.batteryPartLabels?.[batteryPartLabelStorageKey(null)]),
			peripheralLabel: null,
			disconnected: d.isDisconnected,
		};
	}
	if (infos.length === 1) {
		const b = infos[0];
		const custom = d.batteryPartLabels?.[batteryPartLabelStorageKey(b.user_description)];
		return {
			enabled: true,
			...windowsFields,
			components: defaultConfig.trayIconComponents,
			rowCount: 1,
			centralPercent: b.battery_level ?? null,
			peripheralPercent: null,
			centralLabel: trayGlyphFromCustomOrInfo(b, "Central", custom),
			peripheralLabel: null,
			disconnected: d.isDisconnected,
		};
	}
	const first = infos[0];
	const second = infos[1];
	return {
		enabled: true,
		...windowsFields,
		components: defaultConfig.trayIconComponents,
		rowCount: 2,
		centralPercent: first.battery_level ?? null,
		peripheralPercent: second.battery_level ?? null,
		centralLabel: trayGlyphFromCustomOrInfo(
			first,
			"Central",
			d.batteryPartLabels?.[batteryPartLabelStorageKey(first.user_description)],
		),
		peripheralLabel: trayGlyphFromCustomOrInfo(
			second,
			"Peripheral",
			d.batteryPartLabels?.[batteryPartLabelStorageKey(second.user_description)],
		),
		disconnected: d.isDisconnected,
	};
}

export async function syncTrayBatteryIcon(
	devices: RegisteredDevice[],
	components: TrayIconComponent[] = defaultConfig.trayIconComponents,
	colorLowThreshold: number = defaultConfig.trayColorLowThreshold,
	colorHighThreshold: number = defaultConfig.trayColorHighThreshold,
): Promise<void> {
	const payload = trayBatteryPayloadFromPrimaryDevice(
		devices,
		colorLowThreshold,
		colorHighThreshold,
	);
	payload.components = components.length > 0 ? components : [defaultConfig.trayIconComponents[0]];
	await invoke("update_tray_battery_icon", { payload });
}
