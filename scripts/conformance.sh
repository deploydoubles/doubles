#!/usr/bin/env bash
#
# Starts a double with Docker Compose and verifies it from outside.
#
#   scripts/conformance.sh <double> [--without <service>]... [--stop <service>]... [--json-out <file>]
#
#   --without <service>  scale a result *producer* (worker, scheduler) to 0, so it never produces a result
#   --stop <service>     stop a *dependency* (a database) after startup, then wait 75 s — one check
#                        interval plus margin — so the app's next scheduled run records the failure
#                        before the verifier reads the stored results
#   --json-out <file>    also write the verifier's --json output to <file>, so a caller can assert
#                        which check failed (the revert controls in CI do)
#
# The exit code is the verifier's: 0 pass, 1 a check failed, 2 pending at timeout, 3 unreachable or
# wrong release. The stack is always torn down (docker compose down -v).
#
# Requires: docker compose, node >= 24, and a built verifier (cd verifier && npm ci && npm run build).
#
# DD_PORT, DD_PROJECT and DD_IMAGE_TAG override the published port, the Compose project name and the
# image tag, so two runs can share one machine without tearing each other down.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "usage: scripts/conformance.sh <double> [--without <service>]... [--stop <service>]... [--json-out <file>]" >&2
  exit 64
}

[ $# -ge 1 ] || usage
double="$1"
shift

without=()
stop=()
json_out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --without) [ $# -ge 2 ] || usage; without+=("$2"); shift 2 ;;
    --stop) [ $# -ge 2 ] || usage; stop+=("$2"); shift 2 ;;
    --json-out) [ $# -ge 2 ] || usage; json_out="$2"; shift 2 ;;
    *) usage ;;
  esac
done

case "$double" in
  */* | .* | "") usage ;;
esac
compose_file="$root/doubles/$double/docker-compose.yml"
[ -f "$compose_file" ] || { echo "conformance: no docker-compose.yml for double '$double'" >&2; exit 64; }

cli="$root/verifier/dist/cli.js"
[ -f "$cli" ] || { echo "conformance: build the verifier first (cd verifier && npm ci && npm run build)" >&2; exit 64; }

export REVISION="${REVISION:-$(git -C "$root" rev-parse HEAD)}"
port="${DD_PORT:-8080}"
export DD_PORT="$port"
project="${DD_PROJECT:-dd-conformance-${double}}"
export DD_IMAGE_TAG="${DD_IMAGE_TAG:-local}"

compose=(docker compose --project-name "$project" --file "$compose_file")

cleanup() {
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

up_args=(up --detach --wait --wait-timeout 600 --build)
for service in ${without[@]+"${without[@]}"}; do
  up_args+=(--scale "$service=0")
done

echo "conformance: starting $double at $REVISION${without[*]:+ without ${without[*]}}" >&2
"${compose[@]}" "${up_args[@]}" >&2

if [ ${#stop[@]} -gt 0 ]; then
  for service in "${stop[@]}"; do
    echo "conformance: stopping $service" >&2
    "${compose[@]}" stop "$service" >&2
  done
  echo "conformance: waiting 75 s for the next scheduled run to record it" >&2
  sleep 75
fi

set +e
output=$(node "$cli" verify "http://localhost:$port" --commit "$REVISION" --timeout 180 --json)
code=$?
set -e
printf '%s\n' "$output"
if [ -n "$json_out" ]; then
  printf '%s\n' "$output" > "$json_out"
fi

if [ "$code" -ne 0 ]; then
  echo "conformance: verifier exited $code; recent logs:" >&2
  "${compose[@]}" logs --no-color --tail 40 >&2 || true
fi

exit "$code"
