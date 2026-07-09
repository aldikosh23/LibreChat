#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${LIBRECHAT_APP_DIR:-/home/ubuntu/librechat-aigate}"
SOURCE_DIR="$APP_DIR/source"
AIGATE_DIR="${AIGATE_APP_DIR:-/home/ubuntu/aigate}"
CADDYFILE="${AIGATE_CADDYFILE:-/etc/caddy/Caddyfile}"
PUBLIC_URL="${LIBRECHAT_PUBLIC_URL:-https://chat.aigate.shop}"
PORT="${LIBRECHAT_PORT:-3080}"
REPO="${DEPLOY_REPO:?DEPLOY_REPO is required}"
BRANCH="${DEPLOY_BRANCH:?DEPLOY_BRANCH is required}"
SHA="${DEPLOY_SHA:-}"
IMAGE_NAME="aigate-librechat:${SHA:-$BRANCH}"

case "$APP_DIR" in
  /home/ubuntu/librechat-aigate|/home/ubuntu/librechat-aigate/*) ;;
  *) echo "unsafe APP_DIR: $APP_DIR" >&2; exit 64 ;;
esac

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

ensure_caddy_site() {
  local host
  host="$(printf '%s' "$PUBLIC_URL" | sed -E 's#^https?://([^/]+).*#\1#')"
  if grep -q "^${host} {" "$CADDYFILE"; then
    return
  fi

  local backup="/home/ubuntu/deploy-backups/caddy-librechat-$(date +%Y%m%d%H%M%S)"
  sudo mkdir -p /home/ubuntu/deploy-backups
  sudo cp "$CADDYFILE" "$backup"
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
  sudo caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null
  if ! sudo systemctl reload caddy; then
    sudo cp "$backup" "$CADDYFILE"
    sudo systemctl reload caddy || true
    exit 1
  fi
}

restart_running_aigate_slots() {
  mapfile -t units < <(systemctl list-units 'aigate@*.service' --state=running --no-legend --no-pager | awk '{print $1}')
  for unit in "${units[@]}"; do
    sudo systemctl restart "$unit"
  done
}

mkdir -p "$APP_DIR"

if [ ! -d "$SOURCE_DIR/.git" ]; then
  rm -rf "$SOURCE_DIR"
  git clone "$REPO" "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
if [ -n "$SHA" ]; then
  git checkout "$SHA"
fi

mkdir -p "$APP_DIR/images" "$APP_DIR/uploads" "$APP_DIR/logs" "$APP_DIR/skill"
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

SSO_SECRET="$(sed -n "s/^LIBRECHAT_SSO_SECRET='\\(.*\\)'$/\\1/p" "$APP_DIR/.env" | tail -1)"
if [ -z "$SSO_SECRET" ]; then
  echo "LIBRECHAT_SSO_SECRET is missing" >&2
  exit 67
fi

if [ -f "$AIGATE_DIR/.env.local" ]; then
  set_env LIBRECHAT_URL "$PUBLIC_URL" "$AIGATE_DIR/.env.local"
  set_env LIBRECHAT_SSO_SECRET "$SSO_SECRET" "$AIGATE_DIR/.env.local"
fi

DOCKER_BUILDKIT=1 docker build -t "$IMAGE_NAME" "$SOURCE_DIR"
docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/docker-compose.yml" up -d

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 2
done

curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null
ensure_caddy_site
restart_running_aigate_slots

docker ps --filter name=librechat-aigate --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
