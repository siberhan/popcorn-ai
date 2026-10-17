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

## 2. AWS MCP server times out on the first start after `aws configure agent-toolkit`

- **Tool / SDK / version:** Agent Toolkit for AWS (`aws configure agent-toolkit`, AWS CLI 2.38.1), `mcp-proxy-for-aws@latest` via `uvx` (uv 0.12.5), Claude Code
- **Task attempted:** Use the AWS MCP server in Claude Code right after the toolkit setup.
- **Steps taken:**
  1. `aws configure agent-toolkit --yes --region us-east-1 --profile popcorn` (it wrote an `aws-mcp` entry: `uvx mcp-proxy-for-aws@latest https://aws-mcp.us-east-1.api.aws/mcp ...`)
  2. Added `AWS_MCP_PROXY_PROFILES=popcorn` as the setup guide says, restarted Claude Code.
- **Expected:** The `aws-mcp` tools are available in the new session.
- **Actual:** `MCP server aws-mcp connection timed out after 30000ms`. Running `uvx mcp-proxy-for-aws@latest --help` by hand took 2 min 18 s the first time, because `uvx` downloads the proxy and its dependencies on first use.
- **Severity:** Medium
- **Workaround:** Run `uvx mcp-proxy-for-aws@latest --help` once before starting the AI tool, so the package is cached. Then restart the tool.
- **Suggestion:** Have `aws configure agent-toolkit` pre-install the proxy (for example `uv tool install mcp-proxy-for-aws`) and point the config at the installed binary, or at least warm the `uvx` cache and tell the user. Pinning a version instead of `@latest` would also avoid a network check on every start.

## 3. boto3 cannot use `aws login` credentials without an extra package

- **Tool / SDK / version:** boto3 / botocore 1.43.114 (Python 3.14), AWS CLI 2.38.1 (`aws login`)
- **Task attempted:** Call AWS from local Python code with the `popcorn` profile, which was set up with `aws login --profile popcorn` (the sign-in method the new AWS experience recommends).
- **Steps taken:**
  1. `aws login --profile popcorn` (the CLI works: `aws sts get-caller-identity --profile popcorn` succeeds)
  2. `boto3.Session(profile_name="popcorn").client("sts").get_caller_identity()`
- **Expected:** boto3 uses the same login session as the CLI.
- **Actual:** `botocore.exceptions.MissingDependencyException: Missing Dependency: Using the login credential provider requires an additional dependency. You will need to pip install "botocore[crt]" before proceeding.`
- **Severity:** Low
- **Workaround:** Add `botocore[crt]` as a dev dependency. It is only needed locally; Lambda uses its execution role.
- **Suggestion:** Mention `botocore[crt]` in the `aws login` docs and in the new-experience onboarding for SDK users, or make the login provider work without CRT.
