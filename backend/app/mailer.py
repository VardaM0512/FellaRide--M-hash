"""Outgoing email (forgot-password links). Uses the SMTP server in the settings; without one, the message is
written to the server log so local development still works. Sending never raises: a failure is logged."""
import logging
import smtplib
from email.message import EmailMessage

from .config import get_settings

log = logging.getLogger("fellaride.mail")


def send(to: str, subject: str, body: str) -> bool:
    s = get_settings()
    if not s.smtp_host:
        log.warning("No SMTP server set (FELLARIDE_SMTP_HOST), so this email was not sent.\nTo: %s\nSubject: %s\n\n%s",
                    to, subject, body)
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from or s.smtp_user, to, subject
    msg.set_content(body)
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
