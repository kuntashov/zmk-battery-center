## Windows tray battery preview

This test build adds a compact Windows notification-area indicator for up to three ZMK battery channels:

- One, two, or three battery shapes are shown in the same order as the configured devices and their battery channels.
- Each battery uses a progress fill to represent its reported charge level.
- The default color thresholds are red below 20%, yellow from 20% through 50% inclusive, and green above 50%.
- Separate low and high tray color thresholds can be configured. Values below the low threshold are red, values from the low threshold through the high threshold inclusive are yellow, and values above the high threshold are green.
- Disconnected devices and channels with an unknown charge level are shown in gray.
- Updates follow the existing ZMK Battery Center refresh cadence; this build does not introduce a separate polling loop.
- The feature is Windows-only. Existing macOS and Linux tray behavior is unchanged.
- An additional transparent pixel separates adjacent battery shapes for better readability, especially when all three have the same color.

![Windows notification area showing three green battery indicators](https://github.com/{{REPOSITORY}}/releases/download/{{TAG}}/windows-tray-three-devices.png)

*Windows notification area with zmk-battery-center showing three green battery indicators.*

## Download and verification

Download `zmk-battery-center_0.10.1_windows_x64_portable.exe` and run it directly. This is a portable test build; it does not include an installer.

This executable is not Authenticode-signed. Windows may display a Microsoft Defender SmartScreen warning because the build has no trusted publisher certificate or established reputation. Verify the executable with `SHA256SUMS.txt` and the GitHub Sigstore-backed build provenance published for this workflow run.

Microsoft Edge WebView2 Runtime is required and is already present on most current Windows 10 and Windows 11 installations.
