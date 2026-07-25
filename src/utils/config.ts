import { load, type Store, getStorePath } from '@/utils/storage';
import { Theme } from '@/context/theme-provider';
import { enable as enableAutostart, isEnabled as isAutostartEnabled, disable as disableAutostart } from '@tauri-apps/plugin-autostart';
import { requestNotificationPermission } from './notification';
import { logger } from './log';

export enum NotificationType {
	LowBattery = 'low_battery',
	HighBattery = 'high_battery',
	Disconnected = 'disconnected',
	Connected = 'connected',
}

export const MIN_BATTERY_THRESHOLD = 1;
export const MAX_BATTERY_THRESHOLD = 99;

export enum TrayIconComponent {
	AppIcon = 'appIcon',
	RoleLabel = 'roleLabel',
	BatteryIcon = 'batteryIcon',
	BatteryPercent = 'batteryPercent',
}

export const FETCH_INTERVAL_AUTO = 'auto' as const;
export type FetchInterval = number | typeof FETCH_INTERVAL_AUTO;

export type Config = {
	theme: Theme;
	fetchInterval: FetchInterval;
	autoStart: boolean;
	autoCollapseDisconnectedDevices: boolean;
	pushNotification: boolean;
	pushNotificationWhen: Record<NotificationType, boolean>;
	lowBatteryThreshold: number;
	highBatteryThreshold: number;
	trayColorLowThreshold: number;
	trayColorHighThreshold: number;
	manualWindowPositioning: boolean;
	windowPosition: {
		x: number;
		y: number;
	};
	chartRangeMs: number;
	chartSmoothingWindowSize: number;
	chartCustomRange: { start: string; end: string } | null;
	trayIconComponents: TrayIconComponent[];
}

export const defaultConfig: Config = {
	theme: 'dark' as Theme,
	fetchInterval: 60_000,
	autoStart: false,
	autoCollapseDisconnectedDevices: false,
	pushNotification: false,
	pushNotificationWhen: {
		[NotificationType.LowBattery]: true,
		[NotificationType.HighBattery]: true,
		[NotificationType.Connected]: true,
		[NotificationType.Disconnected]: true,
	},
	lowBatteryThreshold: 20,
	highBatteryThreshold: 80,
	trayColorLowThreshold: 20,
	trayColorHighThreshold: 50,
	manualWindowPositioning: false,
	windowPosition: {
		x: 0,
		y: 0,
	},
	chartRangeMs: 0, // default: "All"
	chartSmoothingWindowSize: 30 * 60 * 1000, // 30 minutes in ms
	chartCustomRange: null,
	trayIconComponents: [
		TrayIconComponent.RoleLabel,
		TrayIconComponent.BatteryIcon,
		TrayIconComponent.BatteryPercent,
	],
};

let configStoreInstance: Store | null = null;

async function getConfigStore() {
	if (!configStoreInstance) {
		const storePath = await getStorePath('config.json');
		configStoreInstance = await load(storePath, { autoSave: true, defaults: {} });
	}
	return configStoreInstance;
}

interface ClampBatteryThresholdBounds {
	min?: number;
	max?: number;
}

export function clampBatteryThreshold(
	value: number,
	fallback: number,
	bounds: ClampBatteryThresholdBounds = {},
): number {
	if (!Number.isFinite(value)) return fallback;
	const min = bounds.min ?? MIN_BATTERY_THRESHOLD;
	const max = bounds.max ?? MAX_BATTERY_THRESHOLD;
	const rounded = Math.round(value);
	if (rounded < min) return min;
	if (rounded > max) return max;
	return rounded;
}

function normalizeBatteryThresholds(
	low: number,
	high: number,
	defaultLow: number,
	defaultHigh: number,
) {
	const candidateLow = clampBatteryThreshold(low, defaultLow, {
		max: MAX_BATTERY_THRESHOLD - 1,
	});
	const candidateHigh = clampBatteryThreshold(high, defaultHigh);
	if (candidateLow >= candidateHigh) {
		return { low: defaultLow, high: defaultHigh };
	}
	return { low: candidateLow, high: candidateHigh };
}

function normalizeTrayColorThresholds(low: number, high: number) {
	const fallback = {
		low: defaultConfig.trayColorLowThreshold,
		high: defaultConfig.trayColorHighThreshold,
	};
	if (!Number.isFinite(low) || !Number.isFinite(high)) {
		return fallback;
	}
	const candidateLow = clampBatteryThreshold(low, fallback.low);
	const candidateHigh = clampBatteryThreshold(high, fallback.high);
	if (candidateLow >= candidateHigh) {
		return fallback;
	}
	return { low: candidateLow, high: candidateHigh };
}

export async function loadSavedConfig(): Promise<Config> {
	const config = await getConfigStore().then((store: Store) => store.get<Partial<Config>>('config'));
	logger.info(`Loaded config: ${JSON.stringify(config, null, 4)}`);
	const merged: Config = {
		...defaultConfig,
		...config,
		pushNotificationWhen: {
			...defaultConfig.pushNotificationWhen,
			...(config?.pushNotificationWhen ?? {}),
		},
		windowPosition: {
			...defaultConfig.windowPosition,
			...(config?.windowPosition ?? {}),
		},
	};
	const notificationThresholds = normalizeBatteryThresholds(
		merged.lowBatteryThreshold,
		merged.highBatteryThreshold,
		defaultConfig.lowBatteryThreshold,
		defaultConfig.highBatteryThreshold,
	);
	const trayColorThresholds = normalizeTrayColorThresholds(
		merged.trayColorLowThreshold,
		merged.trayColorHighThreshold,
	);
	return {
		...merged,
		lowBatteryThreshold: notificationThresholds.low,
		highBatteryThreshold: notificationThresholds.high,
		trayColorLowThreshold: trayColorThresholds.low,
		trayColorHighThreshold: trayColorThresholds.high,
	};
};

export async function setConfig(config: Config) {
	const [, isEnabled] = await Promise.all([
		getConfigStore().then((store: Store) => store.set('config', config)),
		isAutostartEnabled(),
	]);

	// Set/Unset autostart
	if (config.autoStart && !isEnabled) {
		await enableAutostart();
	} else if (!config.autoStart && isEnabled) {
		await disableAutostart();
	}

	// Set/Unset notification permission
	if (config.pushNotification) {
		const isGranted = await requestNotificationPermission();
		if(isGranted){
			logger.info('Notification permission granted');
		} else {
			logger.warn('Notification permission not granted');
		}
	}

	logger.info(`Set config: ${JSON.stringify(config, null, 4)}`);
};
