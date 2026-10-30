import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { BarChartIcon, FileTextIcon, LoaderIcon, PencilIcon } from './components/icons';
import {
  fetchSecondaryExamDashboard,
  fetchSecondaryExamDetail,
  gradeSecondaryExam,
  saveSecondaryExamDraft,
} from './secondaryExam/api';
import type {
  SecondaryDraft,
  SecondaryExamCatalogItem,
  SecondaryExamDashboardResponse,
  SecondaryExamDetailResponse,
} from './secondaryExam/types';

const LOCAL_DRAFT_KEY_PREFIX = 'secondary-exam-draft';
const PRACTICE_DURATION_OPTIONS = [40, 60, 80, 100, 120];

type ViewMode = 'practice' | 'dashboard';

function getLocalDraftKey(examId: string) {
  return `${LOCAL_DRAFT_KEY_PREFIX}:${examId}`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '未実施';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMonthDay(value: Date) {
  return value.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  });
}

function toDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeekSunday(value: Date) {
  const next = new Date(value);
  next.setDate(value.getDate() - value.getDay());
  return next;
}

function endOfWeekSaturday(value: Date) {
  const next = new Date(value);
  next.setDate(value.getDate() + (6 - value.getDay()));
  return next;
}

function countAnswerChars(text: string) {
  return text.replace(/\s+/g, '').length;
}

function formatRemainingTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatPoints(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function clampAnswerToLimit(text: string, limit: number | null) {
  if (typeof limit !== 'number' || limit <= 0) {
    return text;
  }
  let counted = 0;
  let output = '';
  for (const char of text) {
    const isWhitespace = /\s/.test(char);
    if (!isWhitespace) {
      if (counted >= limit) {
        continue;
      }
      counted += 1;
    }
    output += char;
  }
  return output;
}

function statusLabel(status: SecondaryExamCatalogItem['status']) {
  switch (status) {
    case 'graded':
      return '採点済み';
    case 'draft':
      return '下書き';
    default:
      return '未着手';
  }
}

function statusClassName(status: SecondaryExamCatalogItem['status']) {
  switch (status) {
    case 'graded':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'draft':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function mergeDrafts(
  serverDraft: SecondaryExamDetailResponse['draft'],
  localDraft: SecondaryDraft | null,
) {
  const serverUpdatedAt = serverDraft?.updated_at ? new Date(serverDraft.updated_at).getTime() : 0;
  const localUpdatedAt = localDraft?.updated_at ? new Date(localDraft.updated_at).getTime() : 0;
  const preferred = localUpdatedAt > serverUpdatedAt ? localDraft : serverDraft;
  return {
    answers: preferred?.answers ?? {},
    activeQuestionKey: preferred?.active_question_key ?? null,
    updatedAt: preferred?.updated_at ?? null,
    sessionStarted: Boolean(preferred?.session_started),
    timerPaused: preferred?.timer_paused ?? Boolean(preferred?.session_started),
    timerRemainingSeconds: preferred?.timer_remaining_seconds ?? null,
    timerDurationMinutes: preferred?.timer_duration_minutes ?? null,
  };
}

function DashboardCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string | number;
  tone: 'slate' | 'emerald' | 'amber' | 'sky';
}) {
  const toneClass = {
    slate: 'border border-slate-200 bg-[#f3f1eb] text-slate-900',
    emerald: 'border border-emerald-200 bg-[#e6f3ec] text-emerald-950',
    amber: 'border border-amber-200 bg-[#f7eddc] text-amber-950',
    sky: 'border border-sky-200 bg-[#e7f0f8] text-sky-950',
  }[tone];
  return (
    <div className={`rounded-3xl p-5 shadow-sm ${toneClass}`}>
      <div className="text-sm font-medium opacity-75">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

export default function SecondaryExamPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>(searchParams.get('view') === 'dashboard' ? 'dashboard' : 'practice');
  const [dashboard, setDashboard] = useState<SecondaryExamDashboardResponse | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SecondaryExamDetailResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeQuestionKey, setActiveQuestionKey] = useState<string | null>(null);
  const [practiceDurationMinutes, setPracticeDurationMinutes] = useState<number>(80);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(80 * 60);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('未保存');
  const [error, setError] = useState('');
  const autosaveTimerRef = useRef<number | null>(null);

  const catalog = dashboard?.catalog ?? [];
  const selectedCatalogItem = useMemo(
    () => catalog.find((item) => item.exam_id === selectedExamId) ?? null,
    [catalog, selectedExamId],
  );
  const questionPackets = detail?.bundle.normalized_scoring_input.question_prompt_packets ?? [];
  const referenceStatsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of detail?.question_reference_stats ?? []) {
      const median = item.references.aas?.answer_char_stats?.median ?? item.references.aas?.answer_char_stats?.mean;
      if (typeof median === 'number') {
        map.set(item.question_key, Math.round(median));
      }
    }
    return map;
  }, [detail]);
  const yearOptions = useMemo(
    () => Array.from(new Set(catalog.map((item) => item.year_label))).sort((left, right) => right.localeCompare(left)),
    [catalog],
  );
  const selectedPracticeYear = selectedCatalogItem?.year_label ?? searchParams.get('year') ?? yearOptions[0] ?? '';
  const caseOptionsForYear = useMemo(
    () => catalog.filter((item) => item.year_label === selectedPracticeYear).sort((left, right) => left.case_no - right.case_no),
    [catalog, selectedPracticeYear],
  );
  const timerLabel = sessionStarted ? formatRemainingTime(remainingSeconds) : null;
  const timerSaveBucket = sessionStarted ? Math.floor(remainingSeconds / 30) : -1;
  const hasDraftAnswers = Object.values(answers).some((value) => value.trim());
  const hasResumableSession = sessionStarted && remainingSeconds > 0;

  const dashboardCalendar = useMemo(() => {
    if (!dashboard) {
      return null;
    }

    const today = new Date();
    const displayYear = today.getFullYear();
    const calendarStart = new Date(displayYear, 3, 1);
    const calendarEnd = new Date(displayYear, 9, 31);
    const gridStart = startOfWeekSunday(calendarStart);
    const gridEnd = endOfWeekSaturday(calendarEnd);
    const dayMap = new Map<string, SecondaryExamDashboardResponse['all_attempts']>();

    for (const attempt of dashboard.all_attempts) {
      const scoredAt = new Date(attempt.scored_at);
      if (Number.isNaN(scoredAt.getTime())) {
        continue;
      }
      if (scoredAt < calendarStart || scoredAt > calendarEnd) {
        continue;
      }
      const key = toDateKey(scoredAt);
      const current = dayMap.get(key) ?? [];
      current.push(attempt);
      current.sort((left, right) => new Date(right.scored_at).getTime() - new Date(left.scored_at).getTime());
      dayMap.set(key, current);
    }

    const weeks: Array<Array<{
      date: Date;
      key: string;
      inRange: boolean;
      attempts: SecondaryExamDashboardResponse['all_attempts'];
    }>> = [];

    for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 7)) {
      const week = [];
      for (let offset = 0; offset < 7; offset += 1) {
        const date = new Date(cursor);
        date.setDate(cursor.getDate() + offset);
        const key = toDateKey(date);
        week.push({
          date,
          key,
          inRange: date >= calendarStart && date <= calendarEnd,
          attempts: dayMap.get(key) ?? [],
        });
      }
      weeks.push(week);
    }

    return {
      displayYear,
      startLabel: formatMonthDay(calendarStart),
      endLabel: formatMonthDay(calendarEnd),
      weeks,
    };
  }, [dashboard]);

  const updateViewMode = (nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', nextViewMode);
    setSearchParams(nextParams, { replace: true });
  };

  const writeLocalDraft = (draftPayload: SecondaryDraft, updatedAt?: string | null) => {
    if (!detail) {
      return;
    }
    window.localStorage.setItem(
      getLocalDraftKey(detail.exam_id),
      JSON.stringify({
        ...draftPayload,
        updated_at: updatedAt ?? new Date().toISOString(),
      }),
    );
  };

  const buildDraftPayload = (overrides?: Partial<SecondaryDraft>): SecondaryDraft => ({
    answers,
    active_question_key: activeQuestionKey,
    session_started: sessionStarted,
    timer_paused: isTimerPaused,
    timer_remaining_seconds: sessionStarted ? remainingSeconds : null,
    timer_duration_minutes: practiceDurationMinutes,
    ...overrides,
  });

  const openProblemPdf = () => {
    if (!detail) {
      return;
    }
    window.open(detail.pdf_url, '_blank', 'noopener,noreferrer');
  };

  const refreshDashboard = async (preferredExamId?: string | null) => {
    const nextDashboard = await fetchSecondaryExamDashboard();
    setDashboard(nextDashboard);
    const requestedYear = searchParams.get('year');
    const requestedCase = Number(searchParams.get('case'));
    const fromSearch = nextDashboard.catalog.find(
      (item) => item.year_label === requestedYear && item.case_no === requestedCase,
    );
    const fallbackExamId = preferredExamId ?? fromSearch?.exam_id ?? selectedExamId ?? nextDashboard.catalog[0]?.exam_id ?? null;
    setSelectedExamId((current) => {
      if (current && nextDashboard.catalog.some((item) => item.exam_id === current)) {
        return current;
      }
      return fallbackExamId;
    });
  };

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      setError('');
      try {
        await refreshDashboard();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '二次試験データの読み込みに失敗しました。');
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    if (!dashboard) {
      return;
    }
    const nextViewMode = searchParams.get('view') === 'dashboard' ? 'dashboard' : 'practice';
    setViewMode(nextViewMode);

    const requestedYear = searchParams.get('year');
    const requestedCase = Number(searchParams.get('case'));
    const fromSearch = dashboard.catalog.find((item) => item.year_label === requestedYear && item.case_no === requestedCase);
    if (fromSearch && fromSearch.exam_id !== selectedExamId) {
      setSelectedExamId(fromSearch.exam_id);
    }
  }, [dashboard, searchParams, selectedExamId]);

  useEffect(() => {
    const loadDetail = async () => {
      if (!selectedCatalogItem) {
        return;
      }
      setError('');
      try {
        const nextDetail = await fetchSecondaryExamDetail(selectedCatalogItem.year_label, selectedCatalogItem.case_no);
        setDetail(nextDetail);

        const localDraftRaw = window.localStorage.getItem(getLocalDraftKey(nextDetail.exam_id));
        const localDraft = localDraftRaw ? JSON.parse(localDraftRaw) as SecondaryDraft : null;
        const merged = mergeDrafts(nextDetail.draft, localDraft);
        const firstQuestionKey = nextDetail.bundle.normalized_scoring_input.question_prompt_packets[0]?.question_key ?? null;

        setAnswers(merged.answers);
        setActiveQuestionKey(merged.activeQuestionKey ?? firstQuestionKey);
        setPracticeDurationMinutes(merged.timerDurationMinutes ?? 80);
        setSessionStarted(merged.sessionStarted);
        setIsTimerPaused(merged.timerPaused);
        setRemainingSeconds(merged.timerRemainingSeconds ?? ((merged.timerDurationMinutes ?? 80) * 60));
        setSaveMessage(merged.updatedAt ? `保存済み: ${formatDateTime(merged.updatedAt)}` : '未保存');
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '試験データの読み込みに失敗しました。');
      }
    };
    void loadDetail();
  }, [selectedCatalogItem]);

  useEffect(() => {
    if (!sessionStarted || isTimerPaused || remainingSeconds <= 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [sessionStarted, isTimerPaused, remainingSeconds]);

  useEffect(() => {
    if (remainingSeconds === 0 && sessionStarted) {
      setIsTimerPaused(true);
    }
  }, [remainingSeconds, sessionStarted]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      const draftPayload = buildDraftPayload();
      writeLocalDraft(draftPayload);
      setSaveMessage('ローカル保存済み');
      setIsSaving(true);
      void saveSecondaryExamDraft(detail.bundle.year_label, detail.bundle.case_no, draftPayload).then((saved) => {
        writeLocalDraft(draftPayload, saved.updated_at ?? null);
        setSaveMessage(`保存済み: ${formatDateTime(saved.updated_at ?? null)}`);
      }).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : '下書き保存に失敗しました。');
        setSaveMessage('保存失敗');
      }).finally(() => {
        setIsSaving(false);
      });
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    detail,
    answers,
    activeQuestionKey,
    practiceDurationMinutes,
    sessionStarted,
    isTimerPaused,
    timerSaveBucket,
  ]);

  const syncSelectionToSearch = (exam: SecondaryExamCatalogItem, nextViewMode?: ViewMode) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('year', exam.year_label);
    nextParams.set('case', String(exam.case_no));
    nextParams.set('view', nextViewMode ?? viewMode);
    setSearchParams(nextParams, { replace: true });
  };

  const handleSelectExam = (examId: string, nextViewMode?: ViewMode) => {
    const nextExam = catalog.find((item) => item.exam_id === examId);
    if (!nextExam) {
      return;
    }
    setSelectedExamId(examId);
    if (nextViewMode) {
      updateViewMode(nextViewMode);
    }
    syncSelectionToSearch(nextExam, nextViewMode);
  };

  const handlePracticeYearChange = (yearLabel: string) => {
    const nextExam = catalog.find((item) => item.year_label === yearLabel && item.case_no === 1)
      ?? catalog.find((item) => item.year_label === yearLabel)
      ?? null;
    if (nextExam) {
      handleSelectExam(nextExam.exam_id, 'practice');
    }
  };

  const handlePracticeCaseChange = (caseNoRaw: string) => {
    const caseNo = Number(caseNoRaw);
    const nextExam = catalog.find((item) => item.year_label === selectedPracticeYear && item.case_no === caseNo) ?? null;
    if (nextExam) {
      handleSelectExam(nextExam.exam_id, 'practice');
    }
  };

  const handleStartPractice = () => {
    const nextRemaining = remainingSeconds > 0 ? remainingSeconds : practiceDurationMinutes * 60;
    setSessionStarted(true);
    setIsTimerPaused(false);
    setRemainingSeconds(nextRemaining);
    openProblemPdf();
  };

  const handlePauseTimer = () => {
    setIsTimerPaused(true);
  };

  const handleResumeTimer = () => {
    if (remainingSeconds <= 0) {
      setRemainingSeconds(practiceDurationMinutes * 60);
    }
    setSessionStarted(true);
    setIsTimerPaused(false);
    openProblemPdf();
  };

  const handleAnswerChange = (questionKey: string, value: string, limit: number | null) => {
    const nextValue = clampAnswerToLimit(value, limit);
    setAnswers((current) => ({
      ...current,
      [questionKey]: nextValue,
    }));
  };

  const saveDraft = async (overrides?: Partial<SecondaryDraft>) => {
    if (!detail) {
      return null;
    }
    const draftPayload = buildDraftPayload(overrides);
    setIsSaving(true);
    setError('');
    try {
      const saved = await saveSecondaryExamDraft(detail.bundle.year_label, detail.bundle.case_no, draftPayload);
      writeLocalDraft(draftPayload, saved.updated_at ?? null);
      setSaveMessage(`保存済み: ${formatDateTime(saved.updated_at ?? null)}`);
      await refreshDashboard(detail.exam_id);
      return saved;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '下書き保存に失敗しました。');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndReturn = async () => {
    setIsTimerPaused(true);
    const saved = await saveDraft({
      session_started: true,
      timer_paused: true,
      timer_remaining_seconds: remainingSeconds,
    });
    if (!saved || !selectedCatalogItem) {
      return;
    }
    syncSelectionToSearch(selectedCatalogItem, 'dashboard');
    updateViewMode('dashboard');
  };

  const handleGrade = async () => {
    if (!detail) {
      return;
    }
    setIsGrading(true);
    setError('');
    try {
      const nextResult = await gradeSecondaryExam(detail.bundle.year_label, detail.bundle.case_no, answers);
      setSaveMessage(`採点反映: ${formatDateTime(nextResult.scored_at)}`);
      await refreshDashboard(detail.exam_id);
      navigate(`/secondary-exam/results/${nextResult.attempt_id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '採点に失敗しました。');
    } finally {
      setIsGrading(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-[#0f172a] via-[#12355b] to-[#1d4f91] p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200">Secondary Exam Studio</div>
            <h2 className="mt-3 text-3xl font-bold leading-tight md:text-4xl">二次試験特化の専用演習画面</h2>
            <p className="mt-3 text-sm leading-7 text-sky-100">
              問題PDFは演習開始時に別タブで開き、この画面では答案作成だけに集中できます。
            </p>
          </div>
          <div className="inline-flex rounded-2xl bg-white/10 p-1 backdrop-blur">
            <button
              type="button"
              onClick={() => updateViewMode('practice')}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${viewMode === 'practice' ? 'bg-white text-slate-900' : 'text-white/85'}`}
            >
              <PencilIcon className="h-4 w-4" />
              演習
            </button>
            <button
              type="button"
              onClick={() => updateViewMode('dashboard')}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${viewMode === 'dashboard' ? 'bg-white text-slate-900' : 'text-white/85'}`}
            >
              <BarChartIcon className="h-4 w-4" />
              管理
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {dashboard && viewMode === 'dashboard' ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardCard title="総事例数" value={dashboard.summary.total_exams} tone="slate" />
          <DashboardCard title="採点済み" value={dashboard.summary.graded_exams} tone="emerald" />
          <DashboardCard title="下書き中" value={dashboard.summary.draft_exams} tone="amber" />
          <DashboardCard title="未着手" value={dashboard.summary.untouched_exams} tone="sky" />
        </section>
      ) : null}

      <section>
        {viewMode === 'dashboard' && dashboard ? (
          <div className="grid items-stretch gap-6 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">New Practice</div>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">新規でテストを始める</h3>
              <div className="mt-4 space-y-3">
                {catalog.map((item) => (
                  <div
                    key={item.exam_id}
                    className={`rounded-2xl border px-4 py-4 ${
                      item.exam_id === selectedExamId ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                        <div className="mt-1 text-xs text-slate-500">設問数 {item.question_count}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClassName(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectExam(item.exam_id, 'practice')}
                        className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        演習画面へ
                      </button>
                      {item.latest_attempt_at ? (
                        <button
                          type="button"
                          onClick={() => {
                            const latestAttempt = dashboard.recent_attempts.find((attempt) => attempt.exam_id === item.exam_id)
                              ?? dashboard.all_attempts.find((attempt) => attempt.exam_id === item.exam_id);
                            if (latestAttempt) {
                              navigate(`/secondary-exam/results/${latestAttempt.attempt_id}`);
                            }
                          }}
                          className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          最新結果を見る
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6 xl:col-span-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">History Review</div>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">履歴ごとの振り返り</h3>
                <div className="mt-4 space-y-3">
                  {dashboard.recent_attempts.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">まだ採点履歴はありません。</div>
                  ) : (
                    dashboard.recent_attempts.slice(0, 8).map((attempt) => (
                      <button
                        key={attempt.attempt_id}
                        type="button"
                        onClick={() => navigate(`/secondary-exam/results/${attempt.attempt_id}`)}
                        className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{attempt.year_label} 事例{attempt.case_no}</div>
                          <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{formatPoints(attempt.overall_score)}点</div>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">{formatDateTime(attempt.scored_at)}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {dashboardCalendar ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Scoring Calendar</div>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">
                        {dashboardCalendar.displayYear}年 {dashboardCalendar.startLabel} - {dashboardCalendar.endLabel}
                      </h3>
                    </div>
                    <div className="text-xs text-slate-500">各日付から、その回の採点結果ページへ直接移動できます。</div>
                  </div>

                  <div className="mt-5 overflow-x-auto">
                    <div className="min-w-[980px]">
                      <div className="grid grid-cols-7 gap-2">
                        {['日', '月', '火', '水', '木', '金', '土'].map((label) => (
                          <div key={label} className="px-2 py-2 text-center text-xs font-semibold text-slate-500">{label}</div>
                        ))}
                      </div>
                      <div className="mt-2 space-y-2">
                        {dashboardCalendar.weeks.map((week) => (
                          <div key={week[0]?.key ?? 'week'} className="grid grid-cols-7 gap-2">
                            {week.map((day) => (
                              <div
                                key={day.key}
                                className={`min-h-[132px] rounded-2xl border p-2 ${day.inRange ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-slate-50/40'}`}
                              >
                                <div className={`text-xs font-semibold ${day.inRange ? 'text-slate-700' : 'text-slate-300'}`}>
                                  {day.date.getMonth() + 1}/{day.date.getDate()}
                                </div>
                                <div className="mt-2 space-y-1.5">
                                  {day.attempts.map((attempt) => (
                                    <button
                                      key={attempt.attempt_id}
                                      type="button"
                                      onClick={() => navigate(`/secondary-exam/results/${attempt.attempt_id}`)}
                                      className="block w-full rounded-xl bg-white px-2 py-2 text-left shadow-sm ring-1 ring-slate-200 hover:bg-sky-50 hover:ring-sky-200"
                                    >
                                      <div className="text-[11px] font-semibold text-slate-900">{attempt.year_label} 事例{attempt.case_no}</div>
                                      <div className="mt-0.5 text-[11px] text-sky-700">{formatPoints(attempt.overall_score)}点</div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : detail ? (
          !sessionStarted ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Practice Setup</div>
              <h3 className="mt-2 text-2xl font-semibold text-slate-900">演習を開始する前に設定します</h3>
              <div className="mt-6 grid gap-5 lg:grid-cols-3">
                <label className="space-y-2">
                  <div className="text-sm font-semibold text-slate-700">年度</div>
                  <select
                    value={selectedPracticeYear}
                    onChange={(event) => handlePracticeYearChange(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                  >
                    {yearOptions.map((yearLabel) => (
                      <option key={yearLabel} value={yearLabel}>{yearLabel}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <div className="text-sm font-semibold text-slate-700">事例</div>
                  <select
                    value={selectedCatalogItem?.case_no ?? ''}
                    onChange={(event) => handlePracticeCaseChange(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                  >
                    {caseOptionsForYear.map((item) => (
                      <option key={item.exam_id} value={item.case_no}>事例{item.case_no}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <div className="text-sm font-semibold text-slate-700">演習時間</div>
                  <select
                    value={practiceDurationMinutes}
                    onChange={(event) => setPracticeDurationMinutes(Number(event.target.value))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                  >
                    {PRACTICE_DURATION_OPTIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>{minutes}分</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                <div className="text-sm font-semibold text-slate-900">{selectedCatalogItem?.title}</div>
                <div className="mt-2 text-sm text-slate-600">
                  {hasDraftAnswers
                    ? `下書きあり。${sessionStarted ? `残り時間 ${formatRemainingTime(remainingSeconds)} で再開できます。` : '保存済みの答案から続けられます。'}`
                    : '演習開始時に問題文PDFを別タブで開きます。回答入力ページにはPDFを表示しません。'}
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={openProblemPdf}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileTextIcon className="h-4 w-4" />
                  問題PDFを開く
                </button>
                <button
                  type="button"
                  onClick={handleStartPractice}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <PencilIcon className="h-4 w-4" />
                  {hasResumableSession ? '演習を再開' : '演習を開始'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Writing Desk</div>
                    <h3 className="mt-1 text-xl font-semibold text-slate-900">{detail.bundle.year_label} 事例{detail.bundle.case_no} 答案作成</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {timerLabel ? (
                      <div className={`rounded-full px-4 py-2 text-sm font-semibold ${remainingSeconds === 0 ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
                        残り {timerLabel}
                      </div>
                    ) : null}
                    <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">{saveMessage}</div>
                    <button
                      type="button"
                      onClick={openProblemPdf}
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      問題PDFを別タブで開く
                    </button>
                    <button
                      type="button"
                      onClick={isTimerPaused ? handleResumeTimer : handlePauseTimer}
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {isTimerPaused ? '再開' : '一時停止'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveAndReturn()}
                      disabled={isSaving}
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {isSaving ? '保存中...' : '一時保存して管理へ'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGrade()}
                      disabled={isGrading}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {isGrading ? <LoaderIcon className="h-4 w-4 animate-spin" /> : null}
                      {isGrading ? '採点中...' : 'AI採点へ進む'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {questionPackets.map((packet) => {
                  const text = answers[packet.question_key] ?? '';
                  const charCount = countAnswerChars(text);
                  const limit = packet.char_limit;
                  const referenceMedian = referenceStatsMap.get(packet.question_key);
                  return (
                    <div key={packet.question_key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setActiveQuestionKey(packet.question_key)}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${activeQuestionKey === packet.question_key ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}
                          >
                            {packet.question_key}
                          </button>
                          <div className="text-sm font-semibold leading-7 text-slate-900">{packet.prompt_text_clean}</div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-slate-100 px-3 py-2 font-semibold text-slate-700">制限 {limit ?? 'なし'}字</span>
                          {referenceMedian ? (
                            <span className="rounded-full bg-sky-50 px-3 py-2 font-semibold text-sky-700">再現答案中央値 {referenceMedian}字</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-4">
                        <textarea
                          value={text}
                          onChange={(event) => handleAnswerChange(packet.question_key, event.target.value, limit)}
                          className="min-h-[180px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-400"
                          placeholder="ここに答案を入力します。"
                        />
                      </div>
                      <div className="mt-3 text-xs text-slate-500">
                        文字数 {charCount}{typeof limit === 'number' ? ` / ${limit}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
            読み込める試験データがありません。管理画面で対象の年度・事例を選択してください。
          </div>
        )}
      </section>
    </div>
  );
}
