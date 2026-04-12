#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
HOST_BIND="${HOST_BIND:-127.0.0.1}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-cloudflared}"
CLOUDFLARED_PROTOCOL="${CLOUDFLARED_PROTOCOL:-http2}"
CLOUDFLARED_EDGE_IP_VERSION="${CLOUDFLARED_EDGE_IP_VERSION:-4}"
CLOUDFLARED_LOG_LEVEL="${CLOUDFLARED_LOG_LEVEL:-info}"
CLOUDFLARED_TUNNEL_TOKEN="${CLOUDFLARED_TUNNEL_TOKEN:-}"
CLOUDFLARED_PUBLIC_URL="${CLOUDFLARED_PUBLIC_URL:-}"
RUNTIME_PUBLIC_URL_FILE="${ROOT_DIR}/.runtime-public-base-url"
SERVER_LOG="$(mktemp)"
TUNNEL_LOG="$(mktemp)"
SERVER_PID=""
TUNNEL_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${TUNNEL_PID}" ]] && kill -0 "${TUNNEL_PID}" 2>/dev/null; then
    kill "${TUNNEL_PID}" 2>/dev/null || true
    wait "${TUNNEL_PID}" 2>/dev/null || true
  fi
  rm -f "${RUNTIME_PUBLIC_URL_FILE}"
  rm -f "${SERVER_LOG}" "${TUNNEL_LOG}"
}

trap cleanup EXIT INT TERM

if ! command -v "${CLOUDFLARED_BIN}" >/dev/null 2>&1; then
  echo "cloudflared is not installed or not on PATH." >&2
  exit 1
fi

start_server() {
  (
    cd "${ROOT_DIR}"
    PORT="${PORT}" PUBLIC_BASE_URL="${1:-}" node server.js
  ) >"${SERVER_LOG}" 2>&1 &
  SERVER_PID=$!
}

wait_for_local_server() {
  local attempts=0
  while (( attempts < 60 )); do
    if curl --max-time 2 -fsS "http://${HOST_BIND}:${PORT}/" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
      echo "Local server exited unexpectedly:" >&2
      cat "${SERVER_LOG}" >&2
      return 1
    fi
    sleep 0.5
    attempts=$((attempts + 1))
  done
  echo "Timed out waiting for local server on http://${HOST_BIND}:${PORT}" >&2
  cat "${SERVER_LOG}" >&2
  return 1
}

extract_public_url() {
  grep -Eo 'https://[^[:space:]]+' "${TUNNEL_LOG}" \
    | tr -d '\r' \
    | sed 's#[",].*$##' \
    | grep -E 'trycloudflare\.com|cfargotunnel\.com' \
    | tail -n 1
}

start_tunnel() {
  local -a command
  if [[ -n "${CLOUDFLARED_TUNNEL_TOKEN}" ]]; then
    command=(
      "${CLOUDFLARED_BIN}" tunnel run
      --token "${CLOUDFLARED_TUNNEL_TOKEN}"
      --protocol "${CLOUDFLARED_PROTOCOL}"
      --edge-ip-version "${CLOUDFLARED_EDGE_IP_VERSION}"
      --loglevel "${CLOUDFLARED_LOG_LEVEL}"
      --no-autoupdate
    )
  else
    command=(
      "${CLOUDFLARED_BIN}" tunnel
      --url "http://${HOST_BIND}:${PORT}"
      --protocol "${CLOUDFLARED_PROTOCOL}"
      --edge-ip-version "${CLOUDFLARED_EDGE_IP_VERSION}"
      --loglevel "${CLOUDFLARED_LOG_LEVEL}"
      --no-autoupdate
    )
  fi

  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL "${command[@]}" >"${TUNNEL_LOG}" 2>&1 &
  else
    "${command[@]}" >"${TUNNEL_LOG}" 2>&1 &
  fi
  TUNNEL_PID=$!
}

if [[ -n "${CLOUDFLARED_TUNNEL_TOKEN}" && -z "${CLOUDFLARED_PUBLIC_URL}" ]]; then
  echo "CLOUDFLARED_PUBLIC_URL is required when using CLOUDFLARED_TUNNEL_TOKEN." >&2
  exit 1
fi

rm -f "${RUNTIME_PUBLIC_URL_FILE}"

MODE="quick"
PUBLIC_URL=""
if [[ -n "${CLOUDFLARED_TUNNEL_TOKEN}" ]]; then
  MODE="named"
  PUBLIC_URL="${CLOUDFLARED_PUBLIC_URL%/}"
fi

echo "Starting local server on http://${HOST_BIND}:${PORT}"
start_server "${PUBLIC_URL}"
wait_for_local_server

if [[ "${MODE}" == "named" ]]; then
  echo "Opening Cloudflare named tunnel"
else
  echo "Opening Cloudflare quick tunnel"
fi
start_tunnel

if [[ "${MODE}" == "quick" ]]; then
  for _ in $(seq 1 120); do
    if ! kill -0 "${TUNNEL_PID}" 2>/dev/null; then
      echo "cloudflared exited unexpectedly:" >&2
      cat "${TUNNEL_LOG}" >&2
      exit 1
    fi
    PUBLIC_URL="$(extract_public_url || true)"
    if [[ -n "${PUBLIC_URL}" ]]; then
      break
    fi
    sleep 0.5
  done

  if [[ -z "${PUBLIC_URL}" ]]; then
    echo "Timed out waiting for the Cloudflare tunnel URL." >&2
    echo "Recent cloudflared logs:" >&2
    tail -n 60 "${TUNNEL_LOG}" >&2
    exit 1
  fi

  echo "Tunnel ready at ${PUBLIC_URL}"
  printf '%s\n' "${PUBLIC_URL}" > "${RUNTIME_PUBLIC_URL_FILE}"
  echo "Runtime public URL saved without restarting the local server"
else
  echo "Named tunnel running at ${PUBLIC_URL}"
fi

cat <<EOF

Share these URLs:
  Play: ${PUBLIC_URL}/play
  Audience Poll: ${PUBLIC_URL}/audience-poll
  Quiz Host: ${PUBLIC_URL}/host
  Quiz Screen: ${PUBLIC_URL}/screen
  Hot Seat Host: ${PUBLIC_URL}/hotseat-host
  Hot Seat Screen: ${PUBLIC_URL}/hotseat-screen

Local operator URL:
  http://${HOST_BIND}:${PORT}/host

Press Ctrl+C to stop both the local server and the Cloudflare tunnel.
EOF

wait "${TUNNEL_PID}"
