import { useEffect, useCallback, useRef } from "react";
import { getBatteryInfo } from "@/utils/ble";
import { logger } from "@/utils/log";
import { fireAndForget, sleep, withTimeout } from "@/utils/common";
import { recordBatteryReadings } from "@/utils/batteryHistory";
import { sendNotification } from "@/utils/notification";
import { NotificationType } from "@/utils/config";
import { notifyBatteryEdgeTransitions } from "@/utils/batteryEdgeNotification";
import {
	mergeBatteryInfos,
	getRegisteredDeviceDisplayName,
	type RegisteredDevice,
} from "@/utils/appHelpers";
import { collapseIfDisconnected, expandIfConnected } from "@/hooks/useRegisteredDevices";

interface UseBatteryPollingOptions {
	isPollingMode: boolean;
	isConfigLoaded: boolean;
	isDeviceLoaded: boolean;
	fetchInterval: number | "auto";
	registeredDevicesRef: React.RefObject<RegisteredDevice[]>;
	commitRegisteredDevices: (recipe: (current: RegisteredDevice[]) => RegisteredDevice[]) => void;
	pushNotification: boolean;
	pushNotificationWhen: Record<NotificationType, boolean>;
	lowBatteryThreshold: number;
	highBatteryThreshold: number;
	autoCollapseDisconnectedDevices: boolean;
}

const BATTERY_INVOKE_TIMEOUT_MS = 22_000;

export function useBatteryPolling({
	isPollingMode,
	isConfigLoaded,
	isDeviceLoaded,
	fetchInterval,
	registeredDevicesRef,
	commitRegisteredDevices,
	pushNotification,
	pushNotificationWhen,
	lowBatteryThreshold,
	highBatteryThreshold,
	autoCollapseDisconnectedDevices,
}: UseBatteryPollingOptions) {
	const pushNotificationRef = useRef(pushNotification);
	const pushNotificationWhenRef = useRef(pushNotificationWhen);
	const lowBatteryThresholdRef = useRef(lowBatteryThreshold);
	const highBatteryThresholdRef = useRef(highBatteryThreshold);
	const autoCollapseDisconnectedDevicesRef = useRef(autoCollapseDisconnectedDevices);
	// All polling reads share one Bluetooth adapter. Keep a per-device map for
	// deduplication and a global queue so connect/read/disconnect sessions never
	// overlap across devices.
	const activeDeviceUpdatesRef = useRef<Map<string, Promise<boolean>>>(new Map());
	const batteryUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
	useEffect(() => {
		pushNotificationRef.current = pushNotification;
		pushNotificationWhenRef.current = pushNotificationWhen;
		lowBatteryThresholdRef.current = lowBatteryThreshold;
		highBatteryThresholdRef.current = highBatteryThreshold;
		autoCollapseDisconnectedDevicesRef.current = autoCollapseDisconnectedDevices;
	}, [pushNotification, pushNotificationWhen, lowBatteryThreshold, highBatteryThreshold, autoCollapseDisconnectedDevices]);

	const updateBatteryInfo = useCallback(async (device: RegisteredDevice): Promise<boolean> => {
		const isDisconnectedPrev = device.isDisconnected;

		let attempts = 0;
		const maxAttempts = isDisconnectedPrev ? 1 : 3;

		while (attempts < maxAttempts) {
			logger.info(`Updating battery info for: ${device.id} (attempt ${attempts + 1} of ${maxAttempts})`);
			try {
				const info = await withTimeout(
					getBatteryInfo(device.id),
					BATTERY_INVOKE_TIMEOUT_MS,
					() => new Error(`Battery read timed out for device ${device.id}`),
				);
				const infoArray = Array.isArray(info) ? info : [info];
				commitRegisteredDevices(prev => prev.map(d => {
					if (d.id !== device.id) return d;
					return expandIfConnected(
						{ ...d, batteryInfos: mergeBatteryInfos(d.batteryInfos, infoArray), isDisconnected: false },
						autoCollapseDisconnectedDevicesRef.current,
					);
				}));

				recordBatteryReadings(device, infoArray);

				if(isDisconnectedPrev && pushNotificationRef.current && pushNotificationWhenRef.current[NotificationType.Connected]){
					await sendNotification(`${getRegisteredDeviceDisplayName(device)} has been connected.`);
				}

				notifyBatteryEdgeTransitions({
					deviceDisplayName: getRegisteredDeviceDisplayName(device),
					deviceId: device.id,
					prevBatteryInfos: device.batteryInfos,
					newBatteryInfos: infoArray,
					lowBatteryThreshold: lowBatteryThresholdRef.current,
					highBatteryThreshold: highBatteryThresholdRef.current,
					pushNotification: pushNotificationRef.current,
					pushNotificationWhen: pushNotificationWhenRef.current,
				});

				return true;
			} catch (error) {
				const attemptNumber = attempts + 1;
				const isTimeout = String(error).includes("Battery read timed out");
				attempts = isTimeout ? maxAttempts : attemptNumber;
				logger.warn(
					`Failed to update battery info for ${device.id} `
					+ `(attempt ${attemptNumber} of ${maxAttempts}): ${String(error)}`,
				);
				if (attempts >= maxAttempts) {
					commitRegisteredDevices(prev => prev.map(d => {
						if (d.id !== device.id) {
							return d;
						}
						return collapseIfDisconnected(
							{ ...d, isDisconnected: true },
							autoCollapseDisconnectedDevicesRef.current,
						);
					}));

					if(!isDisconnectedPrev && pushNotificationRef.current && pushNotificationWhenRef.current[NotificationType.Disconnected]){
						fireAndForget(
							sendNotification(`${getRegisteredDeviceDisplayName(device)} has been disconnected.`),
							`Failed to send disconnected notification for ${device.id}`,
						);
					}
					return false;
				}
				await sleep(500);
			}
		}
		return false;
	}, [commitRegisteredDevices]);

	const runDeviceUpdate = useCallback((device: RegisteredDevice): Promise<boolean> => {
		const activeUpdates = activeDeviceUpdatesRef.current;
		const activeUpdate = activeUpdates.get(device.id);
		if (activeUpdate) {
			return activeUpdate;
		}

		let update: Promise<boolean>;
		const queuedUpdate = batteryUpdateQueueRef.current.then(
			() => updateBatteryInfo(device),
		);
		batteryUpdateQueueRef.current = queuedUpdate.then(
			() => undefined,
			() => undefined,
		);
		update = queuedUpdate
			.finally(() => {
				if (activeUpdates.get(device.id) === update) {
					activeUpdates.delete(device.id);
				}
			});
		activeUpdates.set(device.id, update);
		return update;
	}, [updateBatteryInfo]);

	const runBatteryCycle = useCallback(async (): Promise<boolean> => {
		const results = await Promise.all(
			registeredDevicesRef.current.map(runDeviceUpdate),
		);
		return results.every(Boolean);
	}, [registeredDevicesRef, runDeviceUpdate]);

	// Polling: use registeredDevicesRef so this effect doesn't re-run on every
	// device update (which would cause an infinite loop).
	useEffect(() => {
		if (!isPollingMode || !isConfigLoaded || !isDeviceLoaded) {
			return;
		}

		let isUnmounted = false;

		const runPollCycle = () => {
			if (isUnmounted) return;
			fireAndForget(
				runBatteryCycle(),
				"Polling cycle failed",
			);
		};

		runPollCycle();

		const interval = setInterval(runPollCycle, fetchInterval as number);

		return () => {
			isUnmounted = true;
			clearInterval(interval);
		};
	}, [isPollingMode, isConfigLoaded, isDeviceLoaded, fetchInterval, runBatteryCycle]);

	const reloadAll = useCallback(async () => {
		const results = await Promise.all(
			registeredDevicesRef.current.map(async (device) => {
				const activeUpdate = activeDeviceUpdatesRef.current.get(device.id);
				if (activeUpdate) {
					const didUpdate = await activeUpdate;
					if (didUpdate) {
						return true;
					}
				}

				const latestDevice = registeredDevicesRef.current.find(
					current => current.id === device.id,
				);
				if (!latestDevice) {
					return false;
				}
				return await runDeviceUpdate(latestDevice);
			}),
		);
		return results.every(Boolean);
	}, [registeredDevicesRef, runDeviceUpdate]);

	return { updateBatteryInfo, reloadAll, autoCollapseDisconnectedDevicesRef };
}
