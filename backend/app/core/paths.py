"""Single source of truth for filesystem paths (must match StaticFiles mount in main.py)."""
import os

# backend/app/core/paths.py -> backend/
BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
UPLOADS_DIR = os.path.join(BACKEND_ROOT, "uploads")
