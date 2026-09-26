# SSL Runbook

Public app URL:

- `https://89.116.228.210/`

Current TLS layout:

- host nginx terminates TLS on `443`
- host nginx site file: `/etc/nginx/sites-available/chat-support-ip`
- enabled symlink: `/etc/nginx/sites-enabled/chat-support-ip`
- host nginx proxies to docker nginx on `http://127.0.0.1:4746`
- docker nginx stays internal-only; never open `:4746` in the browser

Current certificate files:

- `/etc/letsencrypt/live/89.116.228.210/fullchain.pem`
- `/etc/letsencrypt/live/89.116.228.210/privkey.pem`

## Detect an expired or broken certificate

From the VPS:

```bash
openssl x509 -in /etc/letsencrypt/live/89.116.228.210/fullchain.pem -noout -dates
curl -Iv https://89.116.228.210/
curl -sS https://89.116.228.210/health
```

Expected:

- `curl -Iv` succeeds with a valid certificate chain
- `curl -sS https://89.116.228.210/health` returns `{"status":"ok"}`

## Manual recovery

Install the versioned renewal assets:

```bash
sudo install -m 0755 deploy/ops/renew-chat-support-ip-ssl.sh /usr/local/bin/renew-chat-support-ip-ssl
sudo install -m 0644 deploy/ops/renew-chat-support-ip-ssl.service /etc/systemd/system/renew-chat-support-ip-ssl.service
sudo install -m 0644 deploy/ops/renew-chat-support-ip-ssl.timer /etc/systemd/system/renew-chat-support-ip-ssl.timer
sudo systemctl daemon-reload
sudo systemctl enable --now renew-chat-support-ip-ssl.timer
```

Run the renewal script manually:

```bash
sudo /usr/local/bin/renew-chat-support-ip-ssl
```

The script:

- renews the short-lived IP certificate only when it is close to expiry
- validates the certificate files before nginx reload
- reloads host nginx only after `nginx -t` succeeds
- verifies public health after reload

## Quick troubleshooting

Check host nginx:

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo systemctl reload nginx
```

Check renewal timer:

```bash
sudo systemctl status renew-chat-support-ip-ssl.timer --no-pager
sudo systemctl list-timers --all | grep renew-chat-support-ip-ssl
```

Check docker-side app health:

```bash
cd /opt/chat-support/deploy
docker compose ps
docker compose logs --tail=120 nginx
docker compose logs --tail=120 frontend
docker compose logs --tail=120 backend
curl -sS https://89.116.228.210/health
```

## Notes

- The current certificate uses Let's Encrypt short-lived IP certs, so it must be renewed more frequently than a normal domain certificate.
- Keep production frontend routing same-origin:
  - `NEXT_PUBLIC_API_BASE` unset
  - `NEXT_PUBLIC_WS_BASE` unset
- Keep `CORS_ORIGINS=https://89.116.228.210` until you move to a domain.
