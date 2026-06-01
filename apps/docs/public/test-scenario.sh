#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="test-scenario.sh"

URL=""
SECRET=""
SCENARIO=""
TEST_RUN_ID="client-test-$(date +%s)"
TIMEOUT_SECONDS=30
DISCOVER_FIRST=1
SKIP_DOWN=0

LAST_STATUS=""
LAST_BODY=""
LAST_HEADERS=""
LAST_CURL_ERROR=""
ACTION_RESPONSE=""
UP_REFS="null"
UP_REFS_TOKEN=""

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  COLOR_RESET="$(printf '\033[0m')"
  COLOR_BOLD="$(printf '\033[1m')"
  COLOR_RED="$(printf '\033[31m')"
  COLOR_GREEN="$(printf '\033[32m')"
  COLOR_YELLOW="$(printf '\033[33m')"
  COLOR_BLUE="$(printf '\033[34m')"
else
  COLOR_RESET=""
  COLOR_BOLD=""
  COLOR_RED=""
  COLOR_GREEN=""
  COLOR_YELLOW=""
  COLOR_BLUE=""
fi

usage() {
  cat <<EOF
${COLOR_BOLD}Autonoma Environment Factory - Scenario Tester${COLOR_RESET}

Tests your Environment Factory endpoint by running the full discover -> up -> down lifecycle.

${COLOR_BOLD}Usage:${COLOR_RESET}
  curl -fsSL https://docs.autonoma.app/test-scenario.sh | bash -s -- [options]

  ${COLOR_BOLD}or${COLOR_RESET} download and run directly:
  bash $SCRIPT_NAME [options]

${COLOR_BOLD}Required:${COLOR_RESET}
  --url URL              Your Environment Factory endpoint URL
  --secret SECRET        Your AUTONOMA_SIGNING_SECRET (the HMAC secret shared with Autonoma)
  --scenario NAME        Scenario name to test (e.g., standard, empty, large)

${COLOR_BOLD}Options:${COLOR_RESET}
  --test-run-id ID       Use a fixed test run ID instead of generating one
  --timeout SECONDS      Per-request timeout (default: 30)
  --skip-discover        Skip the discover call and go straight to up/down
  --keep-up              Run up only - do not call down (leaves data in place)
  -h, --help             Show this help text

${COLOR_BOLD}Examples:${COLOR_RESET}
  # Test the standard scenario
  curl -fsSL https://docs.autonoma.app/test-scenario.sh | bash -s -- \\
    --url https://your-app.com/api/autonoma \\
    --secret your-signing-secret \\
    --scenario standard

  # Test without teardown (inspect created data manually)
  curl -fsSL https://docs.autonoma.app/test-scenario.sh | bash -s -- \\
    --url https://your-app.com/api/autonoma \\
    --secret your-signing-secret \\
    --scenario standard \\
    --keep-up

  # Skip discover and test up/down directly
  curl -fsSL https://docs.autonoma.app/test-scenario.sh | bash -s -- \\
    --url https://your-app.com/api/autonoma \\
    --secret your-signing-secret \\
    --scenario empty \\
    --skip-discover

${COLOR_BOLD}What it tests:${COLOR_RESET}
  1. ${COLOR_BLUE}discover${COLOR_RESET} - Calls your endpoint and verifies the response shape
     and that the requested scenario is listed
  2. ${COLOR_BLUE}up${COLOR_RESET} - Creates the scenario's test data and validates the
     response contains auth, refs, and refsToken
  3. ${COLOR_BLUE}down${COLOR_RESET} - Tears down the created data using the refs from up
     and verifies cleanup succeeded

${COLOR_BOLD}Requirements:${COLOR_RESET}
  curl, openssl, python3

${COLOR_BOLD}Documentation:${COLOR_RESET}
  https://docs.autonoma.app/guides/environment-factory/
EOF
}

section() {
  printf '\n%s== %s ==%s\n' "$COLOR_BOLD" "$1" "$COLOR_RESET"
}

info() {
  printf '%s[info]%s %s\n' "$COLOR_BLUE" "$COLOR_RESET" "$1"
}

success() {
  printf '%s[ok]%s %s\n' "$COLOR_GREEN" "$COLOR_RESET" "$1"
}

warn() {
  printf '%s[warn]%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$1" >&2
}

fail() {
  printf '%s[error]%s %s\n' "$COLOR_RED" "$COLOR_RESET" "$1" >&2
}

die() {
  fail "$1"
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Missing required command: $1"
  fi
}

print_block() {
  local title="$1"
  local body="$2"

  printf '%s:\n' "$title"
  if [ -z "$body" ]; then
    printf '  (empty)\n'
    return
  fi

  while IFS= read -r line; do
    printf '  %s\n' "$line"
  done <<EOF
$body
EOF
}

pretty_json() {
  local raw="$1"

  if [ -z "$raw" ]; then
    printf '%s\n' "$raw"
    return 0
  fi

  JSON_INPUT="$raw" python3 - <<'PY' 2>/dev/null || printf '%s\n' "$raw"
import json
import os

data = json.loads(os.environ["JSON_INPUT"])
print(json.dumps(data, indent=2, sort_keys=True))
PY
}

sign_body() {
  local secret="$1"
  local body="$2"

  printf '%s' "$body" | openssl dgst -sha256 -hmac "$secret" | sed 's/^.*= //'
}

perform_request() {
  local body="$1"
  local timeout_seconds="$2"
  local signature
  local body_file
  local headers_file
  local stderr_file
  local http_code
  local curl_exit

  signature="$(sign_body "$SECRET" "$body")"
  body_file="$(mktemp)"
  headers_file="$(mktemp)"
  stderr_file="$(mktemp)"
  curl_exit=0

  http_code="$(
    curl \
      --silent \
      --show-error \
      --location \
      --max-time "$timeout_seconds" \
      --connect-timeout 10 \
      --request POST \
      --header "Content-Type: application/json" \
      --header "x-signature: $signature" \
      --data "$body" \
      --dump-header "$headers_file" \
      --output "$body_file" \
      --write-out '%{http_code}' \
      "$URL" 2>"$stderr_file"
  )" || curl_exit=$?

  LAST_STATUS="$http_code"
  LAST_BODY="$(cat "$body_file")"
  LAST_HEADERS="$(cat "$headers_file")"
  LAST_CURL_ERROR="$(cat "$stderr_file")"

  rm -f "$body_file" "$headers_file" "$stderr_file"

  return "$curl_exit"
}

validate_response() {
  local schema="$1"
  local raw="$2"

  JSON_INPUT="$raw" python3 - "$schema" <<'PY'
import json
import os
import sys

schema = sys.argv[1]

try:
    data = json.loads(os.environ["JSON_INPUT"])
except Exception as exc:
    print(f"Response is not valid JSON: {exc}", file=sys.stderr)
    sys.exit(1)

if not isinstance(data, dict):
    print("Response must be a JSON object.", file=sys.stderr)
    sys.exit(1)

def ensure_optional_string(obj, key):
    if key in obj and obj[key] is not None and not isinstance(obj[key], str):
        print(f'"{key}" must be a string when present.', file=sys.stderr)
        sys.exit(1)

if schema == "discover":
    environments = data.get("environments")
    if not isinstance(environments, list):
        print('"environments" must be an array.', file=sys.stderr)
        sys.exit(1)
    for index, item in enumerate(environments):
        if not isinstance(item, dict):
            print(f'"environments[{index}]" must be an object.', file=sys.stderr)
            sys.exit(1)
        if not isinstance(item.get("name"), str):
            print(f'"environments[{index}].name" must be a string.', file=sys.stderr)
            sys.exit(1)
        ensure_optional_string(item, "description")
        ensure_optional_string(item, "fingerprint")
elif schema == "up":
    ensure_optional_string(data, "refsToken")
    if "expiresInSeconds" in data and data["expiresInSeconds"] is not None and not isinstance(data["expiresInSeconds"], (int, float)):
        print('"expiresInSeconds" must be a number when present.', file=sys.stderr)
        sys.exit(1)
elif schema == "down":
    if not isinstance(data.get("ok"), bool):
        print('"ok" must be a boolean.', file=sys.stderr)
        sys.exit(1)
else:
    print(f"Unknown schema: {schema}", file=sys.stderr)
    sys.exit(1)
PY
}

ensure_discovered_scenario() {
  local raw="$1"
  local scenario="$2"

  JSON_INPUT="$raw" python3 - "$scenario" <<'PY'
import json
import os
import sys

scenario = sys.argv[1]
data = json.loads(os.environ["JSON_INPUT"])
names = []

for item in data.get("environments", []):
    if isinstance(item, dict) and isinstance(item.get("name"), str):
        names.append(item["name"])

if scenario in names:
    sys.exit(0)

if names:
    print("Discover succeeded, but the requested scenario was not listed.", file=sys.stderr)
    print("Available scenarios:", file=sys.stderr)
    for name in names:
        print(f"  - {name}", file=sys.stderr)
else:
    print("Discover returned no scenarios.", file=sys.stderr)

sys.exit(1)
PY
}

extract_up_artifacts() {
  local raw="$1"
  local output

  output="$(
    JSON_INPUT="$raw" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["JSON_INPUT"])
refs = data.get("refs", None)
token = data.get("refsToken", "")

if refs is None:
    print("null")
else:
    print(json.dumps(refs, separators=(",", ":")))

if token is None:
    print("")
else:
    print(token)
PY
  )"

  UP_REFS="$(printf '%s\n' "$output" | sed -n '1p')"
  UP_REFS_TOKEN="$(printf '%s\n' "$output" | sed -n '2p')"
}

build_down_body() {
  REFS_JSON="$UP_REFS" TEST_RUN_ID_VALUE="$TEST_RUN_ID" REFS_TOKEN_VALUE="$UP_REFS_TOKEN" python3 - <<'PY'
import json
import os

refs = json.loads(os.environ["REFS_JSON"])
payload = {
    "action": "down",
    "testRunId": os.environ["TEST_RUN_ID_VALUE"],
    "refs": refs,
}

refs_token = os.environ.get("REFS_TOKEN_VALUE", "")
if refs_token != "":
    payload["refsToken"] = refs_token

print(json.dumps(payload, separators=(",", ":")))
PY
}

retry_sleep_seconds() {
  local attempt="$1"
  local seconds=$((2 ** (attempt - 1)))

  if [ "$seconds" -gt 30 ]; then
    seconds=30
  fi

  printf '%s' "$seconds"
}

call_action() {
  local label="$1"
  local body="$2"
  local schema="$3"
  local max_retries="$4"
  local timeout_seconds="$5"
  local attempt=1
  local max_attempts=$((max_retries + 1))
  local validation_error

  while [ "$attempt" -le "$max_attempts" ]; do
    section "$label"
    info "Attempt $attempt of $max_attempts"
    info "POST $URL"
    print_block "Request body" "$(pretty_json "$body")"

    if ! perform_request "$body" "$timeout_seconds"; then
      fail "Request failed before a valid HTTP response was received."
      if [ -n "$LAST_CURL_ERROR" ]; then
        print_block "curl output" "$LAST_CURL_ERROR"
      fi
      if [ "$attempt" -lt "$max_attempts" ]; then
        local sleep_seconds
        sleep_seconds="$(retry_sleep_seconds "$attempt")"
        warn "Retrying in ${sleep_seconds}s."
        sleep "$sleep_seconds"
        attempt=$((attempt + 1))
        continue
      fi
      return 1
    fi

    info "HTTP status: $LAST_STATUS"
    print_block "Response body" "$(pretty_json "$LAST_BODY")"

    if [ "$LAST_STATUS" -lt 200 ] || [ "$LAST_STATUS" -ge 300 ]; then
      fail "$label returned a non-2xx status."
      if [ -n "$LAST_HEADERS" ]; then
        print_block "Response headers" "$LAST_HEADERS"
      fi
      if [ "$attempt" -lt "$max_attempts" ]; then
        local sleep_seconds
        sleep_seconds="$(retry_sleep_seconds "$attempt")"
        warn "Retrying in ${sleep_seconds}s."
        sleep "$sleep_seconds"
        attempt=$((attempt + 1))
        continue
      fi
      return 1
    fi

    validation_error="$(validate_response "$schema" "$LAST_BODY" 2>&1)" || {
      fail "$label returned an unexpected success payload."
      print_block "Validation error" "$validation_error"
      return 1
    }

    ACTION_RESPONSE="$LAST_BODY"
    success "$label succeeded."
    return 0
  done

  return 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url)
      [ $# -ge 2 ] || die "Missing value for --url"
      URL="$2"
      shift 2
      ;;
    --secret)
      [ $# -ge 2 ] || die "Missing value for --secret"
      SECRET="$2"
      shift 2
      ;;
    --scenario)
      [ $# -ge 2 ] || die "Missing value for --scenario"
      SCENARIO="$2"
      shift 2
      ;;
    --test-run-id)
      [ $# -ge 2 ] || die "Missing value for --test-run-id"
      TEST_RUN_ID="$2"
      shift 2
      ;;
    --timeout)
      [ $# -ge 2 ] || die "Missing value for --timeout"
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --skip-discover)
      DISCOVER_FIRST=0
      shift
      ;;
    --keep-up)
      SKIP_DOWN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

require_cmd curl
require_cmd openssl
require_cmd python3

[ -n "$URL" ] || die "Missing --url. Run with --help for usage."
[ -n "$SECRET" ] || die "Missing --secret. Run with --help for usage."
[ -n "$SCENARIO" ] || die "Missing --scenario. Run with --help for usage."

case "$TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    die "--timeout must be an integer number of seconds"
    ;;
esac

section "Scenario Test"
info "Scenario: $SCENARIO"
info "Test run id: $TEST_RUN_ID"
info "Discover first: $DISCOVER_FIRST"
info "Run down: $((1 - SKIP_DOWN))"

if [ "$DISCOVER_FIRST" -eq 1 ]; then
  call_action \
    "Discover" \
    '{"action":"discover"}' \
    "discover" \
    2 \
    "$TIMEOUT_SECONDS" || die "Discover failed."

  ensure_discovered_scenario "$ACTION_RESPONSE" "$SCENARIO" || die "Scenario \"$SCENARIO\" was not found in discover."
  success "Scenario \"$SCENARIO\" was present in discover."
fi

UP_BODY="$(TEST_RUN_ID_VALUE="$TEST_RUN_ID" SCENARIO_VALUE="$SCENARIO" python3 - <<'PY'
import json
import os

print(json.dumps({
    "action": "up",
    "environment": os.environ["SCENARIO_VALUE"],
    "testRunId": os.environ["TEST_RUN_ID_VALUE"],
}, separators=(",", ":")))
PY
)"

call_action \
  "Up" \
  "$UP_BODY" \
  "up" \
  2 \
  "$TIMEOUT_SECONDS" || die "Up failed."

extract_up_artifacts "$ACTION_RESPONSE"
print_block "Extracted refs" "$(pretty_json "$UP_REFS")"
if [ -n "$UP_REFS_TOKEN" ]; then
  print_block "Extracted refsToken" "$UP_REFS_TOKEN"
else
  info "No refsToken was returned by up."
fi

if [ "$SKIP_DOWN" -eq 1 ]; then
  success "Up completed. Down was skipped because --keep-up was provided."
  exit 0
fi

DOWN_BODY="$(build_down_body)"

call_action \
  "Down" \
  "$DOWN_BODY" \
  "down" \
  5 \
  "$TIMEOUT_SECONDS" || die "Down failed."

success "Scenario test completed successfully."
