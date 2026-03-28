from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend import main


def _build_client():
    with patch.object(main, "container_client", MagicMock()) as mock_container_client:
        mock_container_client.exists.return_value = True
        return TestClient(main.app)


def test_secondary_exam_catalog_and_dashboard():
    with _build_client() as client:
        catalog_response = client.get("/api/secondary-exam/catalog")
        assert catalog_response.status_code == 200
        payload = catalog_response.json()
        assert payload["items"]
        assert any(item["case_no"] == 1 for item in payload["items"])

        dashboard_response = client.get("/api/secondary-exam/dashboard")
        assert dashboard_response.status_code == 200
        dashboard = dashboard_response.json()
        assert dashboard["summary"]["total_exams"] >= len(payload["items"])


def test_secondary_exam_draft_and_grade_flow():
    with _build_client() as client:
        catalog = client.get("/api/secondary-exam/catalog").json()["items"]
        target = next(item for item in catalog if item["year_label"] == "R07" and item["case_no"] == 1)

        detail = client.get(f"/api/secondary-exam/exams/{target['year_label']}/{target['case_no']}")
        assert detail.status_code == 200
        detail_payload = detail.json()
        packets = detail_payload["bundle"]["normalized_scoring_input"]["question_prompt_packets"]
        assert packets

        answers = {
            packets[0]["question_key"]: "強みは地元密着の対応力と自社倉庫保有、弱みは非効率な受注管理と新規開拓力不足である。",
        }

        draft_response = client.put(
            f"/api/secondary-exam/drafts/{target['year_label']}/{target['case_no']}",
            json={"answers": answers, "active_question_key": packets[0]["question_key"]},
        )
        assert draft_response.status_code == 200
        assert draft_response.json()["answers"] == answers

        grade_response = client.post(
            "/api/secondary-exam/grade",
            json={
                "year_label": target["year_label"],
                "case_no": target["case_no"],
                "answers": answers,
            },
        )
        assert grade_response.status_code == 200
        grade_payload = grade_response.json()
        assert grade_payload["overall_score"] >= 0
        assert grade_payload["question_results"]

        result_response = client.get(f"/api/secondary-exam/results/{grade_payload['attempt_id']}")
        assert result_response.status_code == 200
        assert result_response.json()["attempt_id"] == grade_payload["attempt_id"]
