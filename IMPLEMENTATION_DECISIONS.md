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

## Render the Windows icon without a graphics dependency

**Context:** The tray icon is a small set of axis-aligned battery shapes at known pixel sizes.

**Risk:** A general-purpose graphics dependency would increase binary size and maintenance surface for a renderer that only needs rectangles and RGBA pixels.

**Decision:** Build the transparent RGBA buffer directly with bounded rectangle helpers, then pass it to Tauri as an owned image. Do not write temporary PNG or ICO files.

**Consequence:** Rendering stays deterministic, lightweight, and independently unit-testable.

**Verification:** Rust tests cover buffer dimensions, alpha, row order, progress widths, status colors, and the three-slot limit at 16, 20, 24, and 32 px.

## Derive the icon size from the tray rectangle

**Context:** Windows tray icon pixels vary with taskbar DPI and Tauri exposes the current tray rectangle.

**Risk:** Always rendering 32 px can produce poor scaling, while a missing or transient zero rectangle can create an invalid image.

**Decision:** Use the smaller physical tray rectangle dimension, clamped to 16–32 px, and fall back to 32 px when the rectangle is missing, invalid, or cannot be read. Tauri currently returns a physical `Size`; a defensive logical-size branch treats rounded logical dimensions as a pixel hint because the tray API exposes no scale factor alongside that variant.

**Consequence:** The icon follows common 16/20/24/32 px Windows taskbar sizes without introducing a separate DPI API.

**Verification:** Pure helper tests cover minimum, maximum, rectangular, zero, and missing dimensions.

## Use the Windows foreground color for outlines

**Context:** A fixed dark or light battery outline disappears on one of the Windows taskbar themes.

**Risk:** An unreadable outline makes empty and partially filled batteries ambiguous.

**Decision:** Read `UIColorType::Foreground` through the existing `UISettings` dependency and pass it into the pure renderer. Use slate gray `#64748B` if Windows does not provide the color; disconnected and unknown states remain the specified `#94A3B8`.

**Consequence:** Connected battery outlines track light and dark system themes while the rasterizer remains platform-independent.

**Verification:** Unit tests inject the neutral outline and validate rendering independently of Windows runtime state.

## Defer native tray visual automation

**Context:** Pixel-perfect verification inside the real Windows notification area requires taskbar automation across themes and multiple DPI configurations.

**Risk:** Building and maintaining that automation is estimated to cost more than twice the renderer itself and would still be sensitive to Windows shell variations.

**Decision:** Keep raster behavior automated and defer native tray appearance to manual end-to-end verification.

**Consequence:** Before release, manually verify one, two, and three batteries; 19/20/50/51 color boundaries; disconnected and unknown states; 100%, 125%, 150%, and 200% scaling; light and dark taskbars; and restoration of the application icon when no devices are configured.

**Verification:** The manual checklist above is required after the complete Windows tray path is built.

## Publish an unsigned portable Windows test build

**Context:** The fork needs a one-off Windows executable for testers, but it has no trusted Authenticode certificate, hardware-backed key, or external code-signing service configured as a GitHub Actions secret.

**Risk:** Self-signing would still trigger Windows trust warnings, would not establish a trusted publisher identity, and could mislead testers into treating an untrusted certificate as meaningful authentication. Storing an exportable signing key without an established certificate-management process would also create unnecessary secret-management risk.

**Decision:** Do not Authenticode-sign this test executable and reject self-signing. Publish its SHA-256 checksum and GitHub Sigstore-backed build provenance so testers can verify artifact integrity and its relationship to the repository workflow. Describe the executable explicitly as an unsigned test build and warn that Microsoft Defender SmartScreen may appear.

**Consequence:** Windows does not display a trusted publisher for this preview executable. Authenticode signing can be added later only after a trusted PFX and protected signing secrets are available, or after the project adopts a trusted external code-signing service.

**Verification:** The release workflow attests the staged portable executable, generates `SHA256SUMS.txt` for the executable and screenshot, and publishes both verification mechanisms with the prerelease.

## Embed license data in the portable executable

**Context:** Bundled installers copy generated license JSON files as application resources, but a `tauri build --no-bundle` release distributes only one executable. The About window still needs the same dependency and manual attribution data.

**Risk:** Requiring undocumented JSON sidecars would make the advertised single-file build incomplete. Always requiring generated JSON at compile time would instead break normal development and test builds where those ignored files are absent.

**Decision:** The build script enables an `embedded_licenses` configuration only when generated JavaScript, generated Cargo, and tracked manual license JSON files all exist. Under that configuration, the executable includes their contents at compile time. Runtime loading continues to prefer external resource or development files and uses the embedded data only when external files are unavailable.

**Consequence:** The release workflow generates licenses before compiling, so its portable EXE has a self-contained About license list. Ordinary builds without generated license files still compile and return the existing descriptive missing-data error when neither external nor embedded data is available.

**Verification:** Rust tests cover generated parsing, manual entry merging, generated parse errors, optional malformed manual data, and both compile-time configuration paths. Release validation must also confirm the known manual license marker is present in the built EXE. Opening About from a directory without adjacent license JSON files remains a manual check because automating the native tray menu and webview for this one-off release would cost more than twice the fallback implementation.
