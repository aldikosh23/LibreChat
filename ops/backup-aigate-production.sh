#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${LIBRECHAT_APP_DIR:-/home/ubuntu/librechat-aigate}"
BACKUP_ROOT="${LIBRECHAT_BACKUP_ROOT:-$APP_DIR/backups}"
RETENTION_DAYS="${LIBRECHAT_BACKUP_RETENTION_DAYS:-14}"
MONGO_CONTAINER="${LIBRECHAT_MONGO_CONTAINER:-librechat-aigate-mongodb}"
DUMP_RETRIES="${LIBRECHAT_BACKUP_DUMP_RETRIES:-15}"

case "$APP_DIR" in
  /home/ubuntu/librechat-aigate|/home/ubuntu/librechat-aigate/*) ;;
  *) echo "unsafe APP_DIR: $APP_DIR" >&2; exit 64 ;;
esac

if [ -z "$BACKUP_ROOT" ] || [ "$BACKUP_ROOT" = "/" ]; then
  echo "unsafe BACKUP_ROOT: $BACKUP_ROOT" >&2
  exit 64
fi
if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || [[ ! "$DUMP_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  echo "backup retention and retry values must be positive integers" >&2
  exit 64
fi

command -v docker >/dev/null
docker info >/dev/null

if ! docker inspect "$MONGO_CONTAINER" >/dev/null 2>&1; then
  if [ -f "$APP_DIR/docker-compose.yml" ]; then
    echo "MongoDB container $MONGO_CONTAINER is missing; refusing an unbacked deploy." >&2
    exit 1
  fi
  echo "backup: no existing LibreChat deployment"
  exit 0
fi

umask 077
mkdir -p "$BACKUP_ROOT"
stamp="$(date -u +%Y%m%d-%H%M%S)"
stage_dir="$(mktemp -d "$BACKUP_ROOT/.librechat-$stamp.XXXXXX")"
backup_dir="$BACKUP_ROOT/librechat-$stamp"
trap 'rm -rf "$stage_dir"' EXIT

dump_ok=false
for _ in $(seq 1 "$DUMP_RETRIES"); do
  if [ "$(docker inspect "$MONGO_CONTAINER" --format '{{.State.Status}}')" = "running" ] && \
    docker exec "$MONGO_CONTAINER" mongodump --archive --gzip > "$stage_dir/mongodb.archive.gz"; then
    dump_ok=true
    break
  fi
  rm -f "$stage_dir/mongodb.archive.gz"
  sleep 2
done

if [ "$dump_ok" != true ]; then
  echo "backup: MongoDB dump failed after $DUMP_RETRIES attempts" >&2
  exit 1
fi
gzip -t "$stage_dir/mongodb.archive.gz"

runtime_files=()
for path in .env librechat.yaml images uploads skill; do
  if [ -e "$APP_DIR/$path" ]; then
    runtime_files+=("$path")
  fi
done
if [ "${#runtime_files[@]}" -gt 0 ]; then
  tar -czf "$stage_dir/runtime-files.tgz" -C "$APP_DIR" -- "${runtime_files[@]}"
  tar -tzf "$stage_dir/runtime-files.tgz" >/dev/null
fi

{
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'mongo_image=%s\n' "$(docker inspect "$MONGO_CONTAINER" --format '{{.Config.Image}}')"
} > "$stage_dir/metadata.txt"

mv "$stage_dir" "$backup_dir"
trap - EXIT
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'librechat-*' \
  -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '.librechat-*' \
  -mtime +1 -print -exec rm -rf {} +
echo "backup: $backup_dir"
