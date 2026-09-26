from fastapi import APIRouter

from app.api.routes import admin, analytics, auth, chat_history, chat_sessions, conversations, operator, projects, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(projects.router)
api_router.include_router(admin.router)
api_router.include_router(operator.router)
api_router.include_router(conversations.router)
api_router.include_router(analytics.router)
api_router.include_router(chat_sessions.router)
api_router.include_router(chat_history.router)
