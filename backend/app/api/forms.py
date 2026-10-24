from fastapi import APIRouter

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/forms/...").
router = APIRouter(tags=["forms"])
