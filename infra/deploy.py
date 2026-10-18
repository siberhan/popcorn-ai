"""Deploy Popcorn AI to AWS Lambda: the MCP server and the agent service, each behind a public Function URL.

Both run their normal HTTP server inside Lambda through the Lambda Web Adapter layer.
The agent URL streams responses (Server-Sent Events for /chat/stream).

  uv run deploy.py deploy [mcp|agent]   build and update both services, or only the named one
  uv run deploy.py deploy --force       upload even when nothing changed
  uv run deploy.py status     print the URLs and check /health
  uv run deploy.py destroy    delete the functions, URLs, roles and log groups (keeps the DynamoDB table)
  uv run deploy.py reset      forget the demo household, for a fresh demo (keeps the TMDB cache)

Caching: the locked dependencies live in a Lambda layer per service (`popcorn-mcp-deps`), published
again only when `uv export` output changes. The function zip holds only our source and the start
script, so a code change uploads a few hundred KB. The function description keeps a hash of code and
settings; when it matches, the function is left alone.

Secrets (TMDB, OpenRouter) are read from the repo's .env and set as Lambda environment variables.
They are never printed.
"""

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

REGION = "eu-north-1"
PROFILE = "popcorn"
TABLE = "popcorn-ai"
HOUSEHOLD = "demo"
LWA_LAYER = f"arn:aws:lambda:{REGION}:753240598075:layer:LambdaAdapterLayerArm64:30"  # LWA 1.1.0
TAGS = {"project": "popcorn-ai"}
LOG_DAYS = 14

ROOT = Path(__file__).resolve().parent.parent
BUILD = Path(__file__).resolve().parent / ".build"

ADAPTER_ENV = {
    "AWS_LAMBDA_EXEC_WRAPPER": "/opt/bootstrap",
    "AWS_LWA_READINESS_CHECK_PATH": "/health",
    "HOST": "0.0.0.0",  # not localhost: the MCP server's DNS-rebinding guard would reject the Function URL host
    "PORT": "8080",
}

session = boto3.Session(profile_name=PROFILE, region_name=REGION)
# Zips are ~30 MB; a slow uplink needs more than the default 60 s per write.
lam = session.client("lambda", config=Config(connect_timeout=600, read_timeout=600, retries={"max_attempts": 2}))
iam = session.client("iam")
logs = session.client("logs")


def read_env() -> dict[str, str]:
    values = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


# ---------- build ----------


def requirements(service_dir: Path) -> str:
    return subprocess.run(
        ["uv", "export", "--frozen", "--no-dev", "--no-emit-project", "--no-hashes"],
        cwd=service_dir, check=True, capture_output=True, text=True,
    ).stdout


def zip_dir(root: Path, prefix: str = "") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(root.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                zf.write(path, prefix + str(path.relative_to(root)))  # keeps the file mode, so run.sh stays executable
    return buf.getvalue()


def deps_layer(name: str, service_dir: Path) -> str:
    """ARN of the layer holding the locked runtime dependencies (arm64 wheels), published only when they change."""
    reqs = requirements(service_dir)
    digest = hashlib.sha256(f"{reqs}|aarch64|3.14".encode()).hexdigest()[:16]
    layer = f"{name}-deps"
    versions = lam.list_layer_versions(LayerName=layer).get("LayerVersions", [])
    for version in versions:
        if version.get("Description") == f"deps:{digest}":
            print(f"dependencies unchanged ({layer}:{version['Version']})")
            return version["LayerVersionArn"]

    out = BUILD / layer
    shutil.rmtree(out, ignore_errors=True)
    (out / "python").mkdir(parents=True)
    req_file = BUILD / f"{name}-requirements.txt"
    req_file.write_text(reqs)
    subprocess.run(
        ["uv", "pip", "install", "--quiet", "--target", str(out / "python"), "--python-platform", "aarch64-manylinux_2_28",
         "--python-version", "3.14", "--only-binary", ":all:", "-r", str(req_file)],
        check=True,
    )
    content = zip_dir(out)
    print(f"publishing {layer}: {len(content) / 1e6:.1f} MB")
    published = lam.publish_layer_version(
        LayerName=layer, Description=f"deps:{digest}", Content={"ZipFile": content},
        CompatibleRuntimes=["python3.14"], CompatibleArchitectures=["arm64"],
    )
    for version in versions[1:]:  # keep the newest old one for a quick rollback
        lam.delete_layer_version(LayerName=layer, VersionNumber=version["Version"])
    return published["LayerVersionArn"]


def build(name: str, service_dir: Path, package: str, run_script: str) -> bytes:
    """Zip our package source and the start script; the dependencies come from the layer."""
    out = BUILD / name
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    shutil.copytree(service_dir / "src" / package, out / package, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(Path(__file__).parent / run_script, out / "run.sh")
    return zip_dir(out)


def source_hash(name: str) -> str:
    """Hash of the files in the built folder, stable across rebuilds (zip timestamps are not)."""
    digest = hashlib.sha256()
    for path in sorted((BUILD / name).rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            digest.update(str(path.relative_to(BUILD / name)).encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()[:16]


# ---------- IAM ----------


def ensure_role(name: str, statements: list[dict]) -> str:
    trust = {
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}],
    }
    try:
        arn = iam.get_role(RoleName=name)["Role"]["Arn"]
    except iam.exceptions.NoSuchEntityException:
        arn = iam.create_role(
            RoleName=name,
            AssumeRolePolicyDocument=json.dumps(trust),
            Tags=[{"Key": k, "Value": v} for k, v in TAGS.items()],
        )["Role"]["Arn"]
        print(f"created role {name}")
    iam.put_role_policy(
        RoleName=name,
        PolicyName="popcorn",
        PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": statements}),
    )
    return arn


def log_statement(account: str, function: str) -> dict:
    group = f"arn:aws:logs:{REGION}:{account}:log-group:/aws/lambda/{function}"
    return {"Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"], "Resource": f"{group}:*"}


def ensure_log_group(function: str) -> None:
    group = f"/aws/lambda/{function}"
    try:
        logs.create_log_group(logGroupName=group, tags=TAGS)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_retention_policy(logGroupName=group, retentionInDays=LOG_DAYS)


# ---------- Lambda ----------


def ensure_function(name: str, role_arn: str, code: bytes, env: dict, timeout: int, memory: int, streaming: bool,
                    layer: str, force: bool = False) -> str:
    config = {
        "Role": role_arn,
        "Runtime": "python3.14",
        "Handler": "run.sh",
        "Layers": [LWA_LAYER, layer],
        "Timeout": timeout,
        "MemorySize": memory,
        "Environment": {"Variables": {**ADAPTER_ENV, **env}},
    }
    code_hash = source_hash(name)
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
    config["Description"] = f"code:{code_hash} config:{config_hash}"
    try:
        current = lam.get_function_configuration(FunctionName=name)
    except lam.exceptions.ResourceNotFoundException:
        for attempt in range(10):
            try:
                lam.create_function(
                    FunctionName=name, Code={"ZipFile": code}, Architectures=["arm64"], Tags=TAGS, **config
                )
                break
            except lam.exceptions.InvalidParameterValueException as exc:
                if "cannot be assumed" not in str(exc) or attempt == 9:
                    raise
                time.sleep(3)  # a new IAM role takes a few seconds to reach Lambda
        lam.get_waiter("function_active_v2").wait(FunctionName=name)
        print(f"created function {name}")
    else:
        old = dict(part.split(":", 1) for part in current.get("Description", "").split() if ":" in part)
        code_changed = force or old.get("code") != code_hash
        config_changed = force or old.get("config") != config_hash
        if code_changed:
            lam.update_function_code(FunctionName=name, ZipFile=code, Architectures=["arm64"])
            lam.get_waiter("function_updated_v2").wait(FunctionName=name)
        if code_changed or config_changed:
            lam.update_function_configuration(FunctionName=name, **config)
            lam.get_waiter("function_updated_v2").wait(FunctionName=name)
        changes = [w for w, c in (("code", code_changed), ("config", config_changed)) if c]
        print(f"updated function {name} ({', '.join(changes)})" if changes else f"function {name} unchanged")
    return ensure_url(name, "RESPONSE_STREAM" if streaming else "BUFFERED")


def ensure_url(name: str, invoke_mode: str) -> str:
    try:
        url = lam.get_function_url_config(FunctionName=name)
        if url["InvokeMode"] != invoke_mode:
            url = lam.update_function_url_config(FunctionName=name, InvokeMode=invoke_mode)
    except lam.exceptions.ResourceNotFoundException:
        # No CORS here: the apps send their own CORS headers.
        url = lam.create_function_url_config(FunctionName=name, AuthType="NONE", InvokeMode=invoke_mode)
    for sid, extra in (
        ("PublicUrl", {"Action": "lambda:InvokeFunctionUrl", "FunctionUrlAuthType": "NONE"}),
        ("PublicUrlInvoke", {"Action": "lambda:InvokeFunction", "InvokedViaFunctionUrl": True}),
    ):
        try:
            lam.add_permission(FunctionName=name, StatementId=sid, Principal="*", **extra)
        except lam.exceptions.ResourceConflictException:
            pass  # already there
    return url["FunctionUrl"].rstrip("/")


def url_of(name: str) -> str | None:
    try:
        return lam.get_function_url_config(FunctionName=name)["FunctionUrl"].rstrip("/")
    except lam.exceptions.ResourceNotFoundException:
        return None


def health(url: str) -> str:
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=30) as response:
                return f"{response.status} {response.read().decode()[:200]}"
        except Exception as exc:  # cold start can be slow; report the last error
            error = repr(exc)
            time.sleep(2)
    return f"FAILED {error}"


# ---------- commands ----------


def deploy(targets: list[str], force: bool = False) -> None:
    secrets = read_env()
    account = session.client("sts").get_caller_identity()["Account"]
    mcp_url = deploy_mcp(account, secrets, force) if "mcp" in targets else url_of("popcorn-mcp")
    if "agent" in targets:
        if not mcp_url:
            raise SystemExit("deploy the MCP server first: uv run deploy.py deploy mcp")
        agent_url = deploy_agent(account, secrets, mcp_url, force)
    else:
        agent_url = None
    status(mcp_url, agent_url)


def deploy_mcp(account: str, secrets: dict, force: bool) -> str:
    service_dir = ROOT / "services" / "mcp"
    layer = deps_layer("popcorn-mcp", service_dir)
    code = build("popcorn-mcp", service_dir, "popcorn_mcp", "run-mcp.sh")
    ensure_log_group("popcorn-mcp")
    mcp_role = ensure_role("popcorn-mcp-role", [
        log_statement(account, "popcorn-mcp"),
        {
            "Effect": "Allow",
            "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
            "Resource": f"arn:aws:dynamodb:{REGION}:{account}:table/{TABLE}",
        },
    ])
    return ensure_function("popcorn-mcp", mcp_role, code, {
        "TMDB_API_READ_TOKEN": secrets["TMDB_API_READ_TOKEN"],
        "POPCORN_TABLE": TABLE,
        "POPCORN_HOUSEHOLD": HOUSEHOLD,
        # Speech (ElevenLabs Flash v2.5) and transcription (Whisper Large V3 Turbo) go through OpenRouter.
        "OPENROUTER_API_KEY": secrets["OPENROUTER_API_KEY"],
    }, timeout=30, memory=512, streaming=False, layer=layer, force=force)


def deploy_agent(account: str, secrets: dict, mcp_url: str, force: bool) -> str:
    service_dir = ROOT / "services" / "agent"
    layer = deps_layer("popcorn-agent", service_dir)
    code = build("popcorn-agent", service_dir, "popcorn_agent", "run-agent.sh")
    ensure_log_group("popcorn-agent")
    agent_role = ensure_role("popcorn-agent-role", [
        log_statement(account, "popcorn-agent"),
        {"Effect": "Allow", "Action": "polly:SynthesizeSpeech", "Resource": "*"},
        {
            # The household's running conversation (`<household>:session`).
            "Effect": "Allow",
            "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
            "Resource": f"arn:aws:dynamodb:{REGION}:{account}:table/{TABLE}",
        },
    ])
    return ensure_function("popcorn-agent", agent_role, code, {
        "OPENROUTER_API_KEY": secrets["OPENROUTER_API_KEY"],
        "OPENROUTER_MODEL": secrets.get("OPENROUTER_MODEL") or "openai/gpt-6-luna",
        "MCP_URL": f"{mcp_url}/mcp",
        "POPCORN_TABLE": TABLE,
        "POPCORN_HOUSEHOLD": HOUSEHOLD,
        "POLLY_VOICE": "Brian",
        "POLLY_ENGINE": "standard",
        "AWS_LWA_INVOKE_MODE": "response_stream",
    }, timeout=120, memory=1024, streaming=True, layer=layer, force=force)


def status(mcp_url: str | None = None, agent_url: str | None = None) -> None:
    for name, url in (("popcorn-mcp", mcp_url or url_of("popcorn-mcp")), ("popcorn-agent", agent_url or url_of("popcorn-agent"))):
        print(f"{name}: {url or 'not deployed'}")
        if url:
            print(f"  /health -> {health(url)}")


def destroy() -> None:
    for name in ("popcorn-agent", "popcorn-mcp"):
        for call in (lam.delete_function_url_config, lam.delete_function):
            try:
                call(FunctionName=name)
            except lam.exceptions.ResourceNotFoundException:
                pass
        try:
            logs.delete_log_group(logGroupName=f"/aws/lambda/{name}")
        except logs.exceptions.ResourceNotFoundException:
            pass
        role = f"{name}-role"
        try:
            iam.delete_role_policy(RoleName=role, PolicyName="popcorn")
            iam.delete_role(RoleName=role)
        except iam.exceptions.NoSuchEntityException:
            pass
        for version in lam.list_layer_versions(LayerName=f"{name}-deps").get("LayerVersions", []):
            lam.delete_layer_version(LayerName=f"{name}-deps", VersionNumber=version["Version"])
        print(f"deleted {name}")
    print(f"kept DynamoDB table {TABLE}")


def reset() -> None:
    """Forget the demo household (profiles, couch, TV state). The TMDB cache stays."""
    pages = session.client("dynamodb").get_paginator("scan").paginate(
        TableName=TABLE,
        ProjectionExpression="pk",
        FilterExpression="begins_with(pk, :household)",
        ExpressionAttributeValues={":household": {"S": f"{HOUSEHOLD}:"}},
    )
    keys = list(pages.search("Items[].pk.S"))
    table = session.resource("dynamodb").Table(TABLE)
    with table.batch_writer() as batch:
        for key in keys:
            batch.delete_item(Key={"pk": key})
    print(f"deleted {len(keys)} items of household {HOUSEHOLD}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["deploy", "status", "destroy", "reset"])
    parser.add_argument("targets", nargs="*", metavar="mcp|agent", help="deploy only: which services (default both)")
    parser.add_argument("--force", action="store_true", help="deploy only: upload even when nothing changed")
    args = parser.parse_args()
    if set(args.targets) - {"mcp", "agent"} or (args.targets and args.command != "deploy"):
        parser.error("only deploy takes services, and they are mcp and agent")
    try:
        if args.command == "deploy":
            deploy(args.targets or ["mcp", "agent"], args.force)
        else:
            {"status": status, "destroy": destroy, "reset": reset}[args.command]()
        return 0
    except ClientError as exc:
        print(f"AWS error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
