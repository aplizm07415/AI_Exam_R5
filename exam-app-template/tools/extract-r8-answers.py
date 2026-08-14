import json
import re
from pathlib import Path

import pymupdf


APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent
PDF_ROOT = REPO_ROOT / "tmp" / "pdfs" / "r8"
OUTPUT = APP_ROOT / "content" / "official" / "r8.json"

SUBJECTS = {
    "finance": {
        "code": "B",
        "label": "財務・会計",
        "minutes": 60,
        "pages": 21,
        "question_url": "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2026/B1JC2026.pdf",
    },
    "operations": {
        "code": "D",
        "label": "運営管理",
        "minutes": 90,
        "pages": 42,
        "question_url": "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2026/D1JC2026.pdf",
    },
    "law": {
        "code": "E",
        "label": "経営法務",
        "minutes": 60,
        "pages": 26,
        "question_url": "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2026/E1JC2026.pdf",
    },
    "sme": {
        "code": "G",
        "label": "中小企業経営・中小企業政策",
        "minutes": 90,
        "pages": 39,
        "question_url": "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2026/G1JC2026.pdf",
    },
}


def parse_block(rows, offset):
    items = []
    current_number = None
    for row in rows:
        if len(row) < offset + 4:
            continue
        question, subquestion, answer, points = [str(value or "").strip() for value in row[offset : offset + 4]]
        number_match = re.search(r"第\s*(\d+)\s*問", question)
        if number_match:
            current_number = int(number_match.group(1))
        if not current_number or answer not in {"ア", "イ", "ウ", "エ", "オ"} or not points.isdigit():
            continue
        subquestion_match = re.search(r"(\d+)", subquestion)
        subquestion_number = int(subquestion_match.group(1)) if subquestion_match else None
        item_id = str(current_number) if subquestion_number is None else f"{current_number}-{subquestion_number}"
        items.append(
            {
                "id": item_id,
                "number": current_number,
                "subquestion": subquestion_number,
                "answer": answer,
                "points": int(points),
            }
        )
    return items


def extract_answers(pdf_path):
    page = pymupdf.open(pdf_path)[0]
    tables = page.find_tables().tables
    if not tables:
        raise RuntimeError(f"No answer table found: {pdf_path}")
    rows = tables[0].extract()
    width = max(len(row) for row in rows)
    offsets = [0, 5] if width >= 9 else [0]
    items = []
    for offset in offsets:
        items.extend(parse_block(rows, offset))
    unique = {item["id"]: item for item in items}
    return sorted(unique.values(), key=lambda item: (item["number"], item["subquestion"] or 0))


def main():
    result = {
        "version": 1,
        "year": 2026,
        "eraYear": "令和8年度",
        "publishedBy": "一般社団法人 日本中小企業診断士協会連合会",
        "answerPageUrl": "https://www.jf-cmca.jp/contents/010_c_/010_c_r08_shiken/R08_1ji_shiken_kaitou.html",
        "subjects": {},
    }
    for subject_id, subject in SUBJECTS.items():
        code = subject["code"]
        answer_pdf = PDF_ROOT / f"2026{code}-answers.pdf"
        answers = extract_answers(answer_pdf)
        result["subjects"][subject_id] = {
            **subject,
            "answer_url": f"https://www.jf-cmca.jp/attach/test/r08/1ji_seikai/2026{code}.pdf",
            "totalPoints": sum(item["points"] for item in answers),
            "answers": answers,
        }
        print(subject["label"], len(answers), "解答欄", result["subjects"][subject_id]["totalPoints"], "点")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
