#!/usr/bin/env bash
#
# ReWallet — arranque local en un comando.
#
#   ./dev.sh up       levanta todo (install, env, Postgres, migrate, seed, dev)
#   ./dev.sh setup    prepara todo menos los servidores
#   ./dev.sh down     detiene los servidores y Postgres
#   ./dev.sh reset    borra la base y la vuelve a crear desde cero
#   ./dev.sh check    verifica que todo esté sano
#   ./dev.sh logs     sigue los logs de la API
#
# Funciona desde cualquier directorio: se resuelve a la raíz del monorepo.
#
set -euo pipefail

# ── rutas ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
cd "$ROOT"

# ── presentacion ─────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[34m'; C=$'\033[36m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=""; G=""; Y=""; B=""; C=""; D=""; N=""
fi
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# ── pnpm ─────────────────────────────────────────────────────────────────────
# El shim de corepack en ~/.local/bin/pnpm solo funciona DENTRO del monorepo:
# lee el campo "packageManager" de package.json. Fuera de ahi cae a un default
# que el corepack del sistema no sabe lanzar y revienta con MODULE_NOT_FOUND.
# Por eso probamos candidatos hasta encontrar uno que responda a `-v`.
resolve_pnpm() {
  local candidates=()
  [ -n "${PNPM_BIN:-}" ] && candidates+=("$PNPM_BIN")
  candidates+=("$HOME/.npm-global/bin/pnpm")
  local onpath
  onpath="$(command -v pnpm 2>/dev/null || true)"
  [ -n "$onpath" ] && candidates+=("$onpath")

  for c in "${candidates[@]}"; do
    if [ -x "$c" ] && "$c" -v >/dev/null 2>&1; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}

PNPM="$(resolve_pnpm || true)"
[ -n "$PNPM" ] || die "no encuentro un pnpm funcional. Instalalo con: npm i -g pnpm@9"

# ── precondiciones ───────────────────────────────────────────────────────────
require_node() {
  command -v node >/dev/null 2>&1 || die "falta node (20+)"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "node $major es demasiado viejo, hace falta 20+"
  ok "node $(node -v)"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "falta docker"
  docker info >/dev/null 2>&1 || die "el daemon de docker no corre. Levantalo con: sudo systemctl start docker"
  ok "docker $(docker -v | head -1 | cut -d, -f1)"
}

# ── pasos ────────────────────────────────────────────────────────────────────
do_install() {
  step "Instalando dependencias"
  "$PNPM" install
  ok "instalado ($(node -p "require('./package.json').packageManager"))"
}

do_env() {
  step "Configurando .env"
  if [ -f .env ]; then
    ok ".env ya existe"
  else
    cp .env.example .env
    local secret
    secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    # BSD/GNU sed-safe replacement
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|" .env
    else
      sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|" .env
    fi
    ok ".env creado con un SESSION_SECRET nuevo"
  fi
  grep -qE '^SESSION_SECRET=.+' .env || warn "SESSION_SECRET vacio en .env"
  grep -qE '^MONAD_CHAIN_ID=.+' .env || warn "MONAD_CHAIN_ID vacio en .env (143 mainnet / 10143 testnet)"
}

do_db_up() {
  step "Levantando Postgres"
  docker compose up -d >/dev/null
  local i
  for i in $(seq 1 40); do
    if docker exec bestpath-postgres pg_isready -U bestpath -d bestpath >/dev/null 2>&1; then
      ok "postgres listo (puerto 5432)"
      return 0
    fi
    sleep 1
  done
  die "postgres no respondio en 40s. Mirá los logs con: docker logs bestpath-postgres"
}

do_migrate() {
  step "Aplicando migraciones"
  "$PNPM" db:migrate >/dev/null 2>&1 || die "fallo la migracion. Corré: $PNPM db:migrate"
  local tables
  tables="$(docker exec bestpath-postgres psql -U bestpath -d bestpath -tAc \
    "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>/dev/null | tr -d '[:space:]' || echo 0)"
  ok "schema aplicado ($tables tablas)"
}

do_seed() {
  step "Sembrando datos de desarrollo"
  "$PNPM" db:seed >/dev/null 2>&1 && ok "datos de demo listos" || warn "el seed fallo (no es bloqueante)"
}

do_dev() {
  cat <<EOF

${C}────────────────────────────────────────────────────────────${N}
 ${B}ReWallet${N} — levantado

 ${C}web${N}  http://127.0.0.1:5173     (el prototipo, datos simulados)
 ${C}api${N}  http://127.0.0.1:3000/health

 ${D}Para probar la API:${N}
 ${D}  curl localhost:3000/wallet                                    # 401, correcto${N}
 ${D}  curl -H 'Cookie: bp_session=dev-seed-session-token' \\
 ${D}       localhost:3000/wallet                                   # 200${N}

 ${D}Ctrl+C para detener.${N}
${C}────────────────────────────────────────────────────────────${N}

EOF
  exec "$PNPM" dev
}

do_check() {
  require_node; require_docker
  printf '\n%s── verificacion ──%s\n\n' "$C" "$N"
  printf '  pnpm           %s (%s)\n' "$("$PNPM" -v)" "$PNPM"
  printf '  docker         %s\n' "$(docker ps --filter name=bestpath-postgres --format '{{.Status}}' 2>/dev/null || echo 'no corriendo')"
  local t
  t="$(docker exec bestpath-postgres psql -U bestpath -d bestpath -tAc \
    "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>/dev/null | tr -d '[:space:]' || echo 0)"
  printf '  tablas         %s\n' "${t:-0}"
  printf '  .env           %s\n' "$([ -f .env ] && echo presente || echo FALTA)"
  printf '  api            %s\n' "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health 2>/dev/null || echo 'no corre')"
  printf '  web            %s\n' "$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null || echo 'no corre')"
  printf '\n'
}

do_down() {
  step "Deteniendo"
  pkill -f "tsx watch src/index.ts" 2>/dev/null && ok "api detenida" || true
  pkill -f "vite" 2>/dev/null && ok "web detenida" || true
  docker compose stop >/dev/null 2>&1 && ok "postgres detenido" || true
}

do_reset() {
  step "Reseteando la base"
  docker compose down -v >/dev/null 2>&1
  ok "volumen borrado"
  do_db_up
  do_migrate
  do_seed
}

# ── dispatch ─────────────────────────────────────────────────────────────────
case "${1:-up}" in
  up)
    require_node; require_docker
    do_install; do_env; do_db_up; do_migrate; do_seed; do_dev
    ;;
  setup)
    require_node; require_docker
    do_install; do_env; do_db_up; do_migrate; do_seed
    printf '\n%sListo.%s Levantá con: %s./dev.sh up%s\n\n' "$G" "$N" "$B" "$N"
    ;;
  down)   do_down ;;
  reset)  require_docker; do_reset ;;
  check)  do_check ;;
  logs)   tail -f apps/api/*.log 2>/dev/null || echo "no hay logs; los de la api van a consola" ;;
  *)
    printf 'uso: %s {up|setup|down|reset|check|logs}\n' "$0"
    exit 1
    ;;
esac
