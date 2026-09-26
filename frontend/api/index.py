import sys
import os

backend_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend_src")
if os.path.isdir(backend_src):
    sys.path.insert(0, backend_src)
else:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

from app.main import app  # noqa: E402, F401
