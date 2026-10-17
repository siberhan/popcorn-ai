"""Deploy Popcorn AI to AWS Lambda: the MCP server and the agent service, each behind a public Function URL.

Both run their normal HTTP server inside Lambda through the Lambda Web Adapter layer.
The agent URL streams responses (Server-Sent Events for /chat/stream).

  uv run deploy.py deploy     build both zips, then create or update everything
  uv run deploy.py status     print the URLs and check /health
  uv run deploy.py destroy    delete the functions, URLs, roles and log groups (keeps the DynamoDB table)

Secrets (TMDB, OpenRouter) are read from the repo's .env and set as Lambda environment variables.
They are never printed.
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import boto3
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
lam = session.client("lambda")
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


def build(name: str, service_dir: Path, package: str, run_script: str) -> bytes:
    """Zip the locked runtime dependencies (arm64 wheels), the package source and the start script."""
    out = BUILD / name
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    requirements = BUILD / f"{name}-requirements.txt"
    subprocess.run(
        ["uv", "export", "--frozen", "--no-dev", "--no-emit-project", "--no-hashes", "-o", str(requirements)],
        cwd=service_dir, check=True, capture_output=True,
    )
    subprocess.run(
        ["uv", "pip", "install", "--quiet", "--target", str(out), "--python-platform", "aarch64-manylinux_2_28",
         "--python-version", "3.14", "--only-binary", ":all:", "-r", str(requirements)],
        check=True,
    )
    shutil.copytree(service_dir / "src" / package, out / package, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(Path(__file__).parent / run_script, out / "run.sh")

    zip_path = BUILD / f"{name}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(out.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                zf.write(path, path.relative_to(out))  # keeps the file mode, so run.sh stays executable
    print(f"built {zip_path.name}: {zip_path.stat().st_size / 1e6:.1f} MB")
    return zip_path.read_bytes()


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


def ensure_function(name: str, role_arn: str, code: bytes, env: dict, timeout: int, memory: int, streaming: bool) -> str:
    config = {
        "Role": role_arn,
        "Runtime": "python3.14",
        "Handler": "run.sh",
        "Layers": [LWA_LAYER],
        "Timeout": timeout,
        "MemorySize": memory,
        "Environment": {"Variables": {**ADAPTER_ENV, **env}},
    }
    try:
        lam.get_function(FunctionName=name)
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
        lam.update_function_code(FunctionName=name, ZipFile=code, Architectures=["arm64"])
        lam.get_waiter("function_updated_v2").wait(FunctionName=name)
        lam.update_function_configuration(FunctionName=name, **config)
        lam.get_waiter("function_updated_v2").wait(FunctionName=name)
        print(f"updated function {name}")
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


def deploy() -> None:
    secrets = read_env()
    account = session.client("sts").get_caller_identity()["Account"]

    mcp_code = build("popcorn-mcp", ROOT / "services" / "mcp", "popcorn_mcp", "run-mcp.sh")
    agent_code = build("popcorn-agent", ROOT / "services" / "agent", "popcorn_agent", "run-agent.sh")

    ensure_log_group("popcorn-mcp")
    mcp_role = ensure_role("popcorn-mcp-role", [
        log_statement(account, "popcorn-mcp"),
        {
            "Effect": "Allow",
            "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
            "Resource": f"arn:aws:dynamodb:{REGION}:{account}:table/{TABLE}",
        },
    ])
    mcp_url = ensure_function("popcorn-mcp", mcp_role, mcp_code, {
        "TMDB_API_READ_TOKEN": secrets["TMDB_API_READ_TOKEN"],
        "POPCORN_TABLE": TABLE,
        "POPCORN_HOUSEHOLD": HOUSEHOLD,
    }, timeout=30, memory=512, streaming=False)

    ensure_log_group("popcorn-agent")
    agent_role = ensure_role("popcorn-agent-role", [
        log_statement(account, "popcorn-agent"),
        {"Effect": "Allow", "Action": "polly:SynthesizeSpeech", "Resource": "*"},
    ])
    agent_url = ensure_function("popcorn-agent", agent_role, agent_code, {
        "OPENROUTER_API_KEY": secrets["OPENROUTER_API_KEY"],
        "OPENROUTER_MODEL": secrets.get("OPENROUTER_MODEL") or "openai/gpt-6-luna",
        "MCP_URL": f"{mcp_url}/mcp",
        "POLLY_VOICE": "Brian",
        "POLLY_ENGINE": "standard",
        "AWS_LWA_INVOKE_MODE": "response_stream",
    }, timeout=120, memory=1024, streaming=True)

    status(mcp_url, agent_url)


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
        print(f"deleted {name}")
    print(f"kept DynamoDB table {TABLE}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["deploy", "status", "destroy"])
    args = parser.parse_args()
    try:
        {"deploy": deploy, "status": status, "destroy": destroy}[args.command]()
        return 0
    except ClientError as exc:
        print(f"AWS error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
