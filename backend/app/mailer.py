"""Outgoing email (the sign-up email-verification code).

Preference order: Brevo's HTTPS API (works where outbound SMTP is blocked, e.g. Render's free plan), then SMTP,
then — with neither configured — the message is written to the server log so local development still works.
Sending never raises: a failure is logged (never the API key)."""
import json
import logging
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage

from .config import get_settings

log = logging.getLogger("fellaride.mail")

BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"


def configured() -> bool:
    """Whether a real email transport is set, so verification can be required and links actually arrive."""
    s = get_settings()
    return bool(s.brevo_api_key or s.smtp_host)


def _sender(s) -> tuple[str, str]:
    return (s.mail_from or s.smtp_from or s.smtp_user or ""), (s.mail_from_name or "FellaRide")


def send(to: str, subject: str, text: str, html: str | None = None) -> bool:
    s = get_settings()
    if s.brevo_api_key:
        return _send_brevo(s, to, subject, text, html)
    if s.smtp_host:
        return _send_smtp(s, to, subject, text, html)
    log.warning("No email transport set (FELLARIDE_BREVO_API_KEY or FELLARIDE_SMTP_HOST), so this email was not "
                "sent.\nTo: %s\nSubject: %s\n\n%s", to, subject, text)
    return False


def _send_brevo(s, to: str, subject: str, text: str, html: str | None) -> bool:
    from_email, from_name = _sender(s)
    if not from_email:
        log.error("FELLARIDE_BREVO_API_KEY is set but no sender (FELLARIDE_MAIL_FROM); email to %s not sent.", to)
        return False
    payload: dict = {"sender": {"email": from_email, "name": from_name}, "to": [{"email": to}],
                     "subject": subject, "textContent": text}
    if html:
        payload["htmlContent"] = html
    req = urllib.request.Request(BREVO_ENDPOINT, method="POST", data=json.dumps(payload).encode(),
                                 headers={"api-key": s.brevo_api_key, "content-type": "application/json",
                                          "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        # Brevo's error body helps (unverified sender, over quota); it never contains the API key.
        body = e.read().decode(errors="replace")[:300]
        log.error("Brevo rejected the email to %s: HTTP %s %s", to, e.code, body)
        return False
    except OSError as e:
        log.error("Could not reach Brevo to email %s: %s", to, e)
        return False


def _send_smtp(s, to: str, subject: str, text: str, html: str | None) -> bool:
    from_email, _ = _sender(s)
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = from_email, to, subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as e:
        log.error("Could not send email to %s: %s", to, e)
        return False
