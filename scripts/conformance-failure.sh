#!/usr/bin/env bash
#
# Starts a double with Docker Compose, makes it fail on purpose and asserts the failure
# (spec/failure-modes.md).
#
#   scripts/conformance-failure.sh <double> <mode> [--other-commit | --without-variable]
#
#   <mode>              a mode the double lists in failure_modes (double.json)
#   --other-commit      set DOUBLE_FAIL=<mode>@<another commit> instead, and assert the double stays
#                       healthy: a mode fires only on the release whose commit it names
#   --without-variable  a control for this script: recreate the app without DOUBLE_FAIL and run the
#                       mode's assertions anyway. The double does not fail, so they must, and the
#                       script must exit 1. A run that exits 0 means the assertions cannot fail.
#
# The stack first starts healthy without DOUBLE_FAIL (docker compose up --wait). Then only the app
# container is recreated with DOUBLE_FAIL=<mode>@<REVISION>, without --wait: a failing double never
# turns healthy. On the Laravel double the container's entrypoint runs config:cache on start, so
# the value reaches the app the way it does on a host that caches its configuration.
#
# What each mode must do:
#
#   build      `php artisan package:discover` (what composer install runs) exits non-zero; migrate still works
#   migrate    `php artisan migrate --force` exits non-zero; package:discover still works
#   boot       every request fails, the report included (5xx, or no server at all on Node, with the
#              deliberate error in the app's log); console commands still work
#   500        "/" answers 500 while /up and /.well-known/deploy-report keep answering for this commit
#   slow-boot  Laravel: 503 on every request, the report included, for about 20 s after the first
#              request, then 200. Node: the first request is held for about 20 s, then answers 200.
#
# Exit 0: the double did what its mode says. 1: it did not. 64: usage.
#
# Requires: docker compose, curl, jq, node >= 24, and a built verifier (cd verifier && npm ci &&
# npm run build). DD_PORT, DD_PROJECT, DD_IMAGE_TAG and REVISION work as in scripts/conformance.sh.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "usage: scripts/conformance-failure.sh <double> <mode> [--other-commit | --without-variable]" >&2
  exit 64
}

[ $# -ge 2 ] || usage
double="$1"
mode="$2"
shift 2

other_commit=0
without_variable=0
while [ $# -gt 0 ]; do
  case "$1" in
    --other-commit) other_commit=1; shift ;;
    --without-variable) without_variable=1; shift ;;
    *) usage ;;
  esac
done
[ "$other_commit" -eq 0 ] || [ "$without_variable" -eq 0 ] || usage

case "$double" in
  */* | .* | "") usage ;;
esac
compose_file="$root/doubles/$double/docker-compose.yml"
manifest="$root/doubles/$double/double.json"
[ -f "$compose_file" ] && [ -f "$manifest" ] || { echo "conformance-failure: no docker-compose.yml or double.json for double '$double'" >&2; exit 64; }
jq -e --arg mode "$mode" 'any(.failure_modes[]?; .id == $mode)' "$manifest" >/dev/null \
  || { echo "conformance-failure: $double does not list failure mode '$mode' in double.json" >&2; exit 64; }

cli="$root/verifier/dist/cli.js"
[ -f "$cli" ] || { echo "conformance-failure: build the verifier first (cd verifier && npm ci && npm run build)" >&2; exit 64; }

framework="$(jq -r '.framework.name' "$manifest")"
export REVISION="${REVISION:-$(git -C "$root" rev-parse HEAD)}"
port="${DD_PORT:-8080}"
export DD_PORT="$port"
project="${DD_PROJECT:-dd-failure-${double}}"
export DD_IMAGE_TAG="${DD_IMAGE_TAG:-local}"
base="http://localhost:$port"
report_path="/.well-known/deploy-report"

if [ "$other_commit" -eq 1 ]; then
  # Same length, every hex digit shifted: well-formed, and never this commit.
  commit="$(printf '%s' "$REVISION" | tr '0-9a-f' '1-9a-f0')"
else
  commit="$REVISION"
fi
value="$mode@$commit"
label="$double $mode$([ "$other_commit" -eq 0 ] || echo ' (other commit)')$([ "$without_variable" -eq 0 ] || echo ' (without variable)')"

compose=(docker compose --project-name "$project" --file "$compose_file")

cleanup() {
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

failed=0
fail() { echo "conformance-failure: FAIL: $*" >&2; failed=1; }
ok() { echo "conformance-failure: ok: $*" >&2; }

# HTTP status of a path, "000" when nothing answered (refused, reset or timed out).
status() {
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time "${2:-10}" "$base$1" 2>/dev/null || true
}

# The commit the report answers for, empty when the response is not a report.
report_commit() {
  curl --silent --max-time 10 "$base$report_path" 2>/dev/null | jq -r '.deploy.release.commit // empty' 2>/dev/null || true
}

now() { date +%s; }

# Waits until a path answers at all; prints the status ("000" at the timeout).
first_answer() {
  local path="$1" deadline=$(( $(now) + $2 )) code
  while :; do
    code="$(status "$path" 5)"
    if [ "$code" != "000" ] || [ "$(now)" -ge "$deadline" ]; then
      printf '%s' "$code"
      return
    fi
    sleep 1
  done
}

# Runs an artisan command in the app container; prints its output, returns its exit code.
artisan() {
  "${compose[@]}" exec -T app php artisan "$@" 2>&1
}

artisan_fails() {
  local out code
  if out="$(artisan "$@")"; then code=0; else code=$?; fi
  if [ "$code" -ne 0 ] && grep -q 'Deliberate failure' <<< "$out"; then
    ok "php artisan $* exited $code on the deliberate failure"
  else
    fail "php artisan $* exited $code; expected a non-zero exit on the deliberate failure. Output: $(tail -5 <<< "$out")"
  fi
}

artisan_works() {
  local out code
  if out="$(artisan "$@")"; then code=0; else code=$?; fi
  if [ "$code" -eq 0 ]; then
    ok "php artisan $* still exits 0"
  else
    fail "php artisan $* exited $code; only the named stage may fail. Output: $(tail -5 <<< "$out")"
  fi
}

expect_status() {
  local path="$1" want="$2" got
  got="$(status "$path")"
  if [ "$got" = "$want" ]; then ok "$path answered $got"; else fail "$path answered $got, expected $want"; fi
}

# The report endpoint still serves a report for this release (HTTP 200, or 503 for a failing report).
expect_report() {
  local got served
  got="$(status "$report_path")"
  served="$(report_commit)"
  if { [ "$got" = 200 ] || [ "$got" = 503 ]; } && [ "$served" = "$REVISION" ]; then
    ok "$report_path answered $got with a report for $REVISION"
  else
    fail "$report_path answered $got for commit '${served:-none}', expected a report for $REVISION"
  fi
}

# Every request fails: a 5xx, or (Node) no answer at all. Never a 2xx, 3xx or 4xx.
expect_all_failing() {
  local round path got
  for round in 1 2 3; do
    for path in / /up "$report_path"; do
      got="$(status "$path")"
      if [ "$got" = "000" ] && [ "$framework" = "next" ]; then
        continue
      elif [ "$got" -ge 500 ]; then
        continue
      fi
      fail "$path answered $got in round $round; boot must fail every request"
      return
    done
    sleep 2
  done
  ok "/, /up and $report_path failed every request, three rounds"
  if [ -n "$(report_commit)" ]; then
    fail "$report_path still served a report"
  fi
}

# The app's log names the deliberate failure, so a request that failed for another reason never passes.
expect_logged() {
  local app_log
  app_log="$("${compose[@]}" logs --no-color app 2>&1 || true)"
  if grep -qF "$1" <<< "$app_log"; then
    ok "the app's log shows: $1"
  else
    fail "the app's log does not show: $1"
  fi
}

verify_healthy() {
  local code
  set +e
  node "$cli" verify "$base" --commit "$REVISION" --timeout 180 --json >/dev/null
  code=$?
  set -e
  if [ "$code" -eq 0 ]; then ok "the verifier passes on $REVISION"; else fail "the verifier exited $code on $REVISION"; fi
}

# ── 1. Healthy, without the variable ─────────────────────────────────────────────────────────────

echo "conformance-failure: starting $double at $REVISION without DOUBLE_FAIL" >&2
env -u DOUBLE_FAIL "${compose[@]}" up --detach --wait --wait-timeout 600 --build >&2
if [ "$(status /)" != 200 ]; then
  echo "conformance-failure: $double is not healthy before DOUBLE_FAIL is set" >&2
  exit 1
fi

# ── 2. The app again, with the variable ──────────────────────────────────────────────────────────

if [ "$without_variable" -eq 1 ]; then
  echo "conformance-failure: recreating the app without DOUBLE_FAIL (control: the assertions must fail)" >&2
  env -u DOUBLE_FAIL "${compose[@]}" up --detach --no-deps --force-recreate app >&2
else
  echo "conformance-failure: recreating the app with DOUBLE_FAIL=$value" >&2
  DOUBLE_FAIL="$value" "${compose[@]}" up --detach --no-deps --force-recreate app >&2
fi
started="$(now)"

# ── 3. What the mode must do ─────────────────────────────────────────────────────────────────────

if [ "$other_commit" -eq 1 ]; then
  # Another commit: the double behaves exactly as without the variable, from its first answer on.
  first="$(first_answer / 60)"
  waited=$(( $(now) - started ))
  if [ "$first" = 200 ] && [ "$waited" -lt 15 ]; then
    ok "/ answered 200 first, ${waited}s after the restart"
  else
    fail "/ answered $first first, ${waited}s after the restart; expected 200 within 15 s"
  fi
  expect_status /up 200
  if [ "$framework" = "laravel" ]; then
    artisan_works package:discover
    artisan_works migrate --force
  fi
  verify_healthy
else
  case "$framework:$mode" in
    laravel:build | laravel:migrate)
      first="$(first_answer / 120)"
      [ "$first" = 200 ] || fail "/ answered $first; the app must keep serving"
      if [ "$mode" = build ]; then
        artisan_fails package:discover
        artisan_works migrate --force
      else
        artisan_fails migrate --force
        artisan_works package:discover
      fi
      ;;

    laravel:boot)
      first="$(first_answer / 120)"
      [ "$first" != "000" ] || fail "the app never answered; boot must fail requests, not the process"
      expect_all_failing
      expect_logged 'Deliberate failure: DOUBLE_FAIL=boot'
      # The console guard: build and release commands are unaffected.
      artisan_works package:discover
      artisan_works migrate --force
      ;;

    next:boot)
      # Next.js listens before instrumentation's register() finishes; when it throws, every request
      # answers 500 with the hook's error logged (a server that exited would count too). Nothing may
      # succeed, and the log must show why.
      sleep 15
      expect_all_failing
      expect_logged 'Deliberate failure: DOUBLE_FAIL=boot'
      ;;

    *:500)
      first="$(first_answer / 120)"
      if [ "$first" = 500 ]; then ok "/ answered 500"; else fail "/ answered $first, expected 500"; fi
      expect_status /up 200
      expect_report
      ;;

    laravel:slow-boot)
      # 503 on every request from the first one, the report included, for about 20 s; then 200.
      first="" first_at="" served_at="" report_503=0
      deadline=$(( started + 120 ))
      while [ "$(now)" -lt "$deadline" ]; do
        code="$(status / 5)"
        if [ "$code" != "000" ] && [ -z "$first" ]; then
          first="$code"
          first_at="$(now)"
        fi
        if [ "$code" = 200 ]; then
          served_at="$(now)"
          break
        fi
        [ "$(status "$report_path" 5)" != 503 ] || report_503=1
        sleep 1
      done
      if [ "$first" = 503 ]; then ok "/ answered 503 first"; else fail "/ answered ${first:-nothing} first, expected 503"; fi
      if [ "$report_503" -eq 1 ]; then
        ok "$report_path answered 503 during the window"
      else
        fail "$report_path never answered 503 during the window"
      fi
      if [ -z "$served_at" ]; then
        fail "/ never answered 200 within 120 s"
      elif [ -n "$first_at" ]; then
        window=$(( served_at - first_at ))
        if [ "$window" -ge 12 ] && [ "$window" -le 40 ]; then
          ok "/ served 200 after ${window}s of 503"
        else
          fail "/ served 200 after ${window}s of 503, expected about 20 s"
        fi
      fi
      expect_status /up 200
      expect_report
      ;;

    next:slow-boot)
      # The first request is held until register() returns, then answers 200. A refused connection
      # only means the server is not listening yet: retry, never judge it.
      first="000"
      deadline=$(( started + 120 ))
      while [ "$(now)" -lt "$deadline" ]; do
        first="$(status / 60)"
        [ "$first" = "000" ] || break
        sleep 0.5
      done
      waited=$(( $(now) - started ))
      if [ "$first" = 200 ] && [ "$waited" -ge 15 ]; then
        ok "the first request answered 200 after ${waited}s"
      else
        fail "the first request answered $first after ${waited}s, expected 200 after about 20 s"
      fi
      expect_status /up 200
      expect_report
      ;;

    *)
      echo "conformance-failure: no assertion for $framework mode '$mode'" >&2
      exit 64
      ;;
  esac
fi

if [ "$failed" -ne 0 ]; then
  echo "conformance-failure: $label: FAILED; recent app logs:" >&2
  "${compose[@]}" logs --no-color --tail 40 app >&2 || true
  exit 1
fi

echo "conformance-failure: $label: pass" >&2
