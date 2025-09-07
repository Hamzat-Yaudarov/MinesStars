#!/usr/bin/env bash
set -euo pipefail

# Run this on the production server (Railway deploy script) to apply migrations
# Usage: ./scripts/run-migrations.sh

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Generating Prisma client..."
npx prisma generate

echo "Done."
