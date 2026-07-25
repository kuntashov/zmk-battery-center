# Implementation Decisions

## Separate tray color thresholds

**Context:** Windows tray battery colors need low and high boundaries, while the application already has thresholds for notification delivery.

**Risk:** Reusing notification thresholds would make unrelated settings affect each other and could unexpectedly change tray colors when notification behavior is adjusted.

**Decision:** Store independent `trayColorLowThreshold` and `trayColorHighThreshold` values with defaults of 20 and 50. Normalize both to integer values from 1 through 99 and restore the complete pair to defaults when either value is non-finite or `low >= high`.

**Consequence:** Existing configurations gain the defaults during loading without a file migration. Notification thresholds remain unchanged and independent.

**Verification:** Unit tests cover loading an older configuration, clamping out-of-range values, invalid ordering, and preserving notification threshold values.

## Preserve macOS tray behavior

**Context:** macOS already has configurable tray icon components and a native renderer.

**Risk:** Sharing the new Windows settings UI or changing existing component settings could alter established macOS behavior.

**Decision:** Keep the macOS tray component group and its configuration unchanged. Show the new tray color threshold group only when the runtime platform is Windows.

**Consequence:** macOS users retain the existing controls and behavior, while Windows users receive only the controls relevant to the new renderer.

**Verification:** A component test checks Windows visibility and confirms that the existing macOS group remains visible only on macOS.

## Windows-only implementation scope

**Context:** The requested initial implementation targets Windows, while Linux uses a separate system tray integration.

**Risk:** Extending shared or Linux tray behavior in the same change would increase platform-specific regression risk and verification cost.

**Decision:** Limit the new color-threshold UI and forthcoming multi-battery rendering to Windows. Do not change Linux tray behavior.

**Consequence:** Linux remains outside this feature's scope and requires a separate implementation if support is requested later.

**Verification:** Platform-gated UI tests cover Windows and macOS; Windows tray rendering will be verified by focused unit tests and manual Windows end-to-end checks.
