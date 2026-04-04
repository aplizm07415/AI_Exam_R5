import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { BarChartIcon, FileTextIcon, LoaderIcon, PencilIcon } from './components/icons';
import { fetchSecondaryExamDashboard, fetchSecondaryExamDetail, gradeSecondaryExam, saveSecondaryExamDraft, } from './secondaryExam/api';
const LOCAL_DRAFT_KEY_PREFIX = 'secondary-exam-draft';
const PRACTICE_DURATION_OPTIONS = [40, 60, 80, 100, 120];
function getLocalDraftKey(examId) {
    return `${LOCAL_DRAFT_KEY_PREFIX}:${examId}`;
}
function formatDateTime(value) {
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
function formatMonthDay(value) {
    return value.toLocaleDateString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
    });
}
function toDateKey(value) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function startOfWeekSunday(value) {
    const next = new Date(value);
    next.setDate(value.getDate() - value.getDay());
    return next;
}
function endOfWeekSaturday(value) {
    const next = new Date(value);
    next.setDate(value.getDate() + (6 - value.getDay()));
    return next;
}
function countAnswerChars(text) {
    return text.replace(/\s+/g, '').length;
}
function formatRemainingTime(totalSeconds) {
    const safeSeconds = Math.max(0, totalSeconds);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
function formatPoints(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '-';
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function clampAnswerToLimit(text, limit) {
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
function statusLabel(status) {
    switch (status) {
        case 'graded':
            return '採点済み';
        case 'draft':
            return '下書き';
        default:
            return '未着手';
    }
}
function statusClassName(status) {
    switch (status) {
        case 'graded':
            return 'bg-emerald-100 text-emerald-800 border-emerald-200';
        case 'draft':
            return 'bg-amber-100 text-amber-800 border-amber-200';
        default:
            return 'bg-slate-100 text-slate-700 border-slate-200';
    }
}
function mergeDrafts(serverDraft, localDraft) {
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
function DashboardCard({ title, value, tone, }) {
    const toneClass = {
        slate: 'border border-slate-200 bg-[#f3f1eb] text-slate-900',
        emerald: 'border border-emerald-200 bg-[#e6f3ec] text-emerald-950',
        amber: 'border border-amber-200 bg-[#f7eddc] text-amber-950',
        sky: 'border border-sky-200 bg-[#e7f0f8] text-sky-950',
    }[tone];
    return (_jsxs("div", { className: `rounded-3xl p-5 shadow-sm ${toneClass}`, children: [_jsx("div", { className: "text-sm font-medium opacity-75", children: title }), _jsx("div", { className: "mt-2 text-3xl font-bold tracking-tight", children: value })] }));
}
export default function SecondaryExamPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [viewMode, setViewMode] = useState(searchParams.get('view') === 'dashboard' ? 'dashboard' : 'practice');
    const [dashboard, setDashboard] = useState(null);
    const [selectedExamId, setSelectedExamId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [answers, setAnswers] = useState({});
    const [activeQuestionKey, setActiveQuestionKey] = useState(null);
    const [practiceDurationMinutes, setPracticeDurationMinutes] = useState(80);
    const [sessionStarted, setSessionStarted] = useState(false);
    const [isTimerPaused, setIsTimerPaused] = useState(false);
    const [remainingSeconds, setRemainingSeconds] = useState(80 * 60);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isGrading, setIsGrading] = useState(false);
    const [saveMessage, setSaveMessage] = useState('未保存');
    const [error, setError] = useState('');
    const autosaveTimerRef = useRef(null);
    const catalog = dashboard?.catalog ?? [];
    const selectedCatalogItem = useMemo(() => catalog.find((item) => item.exam_id === selectedExamId) ?? null, [catalog, selectedExamId]);
    const questionPackets = detail?.bundle.normalized_scoring_input.question_prompt_packets ?? [];
    const referenceStatsMap = useMemo(() => {
        const map = new Map();
        for (const item of detail?.question_reference_stats ?? []) {
            const median = item.references.aas?.answer_char_stats?.median ?? item.references.aas?.answer_char_stats?.mean;
            if (typeof median === 'number') {
                map.set(item.question_key, Math.round(median));
            }
        }
        return map;
    }, [detail]);
    const yearOptions = useMemo(() => Array.from(new Set(catalog.map((item) => item.year_label))).sort((left, right) => right.localeCompare(left)), [catalog]);
    const selectedPracticeYear = selectedCatalogItem?.year_label ?? searchParams.get('year') ?? yearOptions[0] ?? '';
    const caseOptionsForYear = useMemo(() => catalog.filter((item) => item.year_label === selectedPracticeYear).sort((left, right) => left.case_no - right.case_no), [catalog, selectedPracticeYear]);
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
        const dayMap = new Map();
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
        const weeks = [];
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
    const updateViewMode = (nextViewMode) => {
        setViewMode(nextViewMode);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('view', nextViewMode);
        setSearchParams(nextParams, { replace: true });
    };
    const writeLocalDraft = (draftPayload, updatedAt) => {
        if (!detail) {
            return;
        }
        window.localStorage.setItem(getLocalDraftKey(detail.exam_id), JSON.stringify({
            ...draftPayload,
            updated_at: updatedAt ?? new Date().toISOString(),
        }));
    };
    const buildDraftPayload = (overrides) => ({
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
    const refreshDashboard = async (preferredExamId) => {
        const nextDashboard = await fetchSecondaryExamDashboard();
        setDashboard(nextDashboard);
        const requestedYear = searchParams.get('year');
        const requestedCase = Number(searchParams.get('case'));
        const fromSearch = nextDashboard.catalog.find((item) => item.year_label === requestedYear && item.case_no === requestedCase);
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
            }
            catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '二次試験データの読み込みに失敗しました。');
            }
            finally {
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
                const localDraft = localDraftRaw ? JSON.parse(localDraftRaw) : null;
                const merged = mergeDrafts(nextDetail.draft, localDraft);
                const firstQuestionKey = nextDetail.bundle.normalized_scoring_input.question_prompt_packets[0]?.question_key ?? null;
                setAnswers(merged.answers);
                setActiveQuestionKey(merged.activeQuestionKey ?? firstQuestionKey);
                setPracticeDurationMinutes(merged.timerDurationMinutes ?? 80);
                setSessionStarted(merged.sessionStarted);
                setIsTimerPaused(merged.timerPaused);
                setRemainingSeconds(merged.timerRemainingSeconds ?? ((merged.timerDurationMinutes ?? 80) * 60));
                setSaveMessage(merged.updatedAt ? `保存済み: ${formatDateTime(merged.updatedAt)}` : '未保存');
            }
            catch (nextError) {
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
    const syncSelectionToSearch = (exam, nextViewMode) => {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('year', exam.year_label);
        nextParams.set('case', String(exam.case_no));
        nextParams.set('view', nextViewMode ?? viewMode);
        setSearchParams(nextParams, { replace: true });
    };
    const handleSelectExam = (examId, nextViewMode) => {
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
    const handlePracticeYearChange = (yearLabel) => {
        const nextExam = catalog.find((item) => item.year_label === yearLabel && item.case_no === 1)
            ?? catalog.find((item) => item.year_label === yearLabel)
            ?? null;
        if (nextExam) {
            handleSelectExam(nextExam.exam_id, 'practice');
        }
    };
    const handlePracticeCaseChange = (caseNoRaw) => {
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
    const handleAnswerChange = (questionKey, value, limit) => {
        const nextValue = clampAnswerToLimit(value, limit);
        setAnswers((current) => ({
            ...current,
            [questionKey]: nextValue,
        }));
    };
    const saveDraft = async (overrides) => {
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
        }
        catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : '下書き保存に失敗しました。');
            return null;
        }
        finally {
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
        }
        catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : '採点に失敗しました。');
        }
        finally {
            setIsGrading(false);
        }
    };
    if (isLoading) {
        return _jsx(LoadingSpinner, {});
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("section", { className: "rounded-[2rem] bg-gradient-to-br from-[#0f172a] via-[#12355b] to-[#1d4f91] p-6 text-white shadow-xl md:p-8", children: _jsxs("div", { className: "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "max-w-3xl", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.28em] text-sky-200", children: "Secondary Exam Studio" }), _jsx("h2", { className: "mt-3 text-3xl font-bold leading-tight md:text-4xl", children: "\u4E8C\u6B21\u8A66\u9A13\u7279\u5316\u306E\u5C02\u7528\u6F14\u7FD2\u753B\u9762" }), _jsx("p", { className: "mt-3 text-sm leading-7 text-sky-100", children: "\u554F\u984CPDF\u306F\u6F14\u7FD2\u958B\u59CB\u6642\u306B\u5225\u30BF\u30D6\u3067\u958B\u304D\u3001\u3053\u306E\u753B\u9762\u3067\u306F\u7B54\u6848\u4F5C\u6210\u3060\u3051\u306B\u96C6\u4E2D\u3067\u304D\u307E\u3059\u3002" })] }), _jsxs("div", { className: "inline-flex rounded-2xl bg-white/10 p-1 backdrop-blur", children: [_jsxs("button", { type: "button", onClick: () => updateViewMode('practice'), className: `inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${viewMode === 'practice' ? 'bg-white text-slate-900' : 'text-white/85'}`, children: [_jsx(PencilIcon, { className: "h-4 w-4" }), "\u6F14\u7FD2"] }), _jsxs("button", { type: "button", onClick: () => updateViewMode('dashboard'), className: `inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${viewMode === 'dashboard' ? 'bg-white text-slate-900' : 'text-white/85'}`, children: [_jsx(BarChartIcon, { className: "h-4 w-4" }), "\u7BA1\u7406"] })] })] }) }), error ? (_jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error })) : null, dashboard && viewMode === 'dashboard' ? (_jsxs("section", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(DashboardCard, { title: "\u7DCF\u4E8B\u4F8B\u6570", value: dashboard.summary.total_exams, tone: "slate" }), _jsx(DashboardCard, { title: "\u63A1\u70B9\u6E08\u307F", value: dashboard.summary.graded_exams, tone: "emerald" }), _jsx(DashboardCard, { title: "\u4E0B\u66F8\u304D\u4E2D", value: dashboard.summary.draft_exams, tone: "amber" }), _jsx(DashboardCard, { title: "\u672A\u7740\u624B", value: dashboard.summary.untouched_exams, tone: "sky" })] })) : null, _jsx("section", { children: viewMode === 'dashboard' && dashboard ? (_jsxs("div", { className: "grid items-stretch gap-6 xl:grid-cols-3", children: [_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "New Practice" }), _jsx("h3", { className: "mt-2 text-lg font-semibold text-slate-900", children: "\u65B0\u898F\u3067\u30C6\u30B9\u30C8\u3092\u59CB\u3081\u308B" }), _jsx("div", { className: "mt-4 space-y-3", children: catalog.map((item) => (_jsxs("div", { className: `rounded-2xl border px-4 py-4 ${item.exam_id === selectedExamId ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white'}`, children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-sm font-semibold text-slate-900", children: item.title }), _jsxs("div", { className: "mt-1 text-xs text-slate-500", children: ["\u8A2D\u554F\u6570 ", item.question_count] })] }), _jsx("span", { className: `rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClassName(item.status)}`, children: statusLabel(item.status) })] }), _jsxs("div", { className: "mt-4 flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => handleSelectExam(item.exam_id, 'practice'), className: "rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800", children: "\u6F14\u7FD2\u753B\u9762\u3078" }), item.latest_attempt_at ? (_jsx("button", { type: "button", onClick: () => {
                                                            const latestAttempt = dashboard.recent_attempts.find((attempt) => attempt.exam_id === item.exam_id)
                                                                ?? dashboard.all_attempts.find((attempt) => attempt.exam_id === item.exam_id);
                                                            if (latestAttempt) {
                                                                navigate(`/secondary-exam/results/${latestAttempt.attempt_id}`);
                                                            }
                                                        }, className: "rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50", children: "\u6700\u65B0\u7D50\u679C\u3092\u898B\u308B" })) : null] })] }, item.exam_id))) })] }), _jsxs("div", { className: "space-y-6 xl:col-span-2", children: [_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-4 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "History Review" }), _jsx("h3", { className: "mt-2 text-lg font-semibold text-slate-900", children: "\u5C65\u6B74\u3054\u3068\u306E\u632F\u308A\u8FD4\u308A" }), _jsx("div", { className: "mt-4 space-y-3", children: dashboard.recent_attempts.length === 0 ? (_jsx("div", { className: "rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500", children: "\u307E\u3060\u63A1\u70B9\u5C65\u6B74\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (dashboard.recent_attempts.slice(0, 8).map((attempt) => (_jsxs("button", { type: "button", onClick: () => navigate(`/secondary-exam/results/${attempt.attempt_id}`), className: "w-full rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { className: "text-sm font-semibold text-slate-900", children: [attempt.year_label, " \u4E8B\u4F8B", attempt.case_no] }), _jsxs("div", { className: "rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white", children: [formatPoints(attempt.overall_score), "\u70B9"] })] }), _jsx("div", { className: "mt-2 text-xs text-slate-500", children: formatDateTime(attempt.scored_at) })] }, attempt.attempt_id)))) })] }), dashboardCalendar ? (_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Scoring Calendar" }), _jsxs("h3", { className: "mt-1 text-lg font-semibold text-slate-900", children: [dashboardCalendar.displayYear, "\u5E74 ", dashboardCalendar.startLabel, " - ", dashboardCalendar.endLabel] })] }), _jsx("div", { className: "text-xs text-slate-500", children: "\u5404\u65E5\u4ED8\u304B\u3089\u3001\u305D\u306E\u56DE\u306E\u63A1\u70B9\u7D50\u679C\u30DA\u30FC\u30B8\u3078\u76F4\u63A5\u79FB\u52D5\u3067\u304D\u307E\u3059\u3002" })] }), _jsx("div", { className: "mt-5 overflow-x-auto", children: _jsxs("div", { className: "min-w-[980px]", children: [_jsx("div", { className: "grid grid-cols-7 gap-2", children: ['日', '月', '火', '水', '木', '金', '土'].map((label) => (_jsx("div", { className: "px-2 py-2 text-center text-xs font-semibold text-slate-500", children: label }, label))) }), _jsx("div", { className: "mt-2 space-y-2", children: dashboardCalendar.weeks.map((week) => (_jsx("div", { className: "grid grid-cols-7 gap-2", children: week.map((day) => (_jsxs("div", { className: `min-h-[132px] rounded-2xl border p-2 ${day.inRange ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-slate-50/40'}`, children: [_jsxs("div", { className: `text-xs font-semibold ${day.inRange ? 'text-slate-700' : 'text-slate-300'}`, children: [day.date.getMonth() + 1, "/", day.date.getDate()] }), _jsx("div", { className: "mt-2 space-y-1.5", children: day.attempts.map((attempt) => (_jsxs("button", { type: "button", onClick: () => navigate(`/secondary-exam/results/${attempt.attempt_id}`), className: "block w-full rounded-xl bg-white px-2 py-2 text-left shadow-sm ring-1 ring-slate-200 hover:bg-sky-50 hover:ring-sky-200", children: [_jsxs("div", { className: "text-[11px] font-semibold text-slate-900", children: [attempt.year_label, " \u4E8B\u4F8B", attempt.case_no] }), _jsxs("div", { className: "mt-0.5 text-[11px] text-sky-700", children: [formatPoints(attempt.overall_score), "\u70B9"] })] }, attempt.attempt_id))) })] }, day.key))) }, week[0]?.key ?? 'week'))) })] }) })] })) : null] })] })) : detail ? (!sessionStarted ? (_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Practice Setup" }), _jsx("h3", { className: "mt-2 text-2xl font-semibold text-slate-900", children: "\u6F14\u7FD2\u3092\u958B\u59CB\u3059\u308B\u524D\u306B\u8A2D\u5B9A\u3057\u307E\u3059" }), _jsxs("div", { className: "mt-6 grid gap-5 lg:grid-cols-3", children: [_jsxs("label", { className: "space-y-2", children: [_jsx("div", { className: "text-sm font-semibold text-slate-700", children: "\u5E74\u5EA6" }), _jsx("select", { value: selectedPracticeYear, onChange: (event) => handlePracticeYearChange(event.target.value), className: "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900", children: yearOptions.map((yearLabel) => (_jsx("option", { value: yearLabel, children: yearLabel }, yearLabel))) })] }), _jsxs("label", { className: "space-y-2", children: [_jsx("div", { className: "text-sm font-semibold text-slate-700", children: "\u4E8B\u4F8B" }), _jsx("select", { value: selectedCatalogItem?.case_no ?? '', onChange: (event) => handlePracticeCaseChange(event.target.value), className: "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900", children: caseOptionsForYear.map((item) => (_jsxs("option", { value: item.case_no, children: ["\u4E8B\u4F8B", item.case_no] }, item.exam_id))) })] }), _jsxs("label", { className: "space-y-2", children: [_jsx("div", { className: "text-sm font-semibold text-slate-700", children: "\u6F14\u7FD2\u6642\u9593" }), _jsx("select", { value: practiceDurationMinutes, onChange: (event) => setPracticeDurationMinutes(Number(event.target.value)), className: "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900", children: PRACTICE_DURATION_OPTIONS.map((minutes) => (_jsxs("option", { value: minutes, children: [minutes, "\u5206"] }, minutes))) })] })] }), _jsxs("div", { className: "mt-6 rounded-2xl bg-slate-50 p-5", children: [_jsx("div", { className: "text-sm font-semibold text-slate-900", children: selectedCatalogItem?.title }), _jsx("div", { className: "mt-2 text-sm text-slate-600", children: hasDraftAnswers
                                        ? `下書きあり。${sessionStarted ? `残り時間 ${formatRemainingTime(remainingSeconds)} で再開できます。` : '保存済みの答案から続けられます。'}`
                                        : '演習開始時に問題文PDFを別タブで開きます。回答入力ページにはPDFを表示しません。' })] }), _jsxs("div", { className: "mt-6 flex flex-wrap justify-end gap-3", children: [_jsxs("button", { type: "button", onClick: openProblemPdf, className: "inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50", children: [_jsx(FileTextIcon, { className: "h-4 w-4" }), "\u554F\u984CPDF\u3092\u958B\u304F"] }), _jsxs("button", { type: "button", onClick: handleStartPractice, className: "inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800", children: [_jsx(PencilIcon, { className: "h-4 w-4" }), hasResumableSession ? '演習を再開' : '演習を開始'] })] })] })) : (_jsxs("div", { className: "space-y-5", children: [_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Writing Desk" }), _jsxs("h3", { className: "mt-1 text-xl font-semibold text-slate-900", children: [detail.bundle.year_label, " \u4E8B\u4F8B", detail.bundle.case_no, " \u7B54\u6848\u4F5C\u6210"] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [timerLabel ? (_jsxs("div", { className: `rounded-full px-4 py-2 text-sm font-semibold ${remainingSeconds === 0 ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`, children: ["\u6B8B\u308A ", timerLabel] })) : null, _jsx("div", { className: "rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600", children: saveMessage }), _jsx("button", { type: "button", onClick: openProblemPdf, className: "rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50", children: "\u554F\u984CPDF\u3092\u5225\u30BF\u30D6\u3067\u958B\u304F" }), _jsx("button", { type: "button", onClick: isTimerPaused ? handleResumeTimer : handlePauseTimer, className: "rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50", children: isTimerPaused ? '再開' : '一時停止' }), _jsx("button", { type: "button", onClick: () => void handleSaveAndReturn(), disabled: isSaving, className: "rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60", children: isSaving ? '保存中...' : '一時保存して管理へ' }), _jsxs("button", { type: "button", onClick: () => void handleGrade(), disabled: isGrading, className: "inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60", children: [isGrading ? _jsx(LoaderIcon, { className: "h-4 w-4 animate-spin" }) : null, isGrading ? '採点中...' : 'AI採点へ進む'] })] })] }) }), _jsx("div", { className: "space-y-4", children: questionPackets.map((packet) => {
                                const text = answers[packet.question_key] ?? '';
                                const charCount = countAnswerChars(text);
                                const limit = packet.char_limit;
                                const referenceMedian = referenceStatsMap.get(packet.question_key);
                                return (_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("button", { type: "button", onClick: () => setActiveQuestionKey(packet.question_key), className: `rounded-full px-3 py-1 text-xs font-semibold ${activeQuestionKey === packet.question_key ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`, children: packet.question_key }), _jsx("div", { className: "text-sm font-semibold leading-7 text-slate-900", children: packet.prompt_text_clean })] }), _jsxs("div", { className: "flex flex-wrap gap-2 text-xs", children: [_jsxs("span", { className: "rounded-full bg-slate-100 px-3 py-2 font-semibold text-slate-700", children: ["\u5236\u9650 ", limit ?? 'なし', "\u5B57"] }), referenceMedian ? (_jsxs("span", { className: "rounded-full bg-sky-50 px-3 py-2 font-semibold text-sky-700", children: ["\u518D\u73FE\u7B54\u6848\u4E2D\u592E\u5024 ", referenceMedian, "\u5B57"] })) : null] })] }), _jsx("div", { className: "mt-4", children: _jsx("textarea", { value: text, onChange: (event) => handleAnswerChange(packet.question_key, event.target.value, limit), className: "min-h-[180px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-400", placeholder: "\u3053\u3053\u306B\u7B54\u6848\u3092\u5165\u529B\u3057\u307E\u3059\u3002" }) }), _jsxs("div", { className: "mt-3 text-xs text-slate-500", children: ["\u6587\u5B57\u6570 ", charCount, typeof limit === 'number' ? ` / ${limit}` : ''] })] }, packet.question_key));
                            }) })] }))) : (_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm", children: "\u8AAD\u307F\u8FBC\u3081\u308B\u8A66\u9A13\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u7BA1\u7406\u753B\u9762\u3067\u5BFE\u8C61\u306E\u5E74\u5EA6\u30FB\u4E8B\u4F8B\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })) })] }));
}
//# sourceMappingURL=SecondaryExamPage.js.map