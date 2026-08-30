#!/usr/bin/with-contenv bashio
set -e

VERSION="$(cat /VERSION 2>/dev/null || echo 0.2.13)"
bashio::log.info "Démarrage de Lotus Colour Automation ${VERSION}"

if python3 /app/install_companion.py; then
  bashio::log.info "Compagnon frontend vérifié"
else
  bashio::log.warning "Le compagnon frontend n'a pas pu être installé; le panneau de diagnostic reste disponible"
fi

exec python3 /app/server.py
