# Friction Log

Problems hit while building with Amazon developer tools and AWS services.
Each entry is written at the moment it happens.

Severity: Critical (blocked) / High (big detour) / Medium (slowed down) / Low (annoyance)

<!-- Copy this template for each entry:

## N. <short title>

- **Tool / SDK / version:**
- **Task attempted:**
- **Steps taken:**
  1.
- **Expected:**
- **Actual:** (exact error text)
- **Severity:**
- **Workaround:**
- **Suggestion:**
-->

## 1. `vega run-app` installs the app on VVD but fails to launch it

- **Tool / SDK / version:** Vega CLI 1.4.5, Vega SDK 0.24.12112, Vega Virtual Device (aarch64), macOS 26 on Apple Silicon
- **Task attempted:** Run `AmazonAppDev/react-native-multi-tv-app-sample` on the Vega Virtual Device for the first time.
- **Steps taken:**
  1. `yarn build:vega` (succeeded, produced `apps/vega/build/aarch64-release/vega_aarch64.vpkg`)
  2. `vega virtual-device start` (first run: "cannot find virtual device instance: default_instance", then it created an instance and booted)
  3. `vega run-app apps/vega/build/aarch64-release/vega_aarch64.vpkg`
- **Expected:** The app is installed and launched on the virtual device.
- **Actual:** `Installed apps/vega/build/aarch64-release/vega_aarch64.vpkg on ` (empty device name), then
  `Vega operation FAILED due to an irrecoverable error: Failed to launch the app: Incomplete: Cannot read properties of undefined (reading 'trim')`
- **Severity:** Medium
- **Workaround:** `vega device installed-apps` to find the component id, then `vega device launch-app --appName com.giolaq.multitv.vega.main`. The app runs (`vega device running-apps` lists it).
- **Suggestion:** `run-app` seems to read the device name or app id from a value that is undefined when the vpkg path is passed directly. Fill in the device serial from `vega device list` (as `launch-app` does), and print which value was missing instead of a JavaScript `TypeError` message.
