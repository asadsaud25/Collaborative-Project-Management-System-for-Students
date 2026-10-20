"""Transactional email through Resend or SendGrid. Returns False (and logs) when neither is configured,
so invites still work and the UI can show the copyable join link instead."""
import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("email")


def _wrap(title: str, body_html: str, cta_label: str | None = None, cta_url: str | None = None) -> str:
    button = (
        f'<p style="margin:24px 0"><a href="{cta_url}" style="background:#111;color:#fff;padding:10px 18px;'
        f'border-radius:6px;text-decoration:none;font-weight:500">{cta_label}</a></p>' if cta_url else ""
    )
    return (
        '<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">'
        f'<h2 style="margin:0 0 12px">{title}</h2><div style="line-height:1.55;color:#333">{body_html}</div>{button}'
        '<p style="color:#888;font-size:12px">Sent by CPMS</p></div>'
    )


def send_email(to: str, subject: str, title: str, body_html: str,
               cta_label: str | None = None, cta_url: str | None = None) -> bool:
    s = get_settings()
    html = _wrap(title, body_html, cta_label, cta_url)
    try:
        if s.resend_api_key:
            r = httpx.post("https://api.resend.com/emails", timeout=15,
                           headers={"Authorization": f"Bearer {s.resend_api_key}"},
                           json={"from": s.email_from, "to": [to], "subject": subject, "html": html})
        elif s.sendgrid_api_key:
            sender = s.email_from
            addr = sender[sender.find("<") + 1:sender.find(">")] if "<" in sender else sender
            r = httpx.post("https://api.sendgrid.com/v3/mail/send", timeout=15,
                           headers={"Authorization": f"Bearer {s.sendgrid_api_key}"},
                           json={"personalizations": [{"to": [{"email": to}]}], "from": {"email": addr},
                                 "subject": subject, "content": [{"type": "text/html", "value": html}]})
        else:
            log.warning("no email provider configured", extra={"ctx": {"to": to, "subject": subject}})
            return False
        if r.status_code >= 300:
            log.error("email provider rejected message", extra={"ctx": {"status": r.status_code, "body": r.text[:300]}})
            return False
        return True
    except httpx.HTTPError as exc:
        log.error("email send failed", extra={"ctx": {"error": str(exc)}})
        return False
