import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import { BarChartIcon, FileTextIcon, LoaderIcon, PencilIcon } from './components/icons';
import { askSecondaryExamOralViva, fetchSecondaryExamDashboard, fetchSecondaryExamDetail, gradeSecondaryExam, saveSecondaryExamDraft, } from './secondaryExam/api';
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
function countAnswerChars(text) {
    return text.replace(/\s+/g, '').length;
}
function formatPoints(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '-';
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function formatRemainingTime(totalSeconds) {
    const safeSeconds = Math.max(0, totalSeconds);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
function normalizeQuestionNo(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim();
}
function getBundleExplanation(detail, packet) {
    return (detail.bundle.explanations ?? []).find((item) => normalizeQuestionNo(item.question_no) === normalizeQuestionNo(packet.question_no));
}
function getBundleRubric(detail, packet) {
    return (detail.bundle.rubrics ?? []).find((item) => normalizeQuestionNo(item.question_no) === normalizeQuestionNo(packet.question_no));
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
function DashboardCard({ title, value, tone, }) {
    const toneClass = {
        slate: 'border border-slate-200 bg-[#f3f1eb] text-slate-900',
        emerald: 'border border-emerald-200 bg-[#e6f3ec] text-emerald-950',
        amber: 'border border-amber-200 bg-[#f7eddc] text-amber-950',
        sky: 'border border-sky-200 bg-[#e7f0f8] text-sky-950',
    }[tone];
    return (_jsxs("div", { className: `rounded-3xl p-5 shadow-sm ${toneClass}`, children: [_jsx("div", { className: "text-sm font-medium opacity-75", children: title }), _jsx("div", { className: "mt-2 text-3xl font-bold tracking-tight", children: value })] }));
}
function QuestionResultCard({ packet, result, }) {
    if (!result) {
        return null;
    }
    return (_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: packet.question_key }), _jsx("div", { className: "mt-1 text-sm font-semibold text-slate-900", children: packet.prompt_text_clean })] }), _jsxs("div", { className: "rounded-2xl bg-slate-900 px-3 py-2 text-right text-white", children: [_jsxs("div", { className: "text-sm font-semibold", children: [formatPoints(result.score), " / ", formatPoints(result.max_score), "\u70B9"] }), _jsxs("div", { className: "text-xs text-slate-300", children: [result.score_percentage, "%"] })] })] }), _jsxs("div", { className: "mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-3", children: [_jsxs("div", { className: "rounded-xl bg-slate-50 px-3 py-2", children: ["\u6587\u5B57\u6570: ", result.char_count, result.char_limit ? ` / ${result.char_limit}` : ''] }), _jsxs("div", { className: "rounded-xl bg-slate-50 px-3 py-2", children: ["\u89B3\u70B9\u4E00\u81F4: ", result.coverage_score] }), _jsxs("div", { className: "rounded-xl bg-slate-50 px-3 py-2", children: ["\u8A2D\u554F\u5BFE\u5FDC: ", result.prompt_score] })] }), _jsxs("div", { className: "mt-4 grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500", children: "\u826F\u3044\u70B9" }), _jsx("ul", { className: "mt-2 space-y-2 text-sm text-slate-700", children: result.positives.map((item) => (_jsx("li", { className: "rounded-xl bg-emerald-50 px-3 py-2", children: item }, item))) })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-rose-500", children: "\u6539\u5584\u30DD\u30A4\u30F3\u30C8" }), _jsx("ul", { className: "mt-2 space-y-2 text-sm text-slate-700", children: result.improvement_points.map((item) => (_jsx("li", { className: "rounded-xl bg-rose-50 px-3 py-2", children: item }, item))) })] })] }), _jsxs("div", { className: "mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700", children: [_jsx("div", { className: "font-semibold text-sky-700", children: "\u30A2\u30C9\u30D0\u30A4\u30B9" }), _jsx("div", { className: "mt-1", children: result.advice })] })] }));
}
export default function SecondaryExamPage() {
    const [viewMode, setViewMode] = useState('practice');
    const [dashboard, setDashboard] = useState(null);
    const [selectedExamId, setSelectedExamId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [answers, setAnswers] = useState({});
    const [activeQuestionKey, setActiveQuestionKey] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isGrading, setIsGrading] = useState(false);
    const [saveMessage, setSaveMessage] = useState('未保存');
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [selectedHistoryAttemptId, setSelectedHistoryAttemptId] = useState(null);
    const [practiceDurationMinutes, setPracticeDurationMinutes] = useState(80);
    const [sessionStarted, setSessionStarted] = useState(false);
    const [sessionEndsAt, setSessionEndsAt] = useState(null);
    const [remainingSeconds, setRemainingSeconds] = useState(80 * 60);
    const [oralVivaInput, setOralVivaInput] = useState('');
    const [oralVivaConversation, setOralVivaConversation] = useState([]);
    const [oralVivaSuggestedFollowups, setOralVivaSuggestedFollowups] = useState([]);
    const [oralVivaCitedQuestionKeys, setOralVivaCitedQuestionKeys] = useState([]);
    const [isAskingOralViva, setIsAskingOralViva] = useState(false);
    const autosaveTimerRef = useRef(null);
    const catalog = dashboard?.catalog ?? [];
    const selectedCatalogItem = useMemo(() => catalog.find((item) => item.exam_id === selectedExamId) ?? null, [catalog, selectedExamId]);
    const questionPackets = detail?.bundle.normalized_scoring_input.question_prompt_packets ?? [];
    const resultHistory = detail?.result_history ?? [];
    const referenceStatsMap = useMemo(() => {
        const map = new Map();
        for (const item of detail?.question_reference_stats ?? []) {
            map.set(item.question_key, item);
        }
        return map;
    }, [detail]);
    const selectedHistoryAttempt = useMemo(() => resultHistory.find((item) => item.attempt_id === selectedHistoryAttemptId) ?? resultHistory[0] ?? null, [resultHistory, selectedHistoryAttemptId]);
    const yearOptions = useMemo(() => Array.from(new Set(catalog.map((item) => item.year_label))).sort((left, right) => right.localeCompare(left)), [catalog]);
    const selectedPracticeYear = selectedCatalogItem?.year_label ?? yearOptions[0] ?? '';
    const caseOptionsForYear = useMemo(() => catalog.filter((item) => item.year_label === selectedPracticeYear).sort((left, right) => left.case_no - right.case_no), [catalog, selectedPracticeYear]);
    const timerLabel = sessionEndsAt ? formatRemainingTime(remainingSeconds) : null;
    const refreshDashboard = async (preferredExamId) => {
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
                const localDraft = localDraftRaw ? JSON.parse(localDraftRaw) : null;
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
            }
            catch (nextError) {
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
    const handleSelectExam = (examId) => {
        setSelectedExamId(examId);
        setViewMode('practice');
        setSessionStarted(false);
        setSessionEndsAt(null);
        setRemainingSeconds(practiceDurationMinutes * 60);
    };
    const handlePracticeYearChange = (yearLabel) => {
        const nextExam = catalog.find((item) => item.year_label === yearLabel && item.case_no === 1)
            ?? catalog.find((item) => item.year_label === yearLabel)
            ?? null;
        if (nextExam) {
            setSelectedExamId(nextExam.exam_id);
            setSessionStarted(false);
            setSessionEndsAt(null);
        }
    };
    const handlePracticeCaseChange = (caseNoRaw) => {
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
    const handleAnswerChange = (questionKey, value, limit) => {
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
        }
        catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : '下書き保存に失敗しました。');
        }
        finally {
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
        }
        catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : '採点に失敗しました。');
        }
        finally {
            setIsGrading(false);
        }
    };
    const handleAskOralViva = async (prefilledQuestion) => {
        if (!detail || !result) {
            return;
        }
        const question = (prefilledQuestion ?? oralVivaInput).trim();
        if (!question) {
            return;
        }
        const nextConversation = [...oralVivaConversation, { role: 'user', content: question }];
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
        }
        catch (nextError) {
            setOralVivaConversation((current) => current.slice(0, -1));
            setError(nextError instanceof Error ? nextError.message : '口頭試問Q&Aに失敗しました。');
            setOralVivaInput(question);
        }
        finally {
            setIsAskingOralViva(false);
        }
    };
    if (isLoading) {
        return _jsx(LoadingSpinner, {});
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("section", { className: "rounded-[2rem] bg-gradient-to-br from-[#0f172a] via-[#12355b] to-[#1d4f91] p-6 text-white shadow-xl md:p-8", children: _jsxs("div", { className: "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "max-w-3xl", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.28em] text-sky-200", children: "Secondary Exam Studio" }), _jsx("h2", { className: "mt-3 text-3xl font-bold leading-tight md:text-4xl", children: "\u4E8C\u6B21\u8A66\u9A13\u7279\u5316\u306E\u5C02\u7528\u6F14\u7FD2\u753B\u9762" })] }), _jsxs("div", { className: "inline-flex rounded-2xl bg-white/10 p-1 backdrop-blur", children: [_jsxs("button", { type: "button", onClick: () => setViewMode('practice'), className: `inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${viewMode === 'practice' ? 'bg-white text-slate-900' : 'text-white/85'}`, children: [_jsx(PencilIcon, { className: "h-4 w-4" }), "\u6F14\u7FD2"] }), _jsxs("button", { type: "button", onClick: () => setViewMode('dashboard'), className: `inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${viewMode === 'dashboard' ? 'bg-white text-slate-900' : 'text-white/85'}`, children: [_jsx(BarChartIcon, { className: "h-4 w-4" }), "\u7BA1\u7406"] })] })] }) }), error ? (_jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error })) : null, dashboard && viewMode === 'dashboard' ? (_jsxs("section", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(DashboardCard, { title: "\u7DCF\u4E8B\u4F8B\u6570", value: dashboard.summary.total_exams, tone: "slate" }), _jsx(DashboardCard, { title: "\u63A1\u70B9\u6E08\u307F", value: dashboard.summary.graded_exams, tone: "emerald" }), _jsx(DashboardCard, { title: "\u4E0B\u66F8\u304D\u4E2D", value: dashboard.summary.draft_exams, tone: "amber" }), _jsx(DashboardCard, { title: "\u672A\u7740\u624B", value: dashboard.summary.untouched_exams, tone: "sky" })] })) : null, _jsx("section", { children: _jsx("div", { className: "min-w-0", children: viewMode === 'dashboard' && dashboard ? (_jsxs("div", { className: "grid items-stretch gap-6 xl:grid-cols-3", children: [_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1 flex h-full flex-col", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Exam Catalog" }), _jsx("div", { className: "mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1", children: catalog.map((item) => (_jsxs("button", { type: "button", onClick: () => handleSelectExam(item.exam_id), className: `w-full rounded-2xl border px-4 py-3 text-left transition ${item.exam_id === selectedExamId
                                                ? 'border-sky-500 bg-sky-50 shadow-sm'
                                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`, children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-sm font-semibold text-slate-900", children: item.title }), _jsxs("div", { className: "mt-1 text-xs text-slate-500", children: ["\u8A2D\u554F\u6570 ", item.question_count] })] }), _jsx("span", { className: `rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClassName(item.status)}`, children: statusLabel(item.status) })] }), _jsxs("div", { className: "mt-3 flex items-center justify-between text-xs text-slate-500", children: [_jsxs("span", { children: ["\u521D\u56DE ", typeof item.first_score === 'number' ? formatPoints(item.first_score) : '-'] }), _jsxs("span", { children: ["\u6700\u9AD8 ", typeof item.best_score === 'number' ? formatPoints(item.best_score) : '-'] }), _jsx("span", { children: item.latest_attempt_at ? formatDateTime(item.latest_attempt_at) : '履歴なし' })] })] }, item.exam_id))) })] }), _jsxs("div", { className: "space-y-6 xl:col-span-2", children: [_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-4 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Recent Attempts" }), _jsx("div", { className: "mt-4 space-y-3", children: dashboard.recent_attempts.length === 0 ? (_jsx("div", { className: "rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500", children: "\u307E\u3060\u63A1\u70B9\u5C65\u6B74\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (dashboard.recent_attempts.slice(0, 6).map((attempt) => (_jsxs("button", { type: "button", onClick: () => handleSelectExam(attempt.exam_id), className: "w-full rounded-2xl bg-slate-50 px-4 py-3 text-left hover:bg-slate-100", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { className: "text-sm font-semibold text-slate-900", children: [attempt.year_label, " \u4E8B\u4F8B", attempt.case_no] }), _jsxs("div", { className: "rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white", children: [formatPoints(attempt.overall_score), "\u70B9"] })] }), _jsx("div", { className: "mt-2 text-xs text-slate-500", children: formatDateTime(attempt.scored_at) })] }, attempt.attempt_id)))) })] }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(BarChartIcon, { className: "h-5 w-5 text-sky-600" }), _jsx("h3", { className: "text-lg font-semibold text-slate-900", children: "\u9032\u6357\u4E00\u89A7" })] }), _jsx("div", { className: "mt-5 overflow-x-auto", children: _jsxs("table", { className: "min-w-full text-sm", children: [_jsx("thead", { className: "text-left text-slate-500", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-2 font-medium", children: "\u5E74\u5EA6 / \u4E8B\u4F8B" }), _jsx("th", { className: "px-3 py-2 font-medium", children: "\u72B6\u614B" }), _jsx("th", { className: "px-3 py-2 font-medium", children: "\u521D\u56DE" }), _jsx("th", { className: "px-3 py-2 font-medium", children: "\u6700\u9AD8\u70B9" }), _jsx("th", { className: "px-3 py-2 font-medium", children: "\u63A1\u70B9\u56DE\u6570" })] }) }), _jsx("tbody", { children: catalog.map((item) => (_jsxs("tr", { className: "cursor-pointer border-t border-slate-100 hover:bg-slate-50", onClick: () => handleSelectExam(item.exam_id), children: [_jsx("td", { className: "px-3 py-3 font-medium text-slate-900", children: item.title }), _jsx("td", { className: "px-3 py-3", children: _jsx("span", { className: `rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClassName(item.status)}`, children: statusLabel(item.status) }) }), _jsx("td", { className: "px-3 py-3 text-slate-600", children: typeof item.first_score === 'number' ? formatPoints(item.first_score) : '-' }), _jsx("td", { className: "px-3 py-3 text-slate-600", children: typeof item.best_score === 'number' ? formatPoints(item.best_score) : '-' }), _jsx("td", { className: "px-3 py-3 text-slate-600", children: item.attempt_count })] }, item.exam_id))) })] }) })] })] })] })) : detail ? (!sessionStarted ? (_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Practice Setup" }), _jsx("h3", { className: "mt-2 text-2xl font-semibold text-slate-900", children: "\u6F14\u7FD2\u3092\u958B\u59CB\u3059\u308B\u524D\u306B\u8A2D\u5B9A\u3057\u307E\u3059" }), _jsxs("div", { className: "mt-6 grid gap-5 lg:grid-cols-3", children: [_jsxs("label", { className: "space-y-2", children: [_jsx("div", { className: "text-sm font-semibold text-slate-700", children: "\u5E74\u5EA6" }), _jsx("select", { value: selectedPracticeYear, onChange: (event) => handlePracticeYearChange(event.target.value), className: "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900", children: yearOptions.map((yearLabel) => (_jsx("option", { value: yearLabel, children: yearLabel }, yearLabel))) })] }), _jsxs("label", { className: "space-y-2", children: [_jsx("div", { className: "text-sm font-semibold text-slate-700", children: "\u4E8B\u4F8B" }), _jsx("select", { value: selectedCatalogItem?.case_no ?? '', onChange: (event) => handlePracticeCaseChange(event.target.value), className: "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900", children: caseOptionsForYear.map((item) => (_jsxs("option", { value: item.case_no, children: ["\u4E8B\u4F8B", item.case_no] }, item.exam_id))) })] }), _jsxs("label", { className: "space-y-2", children: [_jsx("div", { className: "text-sm font-semibold text-slate-700", children: "\u6F14\u7FD2\u6642\u9593" }), _jsx("select", { value: practiceDurationMinutes, onChange: (event) => setPracticeDurationMinutes(Number(event.target.value)), className: "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900", children: PRACTICE_DURATION_OPTIONS.map((minutes) => (_jsxs("option", { value: minutes, children: [minutes, "\u5206"] }, minutes))) })] })] }), _jsxs("div", { className: "mt-6 rounded-2xl bg-slate-50 p-5", children: [_jsx("div", { className: "text-sm font-semibold text-slate-900", children: selectedCatalogItem?.title }), _jsx("div", { className: "mt-2 text-sm text-slate-600", children: "\u3053\u306E\u8A2D\u5B9A\u3067\u59CB\u3081\u308B\u3068\u3001\u6F14\u7FD2\u4E2D\u306F\u6B8B\u308A\u6642\u9593\u3092\u53F3\u5074\u306B\u8868\u793A\u3057\u307E\u3059\u3002" })] }), _jsx("div", { className: "mt-6 flex justify-end", children: _jsxs("button", { type: "button", onClick: handleStartPractice, className: "inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800", children: [_jsx(PencilIcon, { className: "h-4 w-4" }), "\u6F14\u7FD2\u3092\u958B\u59CB"] }) })] })) : (_jsxs("div", { className: "grid items-stretch gap-6 2xl:grid-cols-2", children: [_jsxs("section", { className: "min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm flex h-full flex-col", children: [_jsxs("div", { className: "flex items-center justify-between gap-3 border-b border-slate-100 pb-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Problem PDF" }), _jsxs("h3", { className: "mt-1 text-lg font-semibold text-slate-900", children: [detail.bundle.year_label, " \u4E8B\u4F8B", detail.bundle.case_no] })] }), _jsxs("a", { href: detail.pdf_url, target: "_blank", rel: "noreferrer", className: "inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50", children: [_jsx(FileTextIcon, { className: "h-4 w-4" }), "\u5225\u30BF\u30D6\u3067\u958B\u304F"] })] }), _jsx("div", { className: "mt-4 min-h-[70vh] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50", children: _jsx("iframe", { title: `${detail.bundle.year_label}-case${detail.bundle.case_no}-pdf`, src: detail.pdf_url, className: "h-full w-full" }, detail.pdf_url) })] }), _jsxs("section", { className: "min-w-0 space-y-5", children: [_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Writing Desk" }), _jsxs("h3", { className: "mt-1 text-xl font-semibold text-slate-900", children: [detail.bundle.year_label, " \u4E8B\u4F8B", detail.bundle.case_no, " \u7B54\u6848\u4F5C\u6210"] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [timerLabel ? (_jsxs("div", { className: `rounded-full px-4 py-2 text-sm font-semibold ${remainingSeconds === 0 ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`, children: ["\u6B8B\u308A ", timerLabel] })) : null, _jsx("div", { className: "rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600", children: saveMessage }), _jsx("button", { type: "button", onClick: handleSaveNow, disabled: isSaving, className: "rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60", children: isSaving ? '保存中...' : '今すぐ保存' }), _jsxs("button", { type: "button", onClick: handleGrade, disabled: isGrading, className: "inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60", children: [isGrading ? _jsx(LoaderIcon, { className: "h-4 w-4 animate-spin" }) : null, isGrading ? '採点中...' : 'AI採点'] })] })] }) }), _jsx("div", { className: "space-y-4", children: questionPackets.map((packet) => {
                                            const text = answers[packet.question_key] ?? '';
                                            const charCount = countAnswerChars(text);
                                            const limit = packet.char_limit;
                                            const ref = referenceStatsMap.get(packet.question_key)?.references.aas?.answer_char_stats;
                                            const overLimit = typeof limit === 'number' && charCount > limit;
                                            return (_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("button", { type: "button", onClick: () => setActiveQuestionKey(packet.question_key), className: `rounded-full px-3 py-1 text-xs font-semibold ${activeQuestionKey === packet.question_key ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`, children: packet.question_key }), _jsx("div", { className: "text-sm font-semibold leading-7 text-slate-900", children: packet.prompt_text_clean })] }), _jsxs("div", { className: "flex flex-wrap gap-2 text-xs", children: [_jsxs("span", { className: "rounded-full bg-slate-100 px-3 py-2 font-semibold text-slate-700", children: ["\u5236\u9650 ", limit ?? 'なし', "\u5B57"] }), ref ? (_jsxs("span", { className: "rounded-full bg-sky-50 px-3 py-2 font-semibold text-sky-700", children: ["\u518D\u73FE\u7B54\u6848\u4E2D\u592E\u5024 ", Math.round(ref.median ?? ref.mean ?? 0), "\u5B57"] })) : null] })] }), _jsx("div", { className: "mt-4", children: _jsx("textarea", { value: text, onChange: (event) => handleAnswerChange(packet.question_key, event.target.value, limit), className: `min-h-[180px] w-full rounded-2xl border bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition ${overLimit ? 'border-rose-300 focus:border-rose-400' : 'border-slate-200 focus:border-sky-400'}`, placeholder: "\u3053\u3053\u306B\u7B54\u6848\u3092\u5165\u529B\u3057\u307E\u3059\u3002" }) }), _jsx("div", { className: "mt-3 flex flex-wrap items-center justify-between gap-3 text-xs", children: _jsxs("div", { className: `${overLimit ? 'text-rose-600' : 'text-slate-500'}`, children: ["\u6587\u5B57\u6570 ", charCount, typeof limit === 'number' ? ` / ${limit}` : ''] }) })] }, packet.question_key));
                                        }) }), result ? (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Scoring Result" }), _jsxs("h3", { className: "mt-1 text-xl font-semibold text-slate-900", children: ["\u7DCF\u5408 ", formatPoints(result.overall_score), " / ", formatPoints(result.total_possible_score), "\u70B9"] }), _jsxs("div", { className: "mt-1 text-sm font-semibold text-sky-700", children: [result.overall_percentage, "%"] }), _jsx("p", { className: "mt-2 text-sm leading-7 text-slate-600", children: result.overall_feedback.summary })] }), _jsxs("div", { className: "rounded-3xl bg-slate-900 px-5 py-4 text-white", children: [_jsx("div", { className: "text-xs uppercase tracking-[0.2em] text-slate-300", children: "Last Graded" }), _jsx("div", { className: "mt-2 text-sm font-semibold", children: formatDateTime(result.scored_at) }), _jsx("div", { className: "mt-1 text-xs text-slate-300", children: result.cached ? '同一答案のキャッシュ結果' : result.overall_feedback.used_ai ? 'AI採点を使用' : 'ローカル評価を使用' })] })] }), _jsx("div", { className: "mt-4 flex flex-wrap gap-2", children: result.overall_feedback.priority_actions.map((item) => (_jsx("span", { className: "rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700", children: item }, item))) })] }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Case Oral Viva" }), _jsx("h3", { className: "mt-1 text-xl font-semibold text-slate-900", children: "\u5E74\u5EA6/\u4E8B\u4F8B\u6A2A\u65AD\u306E\u53E3\u982D\u8A66\u554FQ&A" }), _jsx("p", { className: "mt-2 text-sm leading-7 text-slate-600", children: "\u63A1\u70B9\u6E08\u307F\u7B54\u6848\u5168\u4F53\u3092\u524D\u63D0\u306B\u3001\u300C\u8A2D\u554F1\u306E\u3053\u306E\u89E3\u91C8\u3067\u5408\u3063\u3066\u308B\uFF1F\u300D\u306E\u3088\u3046\u306A\u6A2A\u65AD\u8CEA\u554F\u3092\u305D\u306E\u307E\u307E\u6295\u3052\u3089\u308C\u307E\u3059\u3002" })] }), _jsxs("div", { className: "rounded-2xl bg-slate-100 px-4 py-3 text-xs font-semibold text-slate-600", children: ["\u5BFE\u8C61: ", detail.bundle.year_label, " \u4E8B\u4F8B", detail.bundle.case_no] })] }), oralVivaCitedQuestionKeys.length > 0 ? (_jsx("div", { className: "mt-4 flex flex-wrap gap-2", children: oralVivaCitedQuestionKeys.map((questionKey) => (_jsxs("button", { type: "button", onClick: () => setActiveQuestionKey(questionKey), className: "rounded-full bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100", children: ["\u95A2\u9023\u8A2D\u554F ", questionKey] }, questionKey))) })) : null, _jsx("div", { className: "mt-5 space-y-3", children: oralVivaConversation.length > 0 ? (oralVivaConversation.map((turn, index) => (_jsxs("div", { className: `rounded-2xl px-4 py-3 text-sm leading-7 ${turn.role === 'assistant'
                                                                ? 'bg-slate-50 text-slate-800'
                                                                : 'bg-sky-50 text-sky-950'}`, children: [_jsx("div", { className: "mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400", children: turn.role === 'assistant' ? 'Examiner' : 'You' }), _jsx("div", { className: "whitespace-pre-wrap", children: turn.content })] }, `${turn.role}-${index}`)))) : (_jsx("div", { className: "rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600", children: "\u4F8B: \u300C\u8A2D\u554F1\u3068\u8A2D\u554F2\u3067\u4E00\u8CAB\u3057\u3066\u8A00\u3046\u3079\u304D\u5F37\u307F\u306F\u4F55\uFF1F\u300D\u300C\u81EA\u5206\u306E\u7B54\u6848\u3067\u56E0\u679C\u304C\u5F31\u3044\u306E\u306F\u3069\u3053\uFF1F\u300D" })) }), oralVivaSuggestedFollowups.length > 0 ? (_jsx("div", { className: "mt-4 flex flex-wrap gap-2", children: oralVivaSuggestedFollowups.map((item) => (_jsx("button", { type: "button", onClick: () => void handleAskOralViva(item), disabled: isAskingOralViva, className: "rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60", children: item }, item))) })) : null, _jsxs("div", { className: "mt-5", children: [_jsx("textarea", { value: oralVivaInput, onChange: (event) => setOralVivaInput(event.target.value), placeholder: "\u8A2D\u554F\u6A2A\u65AD\u3067\u78BA\u8A8D\u3057\u305F\u3044\u3053\u3068\u3092\u5165\u529B\u3057\u307E\u3059\u3002", className: "min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-400" }), _jsx("div", { className: "mt-3 flex justify-end", children: _jsxs("button", { type: "button", onClick: () => void handleAskOralViva(), disabled: isAskingOralViva || !oralVivaInput.trim(), className: "inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60", children: [isAskingOralViva ? _jsx(LoaderIcon, { className: "h-4 w-4 animate-spin" }) : null, isAskingOralViva ? '回答生成中...' : '質問する'] }) })] })] }), questionPackets.map((packet) => (_jsxs("div", { className: "space-y-4", children: [_jsx(QuestionResultCard, { packet: packet, result: result.question_results.find((item) => item.question_key === packet.question_key) }), _jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Reference After Scoring" }), _jsx("div", { className: "mt-4 space-y-4", children: (() => {
                                                                    const explanation = getBundleExplanation(detail, packet);
                                                                    const rubric = getBundleRubric(detail, packet);
                                                                    const fallbackRubrics = packet.rubric_candidates.flatMap((candidate) => candidate.checklist_items ?? []);
                                                                    const rubricItems = rubric?.採点観点?.filter(Boolean) ?? fallbackRubrics;
                                                                    const modelAnswer = explanation?.answer_example_text?.trim() || rubric?.模範解答?.trim() || null;
                                                                    const explanationText = explanation?.solution_text?.trim() || rubric?.解説?.trim() || packet.explanation_candidate?.trim() || null;
                                                                    return (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-sky-600", children: "\u6A21\u7BC4\u89E3\u7B54" }), _jsx("div", { className: "mt-2 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-7 text-slate-800 whitespace-pre-wrap", children: modelAnswer || 'この設問の模範解答データはまだありません。' })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600", children: "\u89E3\u8AAC" }), _jsx("div", { className: "mt-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-7 text-slate-800 whitespace-pre-wrap", children: explanationText || 'この設問の解説データはまだありません。' })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-amber-600", children: "\u63A1\u70B9\u89B3\u70B9" }), rubricItems.length > 0 ? (_jsx("ul", { className: "mt-2 space-y-2 text-sm text-slate-700", children: rubricItems.map((item) => (_jsx("li", { className: "rounded-2xl bg-amber-50 px-4 py-3 leading-7", children: item }, `${packet.question_key}-${item}`))) })) : (_jsx("div", { className: "mt-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-7 text-slate-800", children: "\u3053\u306E\u8A2D\u554F\u306E\u63A1\u70B9\u89B3\u70B9\u30C7\u30FC\u30BF\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" }))] })] }));
                                                                })() })] })] }, packet.question_key)))] })) : null, resultHistory.length > 0 ? (_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Score History" }), _jsx("h3", { className: "mt-1 text-xl font-semibold text-slate-900", children: "\u63A1\u70B9\u5C65\u6B74" })] }), _jsxs("div", { className: "rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600", children: [resultHistory.length, "\u4EF6"] })] }), _jsxs("div", { className: "mt-5 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]", children: [_jsx("div", { className: "space-y-3", children: resultHistory.map((attempt) => (_jsx(AttemptHistoryCard, { attempt: attempt, selected: attempt.attempt_id === selectedHistoryAttempt?.attempt_id, onSelect: setSelectedHistoryAttemptId }, attempt.attempt_id))) }), selectedHistoryAttempt ? (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "rounded-2xl bg-slate-50 p-4", children: _jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-sm font-semibold text-slate-900", children: [formatPoints(selectedHistoryAttempt.overall_score), " / ", formatPoints(selectedHistoryAttempt.total_possible_score), "\u70B9"] }), _jsxs("div", { className: "mt-1 text-xs text-slate-500", children: [selectedHistoryAttempt.overall_percentage, "% \u30FB ", formatDateTime(selectedHistoryAttempt.scored_at)] })] }), _jsxs("div", { className: "text-xs text-slate-500", children: ["\u56DE\u7B54\u3042\u308A ", selectedHistoryAttempt.answered_questions, " / ", selectedHistoryAttempt.total_questions, "\u8A2D\u554F"] })] }) }), questionPackets.map((packet) => {
                                                                const questionResult = selectedHistoryAttempt.question_results.find((item) => item.question_key === packet.question_key);
                                                                const answerText = selectedHistoryAttempt.answers[packet.question_key] ?? '';
                                                                return (_jsxs("div", { className: "rounded-2xl border border-slate-200 p-4", children: [_jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: packet.question_key }), _jsx("div", { className: "mt-1 text-sm font-semibold leading-7 text-slate-900", children: packet.prompt_text_clean })] }), _jsxs("div", { className: "rounded-2xl bg-slate-900 px-3 py-2 text-right text-white", children: [_jsxs("div", { className: "text-sm font-semibold", children: [formatPoints(questionResult?.score), " / ", formatPoints(questionResult?.max_score), "\u70B9"] }), _jsxs("div", { className: "text-xs text-slate-300", children: [questionResult?.score_percentage ?? 0, "%"] })] })] }), _jsxs("div", { className: "mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500", children: ["\u6587\u5B57\u6570 ", questionResult?.char_count ?? 0, questionResult?.char_limit ? ` / ${questionResult.char_limit}` : ''] }), _jsx("div", { className: "mt-3 rounded-2xl bg-white px-1 py-1", children: _jsx("div", { className: "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-800 whitespace-pre-wrap", children: answerText.trim() ? answerText : '未回答' }) })] }, `${selectedHistoryAttempt.attempt_id}-${packet.question_key}`));
                                                            })] })) : null] })] })) : null] })] }))) : (_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm", children: "\u8AAD\u307F\u8FBC\u3081\u308B\u8A66\u9A13\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u7BA1\u7406\u753B\u9762\u3067\u5BFE\u8C61\u306E\u5E74\u5EA6\u30FB\u4E8B\u4F8B\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })) }) })] }));
}
function AttemptHistoryCard({ attempt, selected, onSelect, }) {
    return (_jsx("button", { type: "button", onClick: () => onSelect(attempt.attempt_id), className: `w-full rounded-2xl border px-4 py-3 text-left transition ${selected
            ? 'border-sky-500 bg-sky-50 shadow-sm'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`, children: _jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-sm font-semibold text-slate-900", children: [formatPoints(attempt.overall_score), " / ", formatPoints(attempt.total_possible_score), "\u70B9"] }), _jsxs("div", { className: "mt-1 text-xs text-slate-500", children: [attempt.overall_percentage, "% \u30FB ", formatDateTime(attempt.scored_at)] })] }), _jsxs("div", { className: "text-right text-xs text-slate-500", children: [_jsxs("div", { children: [attempt.answered_questions, " / ", attempt.total_questions, "\u8A2D\u554F"] }), _jsx("div", { children: attempt.cached ? 'キャッシュ再利用' : '新規採点' })] })] }) }));
}
//# sourceMappingURL=SecondaryExamPage.js.map