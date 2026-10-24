from fastapi import APIRouter

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/auth/...").
router = APIRouter(tags=["auth"])
