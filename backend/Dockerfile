FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8000

# Run migrations, then start Uvicorn immediately so /health responds for Docker healthchecks.
# Seed runs in the background so a slow or heavy seed cannot block the API from listening.
CMD ["sh", "-c", "alembic upgrade head || exit 1; (python scripts/seed.py || true) & exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
