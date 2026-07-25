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

## Flatten battery channels in display order

**Context:** A registered device may expose one or more battery channels, and users already control the top-level device order in the application UI.

**Risk:** Sorting or grouping channels independently for the tray could make a battery indicator refer to a different device than the corresponding UI row.

**Decision:** Derive tray slots by traversing registered devices in their saved UI order and each device's `batteryInfos` in its existing order.

**Consequence:** A split keyboard followed by a trackball produces Central, Peripheral, then trackball slots without a separate tray ordering setting.

**Verification:** Unit tests cover split-plus-trackball ordering and top-level device reordering.

## Limit the tray to three stable slots

**Context:** The Windows tray design supports at most three battery indicators, while a registered device may temporarily have no battery information.

**Risk:** Omitting a device before its first reading would shift later slot identities, while rendering every channel would exceed the legible tray layout.

**Decision:** Keep only the first three flattened slots. Represent a top-level device with empty `batteryInfos` as one unknown slot with `percent: null` and that device's disconnected state.

**Consequence:** Slot positions remain stable while data is pending, and channels beyond the first three are intentionally not represented.

**Verification:** Unit tests cover truncation, unknown placeholders, disconnected/null states, and an empty device list.

## Extend the tray payload additively

**Context:** The macOS native tray renderer consumes the existing first-device fields, while the Windows renderer needs ordered slots and color thresholds.

**Risk:** Replacing the payload shape would couple the Windows work to a macOS renderer rewrite and could break older payload producers.

**Decision:** Add `slots`, `colorLowThreshold`, and `colorHighThreshold` alongside all legacy fields. Rust deserialization defaults omitted additions to an empty list and thresholds 20/50.

**Consequence:** macOS continues reading the unchanged legacy fields, and old payloads remain deserializable while Windows can use the new data.

**Verification:** TypeScript tests cover invocation values; Rust tests cover the full new shape, legacy defaults, and numeric deserialization bounds.
