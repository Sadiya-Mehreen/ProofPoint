import io
import unittest

from services.resume_parser import parse_resume


def _pdf_object(index, body):
    return f"{index} 0 obj\n{body}\nendobj\n"


def _content_stream(text):
    stream = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET"
    return f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"


def make_pdf_bytes(pages_text):
    """Builds a minimal valid multi-page, text-based PDF with no external deps."""
    n = len(pages_text)
    font_obj_num = 3 + n
    content_obj_nums = [font_obj_num + 1 + i for i in range(n)]

    objects = {}
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"

    page_refs = " ".join(f"{3 + i} 0 R" for i in range(n))
    objects[2] = f"<< /Type /Pages /Kids [{page_refs}] /Count {n} >>"

    for i in range(n):
        page_num = 3 + i
        content_num = content_obj_nums[i]
        objects[page_num] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_obj_num} 0 R >> >> "
            f"/Contents {content_num} 0 R >>"
        )

    objects[font_obj_num] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    for i, text in enumerate(pages_text):
        objects[content_obj_nums[i]] = _content_stream(text)

    buf = io.BytesIO()
    buf.write(b"%PDF-1.4\n")
    offsets = {}
    for obj_num in sorted(objects):
        offsets[obj_num] = buf.tell()
        buf.write(_pdf_object(obj_num, objects[obj_num]).encode("latin-1"))

    xref_offset = buf.tell()
    total_objs = max(objects) + 1
    buf.write(f"xref\n0 {total_objs}\n".encode("latin-1"))
    buf.write(b"0000000000 65535 f \n")
    for obj_num in range(1, total_objs):
        buf.write(f"{offsets[obj_num]:010d} 00000 n \n".encode("latin-1"))

    buf.write(
        f"trailer\n<< /Size {total_objs} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode(
            "latin-1"
        )
    )
    return buf.getvalue()


class ParseResumeTests(unittest.TestCase):
    def test_valid_multi_page_pdf_extracts_text_in_order(self):
        pdf_bytes = make_pdf_bytes(["Alice Example - Page One", "Second page content here"])
        path = "test_multi_page_resume.pdf"
        with open(path, "wb") as f:
            f.write(pdf_bytes)
        try:
            text = parse_resume(path)
            self.assertIn("Alice Example", text)
            self.assertIn("Second page content", text)
            self.assertLess(
                text.index("Alice Example"),
                text.index("Second page content"),
            )
        finally:
            import os

            os.remove(path)

    def test_malformed_pdf_returns_empty_string(self):
        path = "test_malformed_resume.pdf"
        with open(path, "wb") as f:
            f.write(b"%PDF-1.4\nthis is not a real pdf body at all")
        try:
            text = parse_resume(path)
            self.assertEqual(text, "")
        finally:
            import os

            os.remove(path)

    def test_nonexistent_file_returns_empty_string(self):
        text = parse_resume("this_file_does_not_exist_at_all.pdf")
        self.assertEqual(text, "")


if __name__ == "__main__":
    unittest.main()
