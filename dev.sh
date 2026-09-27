#!/usr/bin/env bash
# Wrapper para levantar el proyecto desde la carpeta ReWALLET/ sin tener que
# entrar a bestpath/. El problema que resuelve: el shim de corepack de pnpm solo
# lee el campo "packageManager" dentro del monorepo, asi que corridas desde aca
# fallan con MODULE_NOT_FOUND.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bestpath/dev.sh" "$@"
