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

## 7. Amazon buildertools MCP rejects every tool call until `set_project_context` is called

- **Tool / SDK / version:** `@amazon-devices/amazon-devices-buildertools-mcp` v1.0.17 (via `npx -y ...@latest`; the install printed several npm deprecation warnings), used from a coding agent
- **Task attempted:** Search the Vega docs for how `TextInput` and the on-screen keyboard work with D-pad focus.
- **Steps taken:**
  1. Started the MCP server with `npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest`.
  2. Called the documentation search tool.
- **Expected:** Search results.
- **Actual:** Every tool call returned
  `{"error":"PROJECT_CONTEXT_REQUIRED","message":"You must call set_project_context before using any other tool..."}`
  even for a plain doc search that does not need a project.
- **Severity:** Low
- **Workaround:** Call `set_project_context({config:{}})` once first; after that the search works.
- **Suggestion:** Let doc search work without a project context, or set an empty context by default. Mention the required first call in the tool descriptions so an agent sees it before the first failure.

## 8. Vega docs say nothing about `TextInput` together with D-pad focus libraries

- **Tool / SDK / version:** Vega developer docs (searched through buildertools MCP v1.0.17), Vega SDK 0.24.12112, `react-tv-space-navigation`, Vega Virtual Device (aarch64)
- **Task attempted:** A remote-only "add family member" form on the TV: name and age fields inside a `react-tv-space-navigation` focus tree.
- **Steps taken:** Searched the docs for how a focusable wrapper should hand focus to a `TextInput`, and whether TVEventHandler / spatial navigation keeps getting D-pad events while the on-screen keyboard is open.
- **Expected:** Guidance on TextInput focus and the keyboard on TV, for apps that use a spatial navigation library.
- **Actual:** The docs cover `TextInput`, `Keyboard` events and `underlineColorKepler`, but nothing about D-pad focus or spatial navigation while the keyboard is open. We had to find out on the simulator: `.focus()` opens a full-screen keyboard (a number pad for `keyboardType="number-pad"`), the arrows move inside the keyboard, and "Done" fires `onSubmitEditing`.
- **Severity:** Low
- **Workaround:** Lock spatial navigation while a field is being edited and unlock it on submit, blur, `keyboardDidHide` or unmount. This worked on the VVD.
- **Suggestion:** Add a short "Text input with the remote" page: how focus moves from a focusable view to `TextInput`, what the keyboard does with D-pad keys, and which events fire on Done and Back.

## 9. boto3 `update_function_code` with a 26 MB zip fails with "The write operation timed out"; raising `read_timeout` does not help

- **Tool / SDK / version:** boto3 / botocore 1.43.114, urllib3 2.8.0, Python 3.14, Lambda `UpdateFunctionCode` with `ZipFile=` in eu-north-1
- **Task attempted:** Redeploy the MCP server (26.4 MB zip) and the agent (31.1 MB zip) from a home connection with a slow uplink.
- **Steps taken:**
  1. `lam.update_function_code(FunctionName=..., ZipFile=code)` with a default client: fails.
  2. Retried: same failure.
  3. Client with `Config(connect_timeout=30, read_timeout=600)`: same failure.
  4. Client with `Config(connect_timeout=600, read_timeout=600)`: works (both uploads took about 8 minutes).
- **Expected:** A large upload either works or fails with a hint about which timeout to raise; `read_timeout` sounds like the knob for a slow request.
- **Actual:** `TimeoutError: The write operation timed out` -> `urllib3.exceptions.ProtocolError: ('Connection aborted.', ...)` -> `botocore.exceptions.ConnectionClosedError: Connection was closed before we received a valid response from endpoint URL: "https://lambda.eu-north-1.amazonaws.com/2015-03-31/functions/popcorn-mcp/code"`. The socket write during the body upload is bounded by `connect_timeout` (60 s default), which the error text does not say.
- **Severity:** Medium (blocked deploys until found)
- **Workaround:** `Config(connect_timeout=600, read_timeout=600)` on the Lambda client (`infra/deploy.py`).
- **Suggestion:** Document which timeout bounds request-body writes, or add a `write_timeout`; mention it in the `ConnectionClosedError` text. The Lambda docs for `ZipFile` uploads could also point slow connections to the S3 upload path.

## 10. Vega: no documented way to open Prime Video (or any other streaming app) on a title

- **Tool / SDK / version:** Vega developer docs 0.24 (deep links, Content Launcher, Linking), Vega SDK 0.24.12112
- **Task attempted:** "Where to watch" on the film details screen: the family picks Prime Video and the TV opens that film in Prime Video.
- **Steps taken:** Read the deep link page (`Linking.openURL` with a URI the target app declares in a `[[message]]` block) and the Content Launcher guide; searched for Prime Video URI schemes or ASIN links.
- **Expected:** A documented way to launch Amazon's own Prime Video app on a title (ASIN or search), at least for Amazon first-party apps.
- **Actual:** Content Launcher only covers the system launching *our* app. Deep links need the target app's own URI contract, and no Prime Video (or Netflix) URI is documented anywhere we could find.
- **Severity:** Medium (the "where to watch" handoff cannot actually hand off on the device)
- **Workaround:** The TV shows a handoff panel ("Enjoy it on Prime Video, come back when it's over") with a "We're back" button that starts the family rating.
- **Suggestion:** Publish a launch intent for first-party apps (Prime Video by ASIN, Prime Video search) in the Vega deep link docs.

## 11. Strands Agents logs a warning on every multi-tool turn with the OpenAI-compatible model

- **Tool / SDK / version:** Strands Agents 1.61.1, `strands.models.openai.OpenAIModel` pointed at OpenRouter
- **Task attempted:** Multi-turn voice conversations that call several MCP tools per turn.
- **Actual:** Every turn logs `reasoningContent is not supported in multi-turn conversations with the Chat Completions API.` (strands/models/openai.py:409) and drops the reasoning content.
- **Expected:** Reasoning content kept, or dropped once without a warning per message.
- **Severity:** Low (works; noisy CloudWatch logs)
- **Workaround:** None needed.
- **Suggestion:** Log it once per agent, or make it a debug message.

## 12. Vega app crashes at start with "Unknown URL scheme" when a shared package `require`s an image

- **Tool / SDK / version:** Vega SDK 0.24.12112, `@amazon-devices/react-native-kepler` 2.0 (RN 0.72), Metro with `watchFolders` (yarn monorepo from `AmazonAppDev/react-native-multi-tv-app-sample`), Vega Virtual Device (aarch64)
- **Task attempted:** Show a background image (`require('../../assets/images/backdrop-blob.png')`) from the shared UI package that both the web and the Vega app use.
- **Steps taken:**
  1. `yarn build:vega`, `vega device install-app`, `vega device launch-app`: the app closed at once, no JS log lines at all.
  2. `vega device start-log-stream` only showed `Process 'com.popcornai.tv' (PID=...) crashed with signal 6` on `JSThread`.
  3. `vega device get-log-info`, then `vega device copy-logs -a SYSTEM_TOMBSTONE/acr --dir ...`: the `.acr` file had the real error.
- **Expected:** The image loads, as it does on web, or a build-time error.
- **Actual:** `Error: Exception in HostFunction: Unknown URL scheme` at `updateHostContainer` (ReactFabric-prod.js). The bundle registers the asset with `httpServerLocation: "/assets/../../packages/shared-ui/src/assets/images"` (it lives outside the app folder) and the package stores it under `bundle/assets/__packages/...`, which the runtime cannot load.
- **Severity:** High (the app does not start; the error is only in the tombstone, not in the log stream)
- **Workaround:** A `backdropBlob.vega.ts` platform file that `require`s a copy of the image inside `apps/vega/src/assets`.
- **Suggestion:** Support assets from Metro `watchFolders` (the multi-TV sample is a monorepo, so this will hit others), or fail the build with a clear message. Print uncaught JS errors in `start-log-stream`, not only in the ACR.
