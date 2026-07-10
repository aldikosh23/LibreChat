#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${LIBRECHAT_APP_DIR:-/home/ubuntu/librechat-aigate}"
SOURCE_DIR="$APP_DIR/source"
AIGATE_DIR="${AIGATE_APP_DIR:-/home/ubuntu/aigate}"
AIGATE_SERVICE_NAME="${AIGATE_SERVICE_NAME:-aigate}"
AIGATE_BLUE_PORT="${AIGATE_BLUE_PORT:-18789}"
AIGATE_GREEN_PORT="${AIGATE_GREEN_PORT:-18790}"
CADDYFILE="${AIGATE_CADDYFILE:-/etc/caddy/Caddyfile}"
PUBLIC_URL="${LIBRECHAT_PUBLIC_URL:-https://chat.aigate.shop}"
PORT="${LIBRECHAT_PORT:-3080}"
MONGO_STABILITY_SECONDS="${LIBRECHAT_MONGO_STABILITY_SECONDS:-75}"
REPO="${DEPLOY_REPO:?DEPLOY_REPO is required}"
BRANCH="${DEPLOY_BRANCH:?DEPLOY_BRANCH is required}"
SHA="${DEPLOY_SHA:?DEPLOY_SHA is required}"
IMAGE_NAME="aigate-librechat:$SHA"
BACKUP_SCRIPT="$SOURCE_DIR/ops/backup-aigate-production.sh"
SMOKE_SCRIPT="$SOURCE_DIR/ops/smoke-aigate-production.sh"
rollback_dir=""
rollback_ready=false
deploy_complete=false
caddy_added=false
caddy_backup=""
aigate_env_changed=false

case "$APP_DIR" in
  /home/ubuntu/librechat-aigate|/home/ubuntu/librechat-aigate/*) ;;
  *) echo "unsafe APP_DIR: $APP_DIR" >&2; exit 64 ;;
esac
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "DEPLOY_SHA must be an exact 40-character commit." >&2
  exit 64
fi
if [[ ! "$MONGO_STABILITY_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "LIBRECHAT_MONGO_STABILITY_SECONDS must be a positive integer." >&2
  exit 64
fi

random_hex() {
  openssl rand -hex "${1:-32}"
}

set_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  local escaped
  escaped="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}='${escaped}'|" "$file"
  else
    printf "%s='%s'\n" "$key" "$escaped" >> "$file"
  fi
}

ensure_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  if ! grep -q "^${key}=" "$file" 2>/dev/null; then
    set_env "$key" "$value" "$file"
  fi
}

get_env() {
  local key="$1"
  local file="$2"
  local value
  value="$(sed -n "s/^${key}=//p" "$file" 2>/dev/null | tail -1)"
  if [[ "$value" == \'*\' ]] || [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

wait_url() {
  local url="$1"
  local attempts="${2:-60}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

require_stable_container() {
  local name="$1"
  local seconds="$2"
  local restarts_before restarts_after status health
  restarts_before="$(docker inspect "$name" --format '{{.RestartCount}}')"
  sleep "$seconds"
  restarts_after="$(docker inspect "$name" --format '{{.RestartCount}}')"
  status="$(docker inspect "$name" --format '{{.State.Status}}')"
  health="$(docker inspect "$name" --format '{{.State.Health.Status}}')"
  if [ "$status" != running ] || [ "$health" != healthy ] || [ "$restarts_after" != "$restarts_before" ]; then
    echo "$name was not stable for ${seconds}s: status=$status health=$health restarts=$restarts_before->$restarts_after" >&2
    return 1
  fi
}

active_aigate_slot() {
  if sudo grep -q "127[.]0[.]0[.]1:$AIGATE_GREEN_PORT" "$CADDYFILE" 2>/dev/null; then
    printf 'green %s\n' "$AIGATE_GREEN_PORT"
  else
    printf 'blue %s\n' "$AIGATE_BLUE_PORT"
  fi
}

restart_active_aigate_slot() {
  local slot port
  read -r slot port < <(active_aigate_slot)
  sudo systemctl restart "$AIGATE_SERVICE_NAME@$slot"
  wait_url "http://127.0.0.1:$port/" 60
}

ensure_caddy_site() {
  local host
  host="$(printf '%s' "$PUBLIC_URL" | sed -E 's#^https?://([^/]+).*#\1#')"
  if grep -q "^${host} {" "$CADDYFILE"; then
    return
  fi

  caddy_backup="/home/ubuntu/deploy-backups/caddy-librechat-$(date +%Y%m%d%H%M%S)"
  sudo mkdir -p /home/ubuntu/deploy-backups
  sudo cp "$CADDYFILE" "$caddy_backup"
  sudo tee -a "$CADDYFILE" >/dev/null <<EOF

${host} {
	import site_security
	reverse_proxy 127.0.0.1:${PORT} {
		header_up Host {host}
		header_up X-Real-IP {http.request.remote.host}
		header_up X-Forwarded-For {http.request.remote.host}
		header_up X-Forwarded-Proto {scheme}
	}
}
EOF
  if ! sudo caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null || \
    ! sudo systemctl reload caddy; then
    sudo cp "$caddy_backup" "$CADDYFILE"
    sudo systemctl reload caddy || true
    return 1
  fi
  caddy_added=true
}

backup_runtime_file() {
  local name="$1"
  if [ -f "$APP_DIR/$name" ]; then
    cp -a "$APP_DIR/$name" "$rollback_dir/$name"
    touch "$rollback_dir/$name.exists"
  fi
}

restore_runtime_file() {
  local name="$1"
  if [ -f "$rollback_dir/$name.exists" ]; then
    cp -a "$rollback_dir/$name" "$APP_DIR/$name"
  else
    rm -f "$APP_DIR/$name"
  fi
}

rollback_release() {
  local failed=0
  echo "deploy failed: restoring previous LibreChat release" >&2

  restore_runtime_file .env
  restore_runtime_file docker-compose.yml
  restore_runtime_file librechat.yaml

  if [ -f "$rollback_dir/aigate.env.local.exists" ]; then
    cp -a "$rollback_dir/aigate.env.local" "$AIGATE_DIR/.env.local"
  elif [ "$aigate_env_changed" = true ]; then
    rm -f "$AIGATE_DIR/.env.local"
  fi

  if [ -n "$(get_env LIBRECHAT_IMAGE "$APP_DIR/.env")" ]; then
    local rollback_compose=(docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml")
    "${rollback_compose[@]}" up -d --wait --wait-timeout 240 || failed=1
    wait_url "http://127.0.0.1:${PORT}/health" 60 || failed=1
  else
    echo "rollback unavailable: no previous LibreChat image" >&2
    failed=1
  fi

  if [ "$aigate_env_changed" = true ]; then
    restart_active_aigate_slot || failed=1
  fi
  if [ "$caddy_added" = true ]; then
    sudo cp "$caddy_backup" "$CADDYFILE" || failed=1
    sudo systemctl reload caddy || failed=1
  fi
  bash "$SMOKE_SCRIPT" || failed=1
  return "$failed"
}

on_exit() {
  local status="$?"
  local rollback_status=0
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$rollback_ready" = true ] && [ "$deploy_complete" != true ]; then
    set +e
    rollback_release
    rollback_status="$?"
  fi
  if [ -n "$rollback_dir" ]; then
    rm -rf "$rollback_dir"
  fi
  if [ "$rollback_status" -ne 0 ]; then
    echo "CRITICAL: LibreChat rollback or rollback smoke failed" >&2
    status=1
  fi
  exit "$status"
}
trap on_exit EXIT

mkdir -p "$APP_DIR"

if [ ! -d "$SOURCE_DIR/.git" ]; then
  rm -rf "$SOURCE_DIR"
  git clone "$REPO" "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"
git fetch --prune origin "$BRANCH"
git cat-file -e "$SHA^{commit}"
if ! git merge-base --is-ancestor "$SHA" FETCH_HEAD; then
  echo "DEPLOY_SHA $SHA is not part of fetched branch $BRANCH." >&2
  exit 1
fi
git checkout --force -B "$BRANCH" "$SHA"
if [ "$(git rev-parse HEAD)" != "$SHA" ]; then
  echo "checked out source does not match DEPLOY_SHA $SHA" >&2
  exit 1
fi

mkdir -p "$APP_DIR/images" "$APP_DIR/uploads" "$APP_DIR/logs" "$APP_DIR/skill"
bash "$BACKUP_SCRIPT"

umask 077
rollback_dir="$(mktemp -d "$APP_DIR/.deploy-rollback.XXXXXX")"
backup_runtime_file .env
backup_runtime_file docker-compose.yml
backup_runtime_file librechat.yaml
if [ -f "$AIGATE_DIR/.env.local" ]; then
  cp -a "$AIGATE_DIR/.env.local" "$rollback_dir/aigate.env.local"
  touch "$rollback_dir/aigate.env.local.exists"
fi
rollback_ready=true

cp "$SOURCE_DIR/ops/aigate-compose.yml" "$APP_DIR/docker-compose.yml"
cp "$SOURCE_DIR/librechat.aigate.yaml" "$APP_DIR/librechat.yaml"
touch "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

set_env LIBRECHAT_IMAGE "$IMAGE_NAME" "$APP_DIR/.env"
set_env LIBRECHAT_PORT "$PORT" "$APP_DIR/.env"
set_env DOMAIN_CLIENT "$PUBLIC_URL" "$APP_DIR/.env"
set_env DOMAIN_SERVER "$PUBLIC_URL" "$APP_DIR/.env"
set_env AIGATE_SSO_CLAIM_URL "https://aigate.shop/api/chat/sso/claim" "$APP_DIR/.env"
set_env AIGATE_BALANCE_URL "https://api.aigate.shop/v1/balance" "$APP_DIR/.env"
set_env AIGATE_API_BASE_URL "https://api.aigate.shop/v1" "$APP_DIR/.env"
set_env AIGATE_ENDPOINT_NAME "AIGate" "$APP_DIR/.env"
set_env ENDPOINTS "custom" "$APP_DIR/.env"
set_env ALLOW_REGISTRATION "false" "$APP_DIR/.env"
set_env ALLOW_EMAIL_LOGIN "false" "$APP_DIR/.env"
set_env ALLOW_SOCIAL_LOGIN "false" "$APP_DIR/.env"
set_env ALLOW_PASSWORD_RESET "false" "$APP_DIR/.env"
set_env ALLOW_UNVERIFIED_EMAIL_LOGIN "true" "$APP_DIR/.env"
set_env MEILI_NO_ANALYTICS "true" "$APP_DIR/.env"

ensure_env JWT_SECRET "$(random_hex 32)" "$APP_DIR/.env"
ensure_env JWT_REFRESH_SECRET "$(random_hex 32)" "$APP_DIR/.env"
ensure_env CREDS_KEY "$(random_hex 32)" "$APP_DIR/.env"
ensure_env CREDS_IV "$(random_hex 16)" "$APP_DIR/.env"
ensure_env MEILI_MASTER_KEY "$(random_hex 32)" "$APP_DIR/.env"
ensure_env RAG_POSTGRES_PASSWORD "$(random_hex 24)" "$APP_DIR/.env"
ensure_env LIBRECHAT_SSO_SECRET "$(random_hex 32)" "$APP_DIR/.env"
if [ -n "${LIBRECHAT_RAG_ENABLED:-}" ]; then
  set_env LIBRECHAT_RAG_ENABLED "$LIBRECHAT_RAG_ENABLED" "$APP_DIR/.env"
else
  ensure_env LIBRECHAT_RAG_ENABLED "false" "$APP_DIR/.env"
fi
if [ -n "${RAG_OPENAI_API_KEY:-}" ]; then
  set_env RAG_OPENAI_API_KEY "$RAG_OPENAI_API_KEY" "$APP_DIR/.env"
fi

rag_enabled="$(get_env LIBRECHAT_RAG_ENABLED "$APP_DIR/.env")"
export COMPOSE_PROFILES=""
compose=(docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml")
case "$rag_enabled" in
  true)
    if [ -z "$(get_env RAG_OPENAI_API_KEY "$APP_DIR/.env")" ]; then
      echo "RAG_OPENAI_API_KEY is required when LIBRECHAT_RAG_ENABLED=true." >&2
      exit 1
    fi
    ensure_env RAG_PORT "8000" "$APP_DIR/.env"
    set_env RAG_API_URL "http://rag_api:$(get_env RAG_PORT "$APP_DIR/.env")" "$APP_DIR/.env"
    compose+=(--profile rag)
    ;;
  false|"")
    set_env RAG_API_URL "" "$APP_DIR/.env"
    ;;
  *)
    echo "LIBRECHAT_RAG_ENABLED must be true or false." >&2
    exit 1
    ;;
esac

SSO_SECRET="$(get_env LIBRECHAT_SSO_SECRET "$APP_DIR/.env")"
if [ -z "$SSO_SECRET" ]; then
  echo "LIBRECHAT_SSO_SECRET is missing" >&2
  exit 67
fi

if [ -f "$AIGATE_DIR/.env.local" ]; then
  aigate_env_before="$(sha256sum "$AIGATE_DIR/.env.local")"
  set_env LIBRECHAT_URL "$PUBLIC_URL" "$AIGATE_DIR/.env.local"
  set_env LIBRECHAT_SSO_SECRET "$SSO_SECRET" "$AIGATE_DIR/.env.local"
  if [ "$(sha256sum "$AIGATE_DIR/.env.local")" != "$aigate_env_before" ]; then
    aigate_env_changed=true
  fi
fi

DOCKER_BUILDKIT=1 docker build -t "$IMAGE_NAME" "$SOURCE_DIR"
"${compose[@]}" up -d --wait --wait-timeout 240
require_stable_container librechat-aigate-mongodb "$MONGO_STABILITY_SECONDS"
wait_url "http://127.0.0.1:${PORT}/health" 60

if [ "$rag_enabled" != true ]; then
  docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml" \
    --profile rag stop rag_api vectordb || true
  docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml" \
    --profile rag rm -f rag_api vectordb || true
fi

ensure_caddy_site
if [ "$aigate_env_changed" = true ]; then
  restart_active_aigate_slot
fi
bash "$SMOKE_SCRIPT"

deploy_complete=true
docker ps --filter name=librechat-aigate --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
