# Deployment Notes

Current public app URL:

- `https://89.116.228.210/`

Current VPS reverse-proxy layout:

- Host nginx TLS site file: `/etc/nginx/sites-available/chat-support-ip`
- Enabled symlink: `/etc/nginx/sites-enabled/chat-support-ip`
- Host nginx proxies `https://89.116.228.210/` to `http://127.0.0.1:4746`
- Docker nginx listens on container port `83`
- Docker Compose binds docker nginx to `127.0.0.1:4746:83`

Operational rules:

- Keep `NEXT_PUBLIC_API_BASE` and `NEXT_PUBLIC_WS_BASE` unset in production for same-origin routing.
- Set `CORS_ORIGINS=https://89.116.228.210` unless you later move to a domain.
- Do not open `:4746` in the browser. It is an internal host-local bridge only.

Useful checks:

```bash
curl -sS https://89.116.228.210/health
docker compose ps
docker compose logs --tail=120 nginx
docker compose logs --tail=120 frontend
```

SSL operations assets:

- Runbook: `deploy/SSL_RUNBOOK.md`
- Renewal script: `deploy/ops/renew-chat-support-ip-ssl.sh`
- systemd unit: `deploy/ops/renew-chat-support-ip-ssl.service`
- systemd timer: `deploy/ops/renew-chat-support-ip-ssl.timer`
