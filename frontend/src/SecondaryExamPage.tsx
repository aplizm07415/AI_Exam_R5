import React, { useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import { BarChartIcon, FileTextIcon, LoaderIcon, PencilIcon } from './components/icons';
import {
  askSecondaryExamOralViva,
  fetchSecondaryExamDashboard,
  fetchSecondaryExamDetail,
  gradeSecondaryExam,
  saveSecondaryExamDraft,
} from './secondaryExam/api';
import type {
  SecondaryAttemptHistoryItem,
  SecondaryExamCatalogItem,
  SecondaryExamDashboardResponse,
  SecondaryExamDetailResponse,
  SecondaryGradeResult,
  SecondaryOralVivaTurn,
  SecondaryQuestionPromptPacket,
  SecondaryQuestionReferenceStats,
} from './secondaryExam/types';

const LOCAL_DRAFT_KEY_PREFIX = 'secondary-exam-draft';

type ViewMode = 'practice' | 'dashboard';
const PRACTICE_DURATION_OPTIONS = [40, 60, 80, 100, 120];

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

function countAnswerChars(text: string) {
  return text.replace(/\s+/g, '').length;
}

function formatPoints(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatRemainingTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizeQuestionNo(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function getBundleExplanation(detail: SecondaryExamDetailResponse, packet: SecondaryQuestionPromptPacket) {
  return (detail.bundle.explanations ?? []).find(
    (item) => normalizeQuestionNo(item.question_no) === normalizeQuestionNo(packet.question_no),
  );
}

function getBundleRubric(detail: SecondaryExamDetailResponse, packet: SecondaryQuestionPromptPacket) {
  return (detail.bundle.rubrics ?? []).find(
    (item) => normalizeQuestionNo(item.question_no) === normalizeQuestionNo(packet.question_no),
  );
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
  localDraft: { answers?: Record<string, string>; updated_at?: string } | null,
) {
  const serverUpdatedAt = serverDraft?.updated_at ? new Date(serverDraft.updated_at).getTime() : 0;
  const localUpdatedAt = localDraft?.updated_at ? new Date(localDraft.updated_at).getTime() : 0;
  if (localUpdatedAt > serverUpdatedAt) {
    return {
      answers: localDraft?.answers ?? {},
      updatedAt: localDraft?.updated_at ?? null,
    };
  }
  return {
    answers: serverDraft?.answers ?? {},
    updatedAt: serverDraft?.updated_at ?? null,
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

function QuestionResultCard({
  packet,
  result,
}: {
  packet: SecondaryQuestionPromptPacket;
  result: SecondaryGradeResult['question_results'][number] | undefined;
}) {
  if (!result) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{packet.question_key}</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{packet.prompt_text_clean}</div>
        </div>
        <div className="rounded-2xl bg-slate-900 px-3 py-2 text-right text-white">
          <div className="text-sm font-semibold">{formatPoints(result.score)} / {formatPoints(result.max_score)}点</div>
          <div className="text-xs text-slate-300">{result.score_percentage}%</div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2">文字数: {result.char_count}{result.char_limit ? ` / ${result.char_limit}` : ''}</div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">観点一致: {result.coverage_score}</div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">設問対応: {result.prompt_score}</div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500">良い点</div>
          <ul className="mt-2 space-y-2 text-sm text-slate-700">
            {result.positives.map((item) => (
              <li key={item} className="rounded-xl bg-emerald-50 px-3 py-2">{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">改善ポイント</div>
          <ul className="mt-2 space-y-2 text-sm text-slate-700">
            {result.improvement_points.map((item) => (
              <li key={item} className="rounded-xl bg-rose-50 px-3 py-2">{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700">
        <div className="font-semibold text-sky-700">アドバイス</div>
        <div className="mt-1">{result.advice}</div>
      </div>
    </div>
  );
}

export default function SecondaryExamPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('practice');
  const [dashboard, setDashboard] = useState<SecondaryExamDashboardResponse | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SecondaryExamDetailResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeQuestionKey, setActiveQuestionKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('未保存');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SecondaryGradeResult | null>(null);
  const [selectedHistoryAttemptId, setSelectedHistoryAttemptId] = useState<string | null>(null);
  const [practiceDurationMinutes, setPracticeDurationMinutes] = useState<number>(80);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionEndsAt, setSessionEndsAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(80 * 60);
  const [oralVivaInput, setOralVivaInput] = useState('');
  const [oralVivaConversation, setOralVivaConversation] = useState<SecondaryOralVivaTurn[]>([]);
  const [oralVivaSuggestedFollowups, setOralVivaSuggestedFollowups] = useState<string[]>([]);
  const [oralVivaCitedQuestionKeys, setOralVivaCitedQuestionKeys] = useState<string[]>([]);
  const [isAskingOralViva, setIsAskingOralViva] = useState(false);
  const autosaveTimerRef = useRef<number | null>(null);

  const catalog = dashboard?.catalog ?? [];
  const selectedCatalogItem = useMemo(
    () => catalog.find((item) => item.exam_id === selectedExamId) ?? null,
    [catalog, selectedExamId],
  );
  const questionPackets = detail?.bundle.normalized_scoring_input.question_prompt_packets ?? [];
  const resultHistory = detail?.result_history ?? [];
  const referenceStatsMap = useMemo(() => {
    const map = new Map<string, SecondaryQuestionReferenceStats>();
    for (const item of detail?.question_reference_stats ?? []) {
      map.set(item.question_key, item);
    }
    return map;
  }, [detail]);
  const selectedHistoryAttempt = useMemo(
    () => resultHistory.find((item) => item.attempt_id === selectedHistoryAttemptId) ?? resultHistory[0] ?? null,
    [resultHistory, selectedHistoryAttemptId],
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(catalog.map((item) => item.year_label))).sort((left, right) => right.localeCompare(left)),
    [catalog],
  );
  const selectedPracticeYear = selectedCatalogItem?.year_label ?? yearOptions[0] ?? '';
  const caseOptionsForYear = useMemo(
    () => catalog.filter((item) => item.year_label === selectedPracticeYear).sort((left, right) => left.case_no - right.case_no),
    [catalog, selectedPracticeYear],
  );
  const timerLabel = sessionEndsAt ? formatRemainingTime(remainingSeconds) : null;

  const refreshDashboard = async (preferredExamId?: string | null) => {
    const nextDashboard = await fetchSecondaryExamDashboard();
    setDashboard(nextDashboard);
    const nextCatalog = nextDashboard.catalog;
    const fallbackExamId = preferredExamId ?? selectedExamId ?? nextCatalog[0]?.exam_id ?? null;
    setSelectedExamId((current) => {
      if (current && nextCatalog.some((item) => item.exam_id === current)) {
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
    const loadDetail = async () => {
      if (!selectedCatalogItem) {
        return;
      }
      setError('');
      try {
        const nextDetail = await fetchSecondaryExamDetail(selectedCatalogItem.year_label, selectedCatalogItem.case_no);
        setDetail(nextDetail);
        setResult(nextDetail.latest_result);

        const localDraftRaw = window.localStorage.getItem(getLocalDraftKey(nextDetail.exam_id));
        const localDraft = localDraftRaw ? JSON.parse(localDraftRaw) as { answers?: Record<string, string>; updated_at?: string } : null;
        const merged = mergeDrafts(nextDetail.draft, localDraft);
        setAnswers(merged.answers);
        setSaveMessage(merged.updatedAt ? `保存済み: ${formatDateTime(merged.updatedAt)}` : '未保存');
        setSelectedHistoryAttemptId(nextDetail.latest_result?.attempt_id ?? nextDetail.result_history[0]?.attempt_id ?? null);
        setOralVivaConversation([]);
        setOralVivaSuggestedFollowups([]);
        setOralVivaCitedQuestionKeys([]);
        setOralVivaInput('');

        const firstQuestionKey = nextDetail.bundle.normalized_scoring_input.question_prompt_packets[0]?.question_key ?? null;
        setActiveQuestionKey(nextDetail.draft?.active_question_key ?? firstQuestionKey);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '試験データの読み込みに失敗しました。');
      }
    };
    void loadDetail();
  }, [selectedCatalogItem]);

  useEffect(() => {
    if (!sessionEndsAt) {
      return;
    }
    const updateTimer = () => {
      const nextRemaining = Math.max(0, Math.ceil((sessionEndsAt - Date.now()) / 1000));
      setRemainingSeconds(nextRemaining);
    };
    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [sessionEndsAt]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      const payload = {
        answers,
        active_question_key: activeQuestionKey,
        updated_at: new Date().toISOString(),
      };
      window.localStorage.setItem(getLocalDraftKey(detail.exam_id), JSON.stringify(payload));
      setSaveMessage('ローカル保存済み');
      setIsSaving(true);
      void saveSecondaryExamDraft(detail.bundle.year_label, detail.bundle.case_no, {
        answers,
        active_question_key: activeQuestionKey,
      }).then((saved) => {
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
  }, [answers, activeQuestionKey, detail]);

  const handleSelectExam = (examId: string) => {
    setSelectedExamId(examId);
    setViewMode('practice');
    setSessionStarted(false);
    setSessionEndsAt(null);
    setRemainingSeconds(practiceDurationMinutes * 60);
  };

  const handlePracticeYearChange = (yearLabel: string) => {
    const nextExam = catalog.find((item) => item.year_label === yearLabel && item.case_no === 1)
      ?? catalog.find((item) => item.year_label === yearLabel)
      ?? null;
    if (nextExam) {
      setSelectedExamId(nextExam.exam_id);
      setSessionStarted(false);
      setSessionEndsAt(null);
    }
  };

  const handlePracticeCaseChange = (caseNoRaw: string) => {
    const caseNo = Number(caseNoRaw);
    const nextExam = catalog.find((item) => item.year_label === selectedPracticeYear && item.case_no === caseNo) ?? null;
    if (nextExam) {
      setSelectedExamId(nextExam.exam_id);
      setSessionStarted(false);
      setSessionEndsAt(null);
    }
  };

  const handleStartPractice = () => {
    const durationSeconds = practiceDurationMinutes * 60;
    setSessionStarted(true);
    setSessionEndsAt(Date.now() + (durationSeconds * 1000));
    setRemainingSeconds(durationSeconds);
  };

  const handleAnswerChange = (questionKey: string, value: string, limit: number | null) => {
    const nextValue = clampAnswerToLimit(value, limit);
    setAnswers((current) => ({
      ...current,
      [questionKey]: nextValue,
    }));
  };

  const handleSaveNow = async () => {
    if (!detail) {
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const saved = await saveSecondaryExamDraft(detail.bundle.year_label, detail.bundle.case_no, {
        answers,
        active_question_key: activeQuestionKey,
      });
      window.localStorage.setItem(getLocalDraftKey(detail.exam_id), JSON.stringify({
        answers,
        active_question_key: activeQuestionKey,
        updated_at: saved.updated_at,
      }));
      setSaveMessage(`保存済み: ${formatDateTime(saved.updated_at ?? null)}`);
      await refreshDashboard(detail.exam_id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '下書き保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGrade = async () => {
    if (!detail) {
      return;
    }
    setIsGrading(true);
    setError('');
    try {
      const nextResult = await gradeSecondaryExam(detail.bundle.year_label, detail.bundle.case_no, answers);
      setResult(nextResult);
      setSelectedHistoryAttemptId(nextResult.attempt_id);
      setOralVivaConversation([]);
      setOralVivaSuggestedFollowups([]);
      setOralVivaCitedQuestionKeys([]);
      setOralVivaInput('');
      setSaveMessage(`採点反映: ${formatDateTime(nextResult.scored_at)}`);
      await refreshDashboard(detail.exam_id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '採点に失敗しました。');
    } finally {
      setIsGrading(false);
    }
  };

  const handleAskOralViva = async (prefilledQuestion?: string) => {
    if (!detail || !result) {
      return;
    }
    const question = (prefilledQuestion ?? oralVivaInput).trim();
    if (!question) {
      return;
    }
    const nextConversation = [...oralVivaConversation, { role: 'user', content: question } satisfies SecondaryOralVivaTurn];
    setOralVivaConversation(nextConversation);
    setOralVivaInput('');
    setIsAskingOralViva(true);
    setError('');
    try {
      const response = await askSecondaryExamOralViva(detail.bundle.year_label, detail.bundle.case_no, {
        attempt_id: result.attempt_id,
        user_message: question,
        conversation: oralVivaConversation,
      });
      setOralVivaConversation((current) => [...current, { role: 'assistant', content: response.assistant_message }]);
      setOralVivaSuggestedFollowups(response.suggested_followups);
      setOralVivaCitedQuestionKeys(response.cited_question_keys);
    } catch (nextError) {
      setOralVivaConversation((current) => current.slice(0, -1));
      setError(nextError instanceof Error ? nextError.message : '口頭試問Q&Aに失敗しました。');
      setOralVivaInput(question);
    } finally {
      setIsAskingOralViva(false);
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
          </div>
          <div className="inline-flex rounded-2xl bg-white/10 p-1 backdrop-blur">
            <button
              type="button"
              onClick={() => setViewMode('practice')}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${viewMode === 'practice' ? 'bg-white text-slate-900' : 'text-white/85'}`}
            >
              <PencilIcon className="h-4 w-4" />
              演習
            </button>
            <button
              type="button"
              onClick={() => setViewMode('dashboard')}
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
        <div className="min-w-0">
          {viewMode === 'dashboard' && dashboard ? (
            <div className="grid items-stretch gap-6 xl:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1 flex h-full flex-col">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Exam Catalog</div>
                <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {catalog.map((item) => (
                    <button
                      key={item.exam_id}
                      type="button"
                      onClick={() => handleSelectExam(item.exam_id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        item.exam_id === selectedExamId
                          ? 'border-sky-500 bg-sky-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
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
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>初回 {typeof item.first_score === 'number' ? formatPoints(item.first_score) : '-'}</span>
                        <span>最高 {typeof item.best_score === 'number' ? formatPoints(item.best_score) : '-'}</span>
                        <span>{item.latest_attempt_at ? formatDateTime(item.latest_attempt_at) : '履歴なし'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-6 xl:col-span-2">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Recent Attempts</div>
                  <div className="mt-4 space-y-3">
                    {dashboard.recent_attempts.length === 0 ? (
                      <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500">まだ採点履歴はありません。</div>
                    ) : (
                      dashboard.recent_attempts.slice(0, 6).map((attempt) => (
                        <button
                          key={attempt.attempt_id}
                          type="button"
                          onClick={() => handleSelectExam(attempt.exam_id)}
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

                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <BarChartIcon className="h-5 w-5 text-sky-600" />
                    <h3 className="text-lg font-semibold text-slate-900">進捗一覧</h3>
                  </div>
                  <div className="mt-5 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">年度 / 事例</th>
                          <th className="px-3 py-2 font-medium">状態</th>
                          <th className="px-3 py-2 font-medium">初回</th>
                          <th className="px-3 py-2 font-medium">最高点</th>
                          <th className="px-3 py-2 font-medium">採点回数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catalog.map((item) => (
                          <tr
                            key={item.exam_id}
                            className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                            onClick={() => handleSelectExam(item.exam_id)}
                          >
                            <td className="px-3 py-3 font-medium text-slate-900">{item.title}</td>
                            <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClassName(item.status)}`}>{statusLabel(item.status)}</span></td>
                            <td className="px-3 py-3 text-slate-600">{typeof item.first_score === 'number' ? formatPoints(item.first_score) : '-'}</td>
                            <td className="px-3 py-3 text-slate-600">{typeof item.best_score === 'number' ? formatPoints(item.best_score) : '-'}</td>
                            <td className="px-3 py-3 text-slate-600">{item.attempt_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
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
                  <div className="mt-2 text-sm text-slate-600">この設定で始めると、演習中は残り時間を右側に表示します。</div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={handleStartPractice}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    <PencilIcon className="h-4 w-4" />
                    演習を開始
                  </button>
                </div>
              </div>
            ) : (
            <div className="grid items-stretch gap-6 2xl:grid-cols-2">
              <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm flex h-full flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Problem PDF</div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">{detail.bundle.year_label} 事例{detail.bundle.case_no}</h3>
                  </div>
                  <a
                    href={detail.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FileTextIcon className="h-4 w-4" />
                    別タブで開く
                  </a>
                </div>
                <div className="mt-4 min-h-[70vh] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  <iframe
                    key={detail.pdf_url}
                    title={`${detail.bundle.year_label}-case${detail.bundle.case_no}-pdf`}
                    src={detail.pdf_url}
                    className="h-full w-full"
                  />
                </div>
              </section>

              <section className="min-w-0 space-y-5">
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
                        onClick={handleSaveNow}
                        disabled={isSaving}
                        className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {isSaving ? '保存中...' : '今すぐ保存'}
                      </button>
                      <button
                        type="button"
                        onClick={handleGrade}
                        disabled={isGrading}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        {isGrading ? <LoaderIcon className="h-4 w-4 animate-spin" /> : null}
                        {isGrading ? '採点中...' : 'AI採点'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {questionPackets.map((packet) => {
                    const text = answers[packet.question_key] ?? '';
                    const charCount = countAnswerChars(text);
                    const limit = packet.char_limit;
                    const ref = referenceStatsMap.get(packet.question_key)?.references.aas?.answer_char_stats;
                    const overLimit = typeof limit === 'number' && charCount > limit;
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
                            {ref ? (
                              <span className="rounded-full bg-sky-50 px-3 py-2 font-semibold text-sky-700">
                                再現答案中央値 {Math.round(ref.median ?? ref.mean ?? 0)}字
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-4">
                          <textarea
                            value={text}
                            onChange={(event) => handleAnswerChange(packet.question_key, event.target.value, limit)}
                            className={`min-h-[180px] w-full rounded-2xl border bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition ${overLimit ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-sky-400'}`}
                            placeholder="ここに答案を入力します。"
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div className={`${overLimit ? 'text-rose-600' : 'text-slate-500'}`}>
                            文字数 {charCount}{typeof limit === 'number' ? ` / ${limit}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {result ? (
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Scoring Result</div>
                          <h3 className="mt-1 text-xl font-semibold text-slate-900">総合 {formatPoints(result.overall_score)} / {formatPoints(result.total_possible_score)}点</h3>
                          <div className="mt-1 text-sm font-semibold text-sky-700">{result.overall_percentage}%</div>
                          <p className="mt-2 text-sm leading-7 text-slate-600">{result.overall_feedback.summary}</p>
                        </div>
                        <div className="rounded-3xl bg-slate-900 px-5 py-4 text-white">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Last Graded</div>
                          <div className="mt-2 text-sm font-semibold">{formatDateTime(result.scored_at)}</div>
                          <div className="mt-1 text-xs text-slate-300">
                            {result.cached ? '同一答案のキャッシュ結果' : result.overall_feedback.used_ai ? 'AI採点を使用' : 'ローカル評価を使用'}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {result.overall_feedback.priority_actions.map((item) => (
                          <span key={item} className="rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{item}</span>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Case Oral Viva</div>
                          <h3 className="mt-1 text-xl font-semibold text-slate-900">年度/事例横断の口頭試問Q&A</h3>
                          <p className="mt-2 text-sm leading-7 text-slate-600">
                            採点済み答案全体を前提に、「設問1のこの解釈で合ってる？」のような横断質問をそのまま投げられます。
                          </p>
                        </div>
                        <div className="rounded-2xl bg-slate-100 px-4 py-3 text-xs font-semibold text-slate-600">
                          対象: {detail.bundle.year_label} 事例{detail.bundle.case_no}
                        </div>
                      </div>

                      {oralVivaCitedQuestionKeys.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {oralVivaCitedQuestionKeys.map((questionKey) => (
                            <button
                              key={questionKey}
                              type="button"
                              onClick={() => setActiveQuestionKey(questionKey)}
                              className="rounded-full bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                            >
                              関連設問 {questionKey}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-5 space-y-3">
                        {oralVivaConversation.length > 0 ? (
                          oralVivaConversation.map((turn, index) => (
                            <div
                              key={`${turn.role}-${index}`}
                              className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                                turn.role === 'assistant'
                                  ? 'bg-slate-50 text-slate-800'
                                  : 'bg-sky-50 text-sky-950'
                              }`}
                            >
                              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                {turn.role === 'assistant' ? 'Examiner' : 'You'}
                              </div>
                              <div className="whitespace-pre-wrap">{turn.content}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                            例: 「設問1と設問2で一貫して言うべき強みは何？」「自分の答案で因果が弱いのはどこ？」
                          </div>
                        )}
                      </div>

                      {oralVivaSuggestedFollowups.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {oralVivaSuggestedFollowups.map((item) => (
                            <button
                              key={item}
                              type="button"
                              onClick={() => void handleAskOralViva(item)}
                              disabled={isAskingOralViva}
                              className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-5">
                        <textarea
                          value={oralVivaInput}
                          onChange={(event) => setOralVivaInput(event.target.value)}
                          placeholder="設問横断で確認したいことを入力します。"
                          className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-400"
                        />
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void handleAskOralViva()}
                            disabled={isAskingOralViva || !oralVivaInput.trim()}
                            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            {isAskingOralViva ? <LoaderIcon className="h-4 w-4 animate-spin" /> : null}
                            {isAskingOralViva ? '回答生成中...' : '質問する'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {questionPackets.map((packet) => (
                      <div key={packet.question_key} className="space-y-4">
                        <QuestionResultCard
                          packet={packet}
                          result={result.question_results.find((item) => item.question_key === packet.question_key)}
                        />
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Reference After Scoring</div>
                          <div className="mt-4 space-y-4">
                            {(() => {
                              const explanation = getBundleExplanation(detail, packet);
                              const rubric = getBundleRubric(detail, packet);
                              const fallbackRubrics = packet.rubric_candidates.flatMap((candidate) => candidate.checklist_items ?? []);
                              const rubricItems = rubric?.採点観点?.filter(Boolean) ?? fallbackRubrics;
                              const modelAnswer = explanation?.answer_example_text?.trim() || rubric?.模範解答?.trim() || null;
                              const explanationText = explanation?.solution_text?.trim() || rubric?.解説?.trim() || packet.explanation_candidate?.trim() || null;
                              return (
                                <>
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">模範解答</div>
                                    <div className="mt-2 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-7 text-slate-800 whitespace-pre-wrap">
                                      {modelAnswer || 'この設問の模範解答データはまだありません。'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">解説</div>
                                    <div className="mt-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-7 text-slate-800 whitespace-pre-wrap">
                                      {explanationText || 'この設問の解説データはまだありません。'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">採点観点</div>
                                    {rubricItems.length > 0 ? (
                                      <ul className="mt-2 space-y-2 text-sm text-slate-700">
                                        {rubricItems.map((item) => (
                                          <li key={`${packet.question_key}-${item}`} className="rounded-2xl bg-amber-50 px-4 py-3 leading-7">
                                            {item}
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <div className="mt-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-7 text-slate-800">
                                        この設問の採点観点データはまだありません。
                                      </div>
                                    )}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {resultHistory.length > 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Score History</div>
                        <h3 className="mt-1 text-xl font-semibold text-slate-900">採点履歴</h3>
                      </div>
                      <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                        {resultHistory.length}件
                      </div>
                    </div>

                    <div className="mt-5 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                      <div className="space-y-3">
                        {resultHistory.map((attempt) => (
                          <AttemptHistoryCard
                            key={attempt.attempt_id}
                            attempt={attempt}
                            selected={attempt.attempt_id === selectedHistoryAttempt?.attempt_id}
                            onSelect={setSelectedHistoryAttemptId}
                          />
                        ))}
                      </div>

                      {selectedHistoryAttempt ? (
                        <div className="space-y-4">
                          <div className="rounded-2xl bg-slate-50 p-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div>
                                <div className="text-sm font-semibold text-slate-900">
                                  {formatPoints(selectedHistoryAttempt.overall_score)} / {formatPoints(selectedHistoryAttempt.total_possible_score)}点
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {selectedHistoryAttempt.overall_percentage}% ・ {formatDateTime(selectedHistoryAttempt.scored_at)}
                                </div>
                              </div>
                              <div className="text-xs text-slate-500">
                                回答あり {selectedHistoryAttempt.answered_questions} / {selectedHistoryAttempt.total_questions}設問
                              </div>
                            </div>
                          </div>

                          {questionPackets.map((packet) => {
                            const questionResult = selectedHistoryAttempt.question_results.find((item) => item.question_key === packet.question_key);
                            const answerText = selectedHistoryAttempt.answers[packet.question_key] ?? '';
                            return (
                              <div key={`${selectedHistoryAttempt.attempt_id}-${packet.question_key}`} className="rounded-2xl border border-slate-200 p-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{packet.question_key}</div>
                                    <div className="mt-1 text-sm font-semibold leading-7 text-slate-900">{packet.prompt_text_clean}</div>
                                  </div>
                                  <div className="rounded-2xl bg-slate-900 px-3 py-2 text-right text-white">
                                    <div className="text-sm font-semibold">
                                      {formatPoints(questionResult?.score)} / {formatPoints(questionResult?.max_score)}点
                                    </div>
                                    <div className="text-xs text-slate-300">{questionResult?.score_percentage ?? 0}%</div>
                                  </div>
                                </div>
                                <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                                  文字数 {questionResult?.char_count ?? 0}{questionResult?.char_limit ? ` / ${questionResult.char_limit}` : ''}
                                </div>
                                <div className="mt-3 rounded-2xl bg-white px-1 py-1">
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-800 whitespace-pre-wrap">
                                    {answerText.trim() ? answerText : '未回答'}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
            )
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
              読み込める試験データがありません。管理画面で対象の年度・事例を選択してください。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AttemptHistoryCard({
  attempt,
  selected,
  onSelect,
}: {
  attempt: SecondaryAttemptHistoryItem;
  selected: boolean;
  onSelect: (attemptId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(attempt.attempt_id)}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-sky-500 bg-sky-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{formatPoints(attempt.overall_score)} / {formatPoints(attempt.total_possible_score)}点</div>
          <div className="mt-1 text-xs text-slate-500">{attempt.overall_percentage}% ・ {formatDateTime(attempt.scored_at)}</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{attempt.answered_questions} / {attempt.total_questions}設問</div>
          <div>{attempt.cached ? 'キャッシュ再利用' : '新規採点'}</div>
        </div>
      </div>
    </button>
  );
}
