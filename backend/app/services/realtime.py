"""In-memory WebSocket hub used for live notifications and direct messages.
Single-process only; use Supabase Realtime or Redis pub/sub if you scale to many workers."""
import asyncio
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.conns: dict[str, set[WebSocket]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.conns[user_id].add(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        self.conns[user_id].discard(ws)

    async def _send(self, user_id: str, payload: dict) -> None:
        for ws in list(self.conns.get(user_id, ())):
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(user_id, ws)

    def push(self, user_id: str, payload: dict) -> None:
        """Thread-safe: callable from sync endpoints running in the threadpool."""
        if self.loop and self.conns.get(user_id):
            asyncio.run_coroutine_threadsafe(self._send(user_id, payload), self.loop)


manager = ConnectionManager()
