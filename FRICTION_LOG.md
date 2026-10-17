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

## 4. Amazon Polly has only standard voices in eu-north-1, the only Region a new-experience project can use

- **Tool / SDK / version:** Amazon Polly API (`DescribeVoices`, `SynthesizeSpeech`), AWS CLI 2.38.1, boto3 1.43.114, new AWS experience project fixed to `eu-north-1`
- **Task attempted:** Give the voice assistant a natural neural voice for the demo.
- **Steps taken:**
  1. `aws polly describe-voices --region eu-north-1 --profile popcorn`
  2. `aws polly synthesize-speech --region eu-north-1 --voice-id Matthew --engine neural --output-format mp3 --text "..." out.mp3`
- **Expected:** Neural (or generative) English voices, as in most Regions.
- **Actual:** All 60 voices list `SupportedEngines: ["standard"]`; `DescribeVoices` with `Engine=neural` returns 0 voices. Neural synthesis fails with
  `An error occurred (ValidationException) when calling the SynthesizeSpeech operation: The selected engine is not supported in this region`
- **Severity:** High (the voice is the main output of a voice app; standard voices sound robotic, and a new-experience project cannot call another Region)
- **Workaround:** Use a standard voice (`Brian`, en-GB) with `Engine="standard"`.
- **Suggestion:** The new AWS experience picks the Region from the contact address, so builders in the Nordics get `eu-north-1` without choosing it. Either bring Polly neural voices to `eu-north-1`, or warn during project setup which services have reduced features in the assigned Region (the setup rules already list Rekognition, Textract, Personalize, and App Runner for `eu-north-1`, but not Polly's engines).

## 5. Strands `MCPClient`: the documented `with` block breaks when the client is also passed to `Agent(tools=[...])`

- **Tool / SDK / version:** `strands-agents==1.61.1` (`strands.tools.mcp.MCPClient`), `mcp==2.1.1`
- **Task attempted:** Give a Strands agent the tools of our remote MCP server (Streamable HTTP).
- **Steps taken:**
  1. `mcp_client = MCPClient(url="http://127.0.0.1:8000/mcp")`
  2. `with mcp_client: agent = Agent(model=model, tools=[mcp_client])`
- **Expected:** The agent uses the already open MCP session.
- **Actual:** `__enter__()` calls `start()` but does not set `_tool_provider_started`. `Agent` then calls `MCPClient.load_tools()`, which sees `_tool_provider_started == False` and calls `start()` again:
  `strands.types.exceptions.MCPClientInitializationError: the client session is currently running`
  `ValueError: Failed to load tool <strands.tools.mcp.mcp_client.MCPClient object>: Failed to start MCP client: the client session is currently running`
  (`strands/tools/mcp/mcp_client.py`: `__enter__` line 425, `start` line 442-455, `load_tools` line 551-555)
- **Severity:** Medium
- **Workaround:** Do not use `with`. Pass the client to `Agent(tools=[mcp_client])` and let the agent start it; call `mcp_client.stop(None, None, None)` on shutdown.
- **Suggestion:** Set `_tool_provider_started = True` in `__enter__` (or make `load_tools` check `_is_session_active()`). Also: `strands-agents` 1.61.1 requires `mcp<2.2`, while the current `mcp` release is 2.3.0, so an agent and an MCP server cannot share one virtual environment on the latest MCP SDK.

## 6. No working way to take a screenshot of the Vega Virtual Device from the CLI

- **Tool / SDK / version:** Vega CLI, Vega SDK 0.24.12112, Vega Virtual Device (aarch64), macOS 26 on Apple Silicon
- **Task attempted:** Take a screenshot of our app running on the VVD, to check that the posters load and to keep as proof for the demo.
- **Steps taken:**
  1. `vega device --help`: there is no `screenshot` command (the list has `copy-from`, `run-cmd`, `shell`, logs, apps, ports).
  2. Found `screenshooter` and `gwsi-tool-screenshooter` in the device's `/usr/bin`.
  3. `vega device run-cmd -c 'screenshooter /tmp/pop1.png'`, then `vega device copy-from -s /tmp/pop1.png ...`
  4. `vega device run-cmd -c 'screenshooter -r /tmp/pop2.png; gwsi-tool-screenshooter /tmp/pop3.png'`
- **Expected:** A PNG of the TV screen.
- **Actual:** Step 3 printed nothing and copied a 0-byte file. Step 4 shows the real errors (the command runs as `uid=5000(app_user)`):
  `creating a buffer file for 8294400 B failed: Permission denied`
  `error marshalling arguments for shoot (signature oo): null value passed for arg 1`
  The next `run-cmd` failed with `Error: No running instances of com.amazon.dev.shell.service found`, and `vega device list` said `No devices found` for a short time while the emulator and our app kept running. A minute later the device was back.
- **Severity:** Low
- **Workaround:** Capture the emulator's macOS window instead: find the window id of the `vega-virtual-device` process with `CGWindowListCopyWindowInfo`, then `screencapture -x -o -l <window id> out.png`.
- **Suggestion:** Add `vega device screenshot [--output file.png]` (like `adb exec-out screencap -p`), or let `screenshooter` work for the developer shell user.
