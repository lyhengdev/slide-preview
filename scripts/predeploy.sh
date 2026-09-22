#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @ke/database db:deploy

echo "Migrations applied."