#!/usr/bin/env bash

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker before running this script." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required." >&2
  exit 1
fi

if [[ ! -f ".env.prod" || ! -f ".env.dev" ]]; then
  echo "Create .env.prod and .env.dev (copy from .env.example) before bootstrap." >&2
  exit 1
fi

export PROD_IMAGE="${PROD_IMAGE:-nginx:alpine}"
export DEV_IMAGE="${DEV_IMAGE:-nginx:alpine}"

docker compose -f docker-compose.yml up -d nginx
docker compose -f docker-compose.yml ps
