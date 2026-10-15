"""Outgoing email (forgot-password links and codes). In order of preference:
1. Brevo's HTTPS email API (FELLARIDE_BREVO_API_KEY): works on hosts that block SMTP ports, like Render's free plan.
2. An SMTP server (FELLARIDE_SMTP_HOST), e.g. Gmail with an app password, for local use or paid hosting.
3. Neither: the message is written to the server log, so local development still works.
Sending never raises: a failure is logged and the function returns False."""
import json
import logging
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage

from .config import get_settings

log = logging.getLogger("fellaride.mail")
BREVO_URL = "https://api.brevo.com/v3/smtp/email"


def _brevo(to: str, subject: str, text: str, html: str | None) -> bool:
    s = get_settings()
    payload = {"sender": {"name": s.mail_from_name or "FellaRide", "email": s.mail_from},
               "to": [{"email": to}], "subject": subject, "textContent": text, **({"htmlContent": html} if html else {})}
    req = urllib.request.Request(BREVO_URL, data=json.dumps(payload).encode(), method="POST",
                                 headers={"api-key": s.brevo_api_key, "content-type": "application/json", "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        log.error("Brevo refused the email to %s: %s %s", to, e.code, e.read()[:300])
    except (urllib.error.URLError, OSError) as e:
        log.error("Could not reach Brevo to email %s: %s", to, e)
    return False


def _smtp(to: str, subject: str, text: str, html: str | None) -> bool:
    s = get_settings()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from or s.smtp_user, to, subject
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


def send(to: str, subject: str, text: str, html: str | None = None) -> bool:
    s = get_settings()
    if s.brevo_api_key and s.mail_from:
        return _brevo(to, subject, text, html)
    if s.smtp_host:
        return _smtp(to, subject, text, html)
    log.warning("No email service set (FELLARIDE_BREVO_API_KEY or FELLARIDE_SMTP_HOST), so this email was not sent."
                "\nTo: %s\nSubject: %s\n\n%s", to, subject, text)
    return False
