"""Transactional email through Resend or SendGrid.

`send_many` delivers a list of individually addressed messages (each recipient gets their own email with their
own link). Resend is called through its batch endpoint (up to 100 messages per request), which avoids the
2-requests-per-second limit that silently dropped every message after the first one when invites were sent in a
tight loop. Rate-limit (429) and transient (5xx) answers are retried with backoff. If a batch is rejected, the
messages are re-sent one at a time so a single bad address cannot block the others, and every recipient gets
their own result with a readable error.

Returns failure results (and logs) when no provider is configured, so invites still work and the UI can show
the copyable join link instead.
"""
import asyncio
import html
from dataclasses import dataclass

import anyio
import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("email")

RESEND_BATCH_SIZE = 100
MAX_ATTEMPTS = 4


@dataclass
class EmailMessage:
    to: str
    subject: str
    title: str
    body_html: str
    cta_label: str | None = None
    cta_url: str | None = None


@dataclass
class SendResult:
    to: str
    ok: bool
    error: str | None = None


esc = html.escape


def _wrap(title: str, body_html: str, cta_label: str | None = None, cta_url: str | None = None) -> str:
    button = (
        f'<p style="margin:24px 0"><a href="{esc(cta_url, quote=True)}" style="background:#111;color:#fff;padding:10px 18px;'
        f'border-radius:6px;text-decoration:none;font-weight:500">{esc(cta_label or "Open")}</a></p>' if cta_url else ""
    )
    return (
        '<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">'
        f'<h2 style="margin:0 0 12px">{esc(title)}</h2><div style="line-height:1.55;color:#333">{body_html}</div>{button}'
        '<p style="color:#888;font-size:12px">Sent by CPMS</p></div>'
    )


def _sender_address(sender: str) -> str:
    return sender[sender.find("<") + 1:sender.find(">")] if "<" in sender else sender


def _reason(r: httpx.Response) -> str:
    try:
        msg = r.json().get("message") or r.text
    except ValueError:
        msg = r.text
    msg = str(msg)[:240]
    if "verify a domain" in msg.lower() or "testing emails" in msg.lower():
        return ("The email provider is in sandbox mode and only delivers to the account owner. "
                "Verify a sending domain at resend.com/domains and set EMAIL_FROM to an address on it.")
    return f"Provider error {r.status_code}: {msg}"


async def _post(client: httpx.AsyncClient, url: str, headers: dict, payload) -> httpx.Response:
    """POST with retry on 429 / 5xx / network errors. Honours Retry-After."""
    last: httpx.Response | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            last = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            if attempt == MAX_ATTEMPTS - 1:
                raise
            log.warning("email request failed, retrying", extra={"ctx": {"error": str(exc), "attempt": attempt + 1}})
            await asyncio.sleep(1.0 * 2 ** attempt)
            continue
        if last.status_code != 429 and last.status_code < 500:
            return last
        try:
            wait = float(last.headers.get("retry-after", "")) if last.headers.get("retry-after") else 1.0 * 2 ** attempt
        except ValueError:
            wait = 1.0 * 2 ** attempt
        await asyncio.sleep(min(wait, 8.0))
    assert last is not None
    return last


async def _send_resend(client: httpx.AsyncClient, key: str, sender: str, msgs: list[EmailMessage]) -> list[SendResult]:
    headers = {"Authorization": f"Bearer {key}"}
    payloads = [{"from": sender, "to": [m.to], "subject": m.subject, "html": _wrap(m.title, m.body_html, m.cta_label, m.cta_url)} for m in msgs]
    results: list[SendResult] = []
    for start in range(0, len(msgs), RESEND_BATCH_SIZE):
        chunk_msgs, chunk = msgs[start:start + RESEND_BATCH_SIZE], payloads[start:start + RESEND_BATCH_SIZE]
        try:
            r = await _post(client, "https://api.resend.com/emails/batch", headers, chunk)
            if r.status_code < 300:
                results += [SendResult(m.to, True) for m in chunk_msgs]
                continue
            log.warning("resend batch rejected, falling back to single sends", extra={"ctx": {"status": r.status_code, "body": r.text[:300]}})
        except httpx.HTTPError as exc:
            log.warning("resend batch failed, falling back to single sends", extra={"ctx": {"error": str(exc)}})
        for m, payload in zip(chunk_msgs, chunk):       # isolate the bad recipient; stay under 2 requests/second
            try:
                r = await _post(client, "https://api.resend.com/emails", headers, payload)
                results.append(SendResult(m.to, True) if r.status_code < 300 else SendResult(m.to, False, _reason(r)))
                if r.status_code >= 300:
                    log.error("email provider rejected message", extra={"ctx": {"to": m.to, "status": r.status_code, "body": r.text[:300]}})
            except httpx.HTTPError as exc:
                results.append(SendResult(m.to, False, "The email provider could not be reached."))
                log.error("email send failed", extra={"ctx": {"to": m.to, "error": str(exc)}})
            await asyncio.sleep(0.55)
    return results


async def _send_sendgrid(client: httpx.AsyncClient, key: str, sender: str, msgs: list[EmailMessage]) -> list[SendResult]:
    headers = {"Authorization": f"Bearer {key}"}
    addr = _sender_address(sender)
    gate = asyncio.Semaphore(5)

    async def one(m: EmailMessage) -> SendResult:
        async with gate:
            try:
                r = await _post(client, "https://api.sendgrid.com/v3/mail/send", headers, {
                    "personalizations": [{"to": [{"email": m.to}]}], "from": {"email": addr}, "subject": m.subject,
                    "content": [{"type": "text/html", "value": _wrap(m.title, m.body_html, m.cta_label, m.cta_url)}]})
            except httpx.HTTPError as exc:
                log.error("email send failed", extra={"ctx": {"to": m.to, "error": str(exc)}})
                return SendResult(m.to, False, "The email provider could not be reached.")
            if r.status_code >= 300:
                log.error("email provider rejected message", extra={"ctx": {"to": m.to, "status": r.status_code, "body": r.text[:300]}})
                return SendResult(m.to, False, _reason(r))
            return SendResult(m.to, True)

    return list(await asyncio.gather(*(one(m) for m in msgs)))


async def send_many_async(messages: list[EmailMessage]) -> list[SendResult]:
    """Send every message independently. The result list matches `messages` one-to-one, in order."""
    if not messages:
        return []
    s = get_settings()
    if not (s.resend_api_key or s.sendgrid_api_key):
        log.warning("no email provider configured", extra={"ctx": {"recipients": len(messages)}})
        return [SendResult(m.to, False, "Email is not configured on the server.") for m in messages]
    async with httpx.AsyncClient(timeout=20) as client:
        if s.resend_api_key:
            return await _send_resend(client, s.resend_api_key, s.email_from, messages)
        return await _send_sendgrid(client, s.sendgrid_api_key, s.email_from, messages)


def send_many(messages: list[EmailMessage]) -> list[SendResult]:
    """Blocking entry point for sync endpoints (they run in AnyIO worker threads)."""
    try:
        return anyio.from_thread.run(send_many_async, messages)
    except RuntimeError:          # not inside an AnyIO worker thread (scripts, tests)
        return asyncio.run(send_many_async(messages))


def send_email(to: str, subject: str, title: str, body_html: str,
               cta_label: str | None = None, cta_url: str | None = None) -> bool:
    return send_many([EmailMessage(to, subject, title, body_html, cta_label, cta_url)])[0].ok
