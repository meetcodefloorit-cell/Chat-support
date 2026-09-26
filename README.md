# Chat Support System

Real-time multi-role support platform with separate Admin, Operator, and Member workspaces.

## What this project includes

- FastAPI backend with PostgreSQL and Alembic migrations
- Next.js frontend (Admin, Operator, Member panels)
- WebSocket live chat (messages, presence, typing, read updates)
- Role-based access control and project-scoped assignment logic
- Docker Compose deployment with Nginx reverse proxy

## Panels and routes

- Admin login: `/admin/login`
- Admin dashboard: `/admin/dashboard`
- Operator login: `/operator/login`
- Operator dashboard: `/operator/{uid}`
- Member login: `/member/login`
- Member dashboard: `/member/{uid}`

## Tech stack

- Backend: Python, FastAPI, SQLAlchemy, Alembic, PostgreSQL
- Frontend: Next.js 14, React, TypeScript, Tailwind CSS
- Infra: Docker, Docker Compose, Nginx

## Local development (without Docker)

### Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\\Scripts\\activate
# Linux/macOS:
# source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend dev app runs on `http://localhost:3000` (or your configured port).

## Docker deployment

### 1) Configure environment

```bash
cd deploy
cp .env.example .env
```

Set at least these values in `deploy/.env`:

- `POSTGRES_PASSWORD`
- `JWT_SECRET_KEY`
- `SUPER_ADMIN_PASSWORD`
- `SUPER_ADMIN_EMAIL`
- `CORS_ORIGINS` (example: `https://89.116.228.210` or `https://YOUR_DOMAIN`)
- `NGINX_PORT_BIND=127.0.0.1:4746:83` (internal host-local bridge behind host TLS reverse proxy)
- `SEED_DEMO_PROJECTS=false` for production
- `DB_POOL_SIZE=20`
- `DB_MAX_OVERFLOW=40`
- `DB_POOL_TIMEOUT=30`
- `DB_POOL_RECYCLE_SECONDS=1800`
- `REQUIRE_DB_AT_HEAD=true`

### 2) Build and start

```bash
cd deploy
docker compose up -d --build
docker compose exec backend alembic upgrade head
```

### 3) Verify

```bash
docker compose ps
docker compose logs --tail=120 backend
docker compose logs --tail=120 frontend
docker compose logs --tail=120 nginx
docker compose exec backend alembic current
curl -sS https://89.116.228.210/health
```

Public app URL (current VPS): `https://89.116.228.210/`

If you later attach a domain, use that HTTPS root URL instead. Do not open `:4746`
in the browser; it is only the internal host-local bridge from host nginx to docker nginx.

Expected steady-state result:

- `deploy-frontend-1` should become `healthy`
- `deploy-backend-1` should stay `healthy`
- `curl -sS https://89.116.228.210/health` should return `{"status":"ok"}`
- brief nginx upstream/DNS errors during boot are acceptable, but they should stop once services are healthy

## Production update flow

```bash
cd /opt/chat-support
git pull origin main
cd deploy
docker compose up -d --build
docker compose exec backend alembic upgrade head
```

## Notes

- Always run `alembic upgrade head` after pulling new code.
- Keep `deploy/.env` private and never commit secrets.
- Change seeded/default credentials immediately in production.
- Current VPS TLS terminates in host nginx site `/etc/nginx/sites-available/chat-support-ip`
  and proxies to the docker nginx bridge at `http://127.0.0.1:4746`.
- SSL recovery and renewal steps live in `deploy/SSL_RUNBOOK.md`.
- Versioned renewal assets are in `deploy/ops/` and can be installed on the VPS with `install`.
