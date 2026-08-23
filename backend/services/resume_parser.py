"""Parses candidate resumes from PDF files into plain text."""

import logging
import re

from pypdf import PdfReader
from pypdf.errors import PdfReadError

logger = logging.getLogger(__name__)


def _clean_text(text: str) -> str:
    text = text.replace("\x00", "")
    text = "".join(ch for ch in text if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def parse_resume(file_path: str) -> str:
    try:
        reader = PdfReader(file_path)
    except FileNotFoundError:
        logger.warning("Resume file not found: %s", file_path)
        return ""
    except PdfReadError as exc:
        logger.warning("Malformed or corrupt PDF %s: %s", file_path, exc)
        return ""
    except Exception as exc:
        logger.warning("Failed to open PDF %s: %s", file_path, exc)
        return ""

    if reader.is_encrypted:
        try:
            if reader.decrypt("") == 0:
                logger.warning("Encrypted/password-protected PDF, cannot read: %s", file_path)
                return ""
        except Exception as exc:
            logger.warning("Failed to decrypt PDF %s: %s", file_path, exc)
            return ""

    pages_text = []
    for page_number, page in enumerate(reader.pages, start=1):
        try:
            page_text = page.extract_text() or ""
        except Exception as exc:
            logger.warning("Failed to extract text from page %d of %s: %s", page_number, file_path, exc)
            continue

        if not page_text.strip():
            continue

        pages_text.append(page_text)

    if not pages_text:
        logger.warning("No extractable text found in PDF: %s", file_path)
        return ""

    combined = "\n\n".join(pages_text)
    return _clean_text(combined)
