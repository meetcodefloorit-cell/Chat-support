#!/usr/bin/env bash
set -euo pipefail

CERT_NAME="${CERT_NAME:-89.116.228.210}"
HEALTH_URL="${HEALTH_URL:-https://89.116.228.210/health}"
CERT_PATH="/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/${CERT_NAME}/privkey.pem"
RENEW_THRESHOLD_SECONDS="${RENEW_THRESHOLD_SECONDS:-129600}"

log() {
  printf '[renew-chat-support-ip-ssl] %s\n' "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    log "run this script as root"
    exit 1
  fi
}

verify_local_certificate_files() {
  [[ -s "${CERT_PATH}" ]]
  [[ -s "${KEY_PATH}" ]]
  openssl x509 -in "${CERT_PATH}" -noout >/dev/null
}

verify_public_health() {
  curl -fsS "${HEALTH_URL}" >/dev/null
}

renew_if_needed() {
  if [[ -f "${CERT_PATH}" ]] && openssl x509 -checkend "${RENEW_THRESHOLD_SECONDS}" -noout -in "${CERT_PATH}" >/dev/null; then
    log "certificate is still valid beyond threshold; skipping renewal"
    return
  fi

  log "renewing certificate ${CERT_NAME}"
  certbot renew \
    --cert-name "${CERT_NAME}" \
    --preferred-profile shortlived \
    --pre-hook "systemctl stop nginx" \
    --post-hook "systemctl start nginx"
}

reload_nginx() {
  nginx -t
  systemctl reload nginx
}

print_certificate_dates() {
  openssl x509 -in "${CERT_PATH}" -noout -dates
}

main() {
  require_root
  renew_if_needed
  verify_local_certificate_files
  reload_nginx
  print_certificate_dates
  verify_public_health
  log "certificate verification complete"
}

main "$@"
