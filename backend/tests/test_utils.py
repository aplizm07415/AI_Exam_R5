import pytest
from datetime import datetime, timedelta, timezone
from backend.utils import HistoryItem, ProblemStudyStatus, get_problem_study_statuses, calculate_review_priority

# --- get_problem_study_statusesのテスト ---

def test_get_problem_study_statuses_empty_history():
    """履歴が空の場合、空のProblemStudyStatus辞書を返すことをテスト"""
    history_items = []
    statuses = get_problem_study_statuses(history_items)
    assert len(statuses) == 0

def test_get_problem_study_statuses_single_correct_answer():
    """1つの問題に1回正解した場合のステータスをテスト"""
    now = datetime.now(timezone.utc)
    history_items = [
        HistoryItem(problem_id="p1", subject="s1", selected_answer="A", is_correct=True, answered_at=now)
    ]
    statuses = get_problem_study_statuses(history_items)
    assert "p1" in statuses
    status = statuses["p1"]
    assert status.problem_id == "p1"
    assert status.last_answered_at == now
    assert status.last_correct_at == now
    assert status.total_answers == 1
    assert status.correct_answers == 1
    assert status.incorrect_answers == 0
    assert status.current_streak == 1
    assert status.max_streak == 1

def test_get_problem_study_statuses_single_incorrect_answer():
    """1つの問題に1回不正解した場合のステータスをテスト"""
    now = datetime.now(timezone.utc)
    history_items = [
        HistoryItem(problem_id="p1", subject="s1", selected_answer="B", is_correct=False, answered_at=now)
    ]
    statuses = get_problem_study_statuses(history_items)
    assert "p1" in statuses
    status = statuses["p1"]
    assert status.problem_id == "p1"
    assert status.last_answered_at == now
    assert status.last_correct_at is None
    assert status.total_answers == 1
    assert status.correct_answers == 0
    assert status.incorrect_answers == 1
    assert status.current_streak == 0
    assert status.max_streak == 0

def test_get_problem_study_statuses_mixed_answers_single_problem():
    """1つの問題に複数回、正解・不正解が混ざった場合のステータスをテスト"""
    t1 = datetime(2023, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2023, 1, 1, 10, 5, 0, tzinfo=timezone.utc)
    t3 = datetime(2023, 1, 1, 10, 10, 0, tzinfo=timezone.utc)
    t4 = datetime(2023, 1, 1, 10, 15, 0, tzinfo=timezone.utc)
    history_items = [
        HistoryItem(problem_id="p1", subject="s1", selected_answer="A", is_correct=True, answered_at=t1),
        HistoryItem(problem_id="p1", subject="s1", selected_answer="B", is_correct=False, answered_at=t2),
        HistoryItem(problem_id="p1", subject="s1", selected_answer="A", is_correct=True, answered_at=t3),
        HistoryItem(problem_id="p1", subject="s1", selected_answer="A", is_correct=True, answered_at=t4),
    ]
    statuses = get_problem_study_statuses(history_items)
    status = statuses["p1"]
    assert status.total_answers == 4
    assert status.correct_answers == 3
    assert status.incorrect_answers == 1
    assert status.last_answered_at == t4
    assert status.last_correct_at == t4
    assert status.current_streak == 2  # t2でリセット後、t3,t4で2連続
    assert status.max_streak == 2  # t3,t4の2連続が最大

def test_get_problem_study_statuses_multiple_problems():
    """複数の問題が混ざった場合のステータスをテスト"""
    t1 = datetime(2023, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2023, 1, 1, 10, 5, 0, tzinfo=timezone.utc)
    t3 = datetime(2023, 1, 1, 10, 10, 0, tzinfo=timezone.utc)
    history_items = [
        HistoryItem(problem_id="p1", subject="s1", selected_answer="A", is_correct=True, answered_at=t1),
        HistoryItem(problem_id="p2", subject="s1", selected_answer="B", is_correct=False, answered_at=t2),
        HistoryItem(problem_id="p1", subject="s1", selected_answer="A", is_correct=True, answered_at=t3),
    ]
    statuses = get_problem_study_statuses(history_items)
    
    status_p1 = statuses["p1"]
    assert status_p1.total_answers == 2
    assert status_p1.correct_answers == 2
    assert status_p1.incorrect_answers == 0
    assert status_p1.current_streak == 2
    assert status_p1.max_streak == 2

    status_p2 = statuses["p2"]
    assert status_p2.total_answers == 1
    assert status_p2.correct_answers == 0
    assert status_p2.incorrect_answers == 1
    assert status_p2.current_streak == 0
    assert status_p2.max_streak == 0

# --- calculate_review_priorityのテスト ---

def test_calculate_review_priority_new_problem():
    """まだ一度も解答していない問題の優先度をテスト"""
    status = ProblemStudyStatus(problem_id="p_new")
    now = datetime.now(timezone.utc)
    priority = calculate_review_priority(status, now)
    assert priority == 0.1 # ベースラインの優先度

def test_calculate_review_priority_never_correct_problem():
    """一度も正解していない問題の優先度をテスト"""
    t1 = datetime(2023, 1, 1, tzinfo=timezone.utc)
    status = ProblemStudyStatus(
        problem_id="p_never_correct",
        last_answered_at=t1,
        total_answers=3,
        incorrect_answers=3,
        current_streak=0,
        max_streak=0
    )
    now = datetime.now(timezone.utc)
    priority = calculate_review_priority(status, now)
    # last_correct_atがないので時間経過ボーナスはなし。不正解ボーナスと正解率ボーナスが主。
    # 0.0 + (3 * 2) + (1-0)*5 + 10.0 = 6 + 5 + 10 = 21
    assert priority == pytest.approx(21.0, abs=0.01)

def test_calculate_review_priority_long_time_ago_correct():
    """過去に正解したが、時間がかなり経過した問題の優先度をテスト"""
    two_days_ago = datetime.now(timezone.utc) - timedelta(days=2)
    status = ProblemStudyStatus(
        problem_id="p_old_correct",
        last_answered_at=two_days_ago,
        last_correct_at=two_days_ago,
        total_answers=5,
        correct_answers=5,
        incorrect_answers=0,
        current_streak=5,
        max_streak=5
    )
    now = datetime.now(timezone.utc)
    priority = calculate_review_priority(status, now)
    # 時間経過: 2日 -> +2.0
    # 不正解: 0 -> +0
    # 正解率: 1 -> +0
    # 連続正解: 5 -> -2.5
    assert priority == pytest.approx(0.0, abs=0.01) # -0.5 だが max(0.0, priority) で 0.0 になるはず

def test_calculate_review_priority_recently_correct_high_streak():
    """最近正解し、連続正解数が多い問題の優先度をテスト"""
    just_now = datetime.now(timezone.utc) - timedelta(minutes=1)
    status = ProblemStudyStatus(
        problem_id="p_recent_correct",
        last_answered_at=just_now,
        last_correct_at=just_now,
        total_answers=10,
        correct_answers=10,
        incorrect_answers=0,
        current_streak=10,
        max_streak=10
    )
    now = datetime.now(timezone.utc)
    priority = calculate_review_priority(status, now)
    # 時間経過: わずか -> ほぼ0
    # 不正解: 0 -> +0
    # 正解率: 1 -> +0
    # 連続正解: 10 -> -5.0
    assert priority == pytest.approx(0.0, abs=0.01) # 負になるが0でクリップ

def test_calculate_review_priority_low_correct_rate_many_answers():
    """解答数が多いが正解率が低い問題の優先度をテスト"""
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    status = ProblemStudyStatus(
        problem_id="p_low_rate",
        last_answered_at=yesterday,
        last_correct_at=yesterday, # 最後に正解したのは昨日
        total_answers=10,
        correct_answers=2,
        incorrect_answers=8,
        current_streak=0,
        max_streak=1
    )
    now = datetime.now(timezone.utc)
    priority = calculate_review_priority(status, now)
    # 時間経過: 1日 -> +1.0
    # 不正解: 8 -> +16.0 (8*2)
    # 正解率: 0.2 -> +(1-0.2)*5 = 0.8*5 = +4.0
    # 連続正解: 0 -> +0
    # 合計: 1.0 + 16.0 + 4.0 = 21.0
    assert priority == pytest.approx(21.0, abs=0.01)
