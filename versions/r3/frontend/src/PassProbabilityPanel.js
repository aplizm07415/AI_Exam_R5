import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
const API_BASE_URL = '/api';
const PASSING_SCORE_STORAGE_KEY = 'dashboard:passingScore';
const PAST_EXAM_WEIGHT_STORAGE_KEY = 'dashboard:pastExamWeight';
const INCLUDE_PAST_EXAM_STORAGE_KEY = 'dashboard:includePastExamRecords';
const ANALYSIS_POLICY_STORAGE_KEY = 'dashboard:passProbabilityAnalysisPolicy';
const COUNTDOWN_EXAMS_STORAGE_KEY = 'countdownExams';
const SELECTED_EXAM_STORAGE_KEY = 'dashboard:passProbabilitySelectedExamId';
const DAILY_PRACTICE_CAPACITY_STORAGE_KEY = 'dashboard:dailyPracticeCapacity';
function loadInitialPassingScore() {
    try {
        const raw = localStorage.getItem(PASSING_SCORE_STORAGE_KEY);
        const value = raw ? Number(raw) : 60;
        return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 60;
    }
    catch {
        return 60;
    }
}
function loadInitialPastExamWeight() {
    try {
        const raw = localStorage.getItem(PAST_EXAM_WEIGHT_STORAGE_KEY);
        const value = raw ? Number(raw) : 35;
        return Number.isFinite(value) ? Math.max(0, Math.min(80, value)) : 35;
    }
    catch {
        return 35;
    }
}
function loadInitialIncludePastExamRecords() {
    try {
        return localStorage.getItem(INCLUDE_PAST_EXAM_STORAGE_KEY) === 'true';
    }
    catch {
        return false;
    }
}
function loadInitialAnalysisPolicy() {
    try {
        const raw = localStorage.getItem(ANALYSIS_POLICY_STORAGE_KEY);
        return raw === 'answered_recent_weighted' ? 'answered_recent_weighted' : 'coverage_adjusted';
    }
    catch {
        return 'coverage_adjusted';
    }
}
function loadCountdownExams() {
    try {
        const raw = localStorage.getItem(COUNTDOWN_EXAMS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed))
            return [];
        return parsed
            .filter((item) => (typeof item === 'object' &&
            item !== null &&
            typeof item.id === 'number' &&
            typeof item.name === 'string' &&
            typeof item.date === 'string'))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    catch {
        return [];
    }
}
function loadInitialSelectedExamId() {
    try {
        return localStorage.getItem(SELECTED_EXAM_STORAGE_KEY) || '';
    }
    catch {
        return '';
    }
}
function loadInitialDailyPracticeCapacity() {
    try {
        const raw = localStorage.getItem(DAILY_PRACTICE_CAPACITY_STORAGE_KEY);
        const value = raw ? Number(raw) : 20;
        return Number.isFinite(value) ? Math.max(1, Math.min(500, Math.round(value))) : 20;
    }
    catch {
        return 20;
    }
}
function analysisPolicyLabel(policy) {
    return policy === 'answered_recent_weighted' ? '実施済み・直近重視' : '標準';
}
function formatPercent(value) {
    return `${value.toFixed(1)}%`;
}
function formatAnalyzedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value.slice(0, 16).replace('T', ' ');
    return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}
function scoreCountForColumn(book, column) {
    if (!book)
        return 0;
    return book.rows.filter((row) => typeof row.cells[column]?.score === 'number').length;
}
function hasProblemJsonMappings(book) {
    if (!book)
        return false;
    return book.subject_columns.some((column) => (book.problem_json_mappings[column] ?? []).length > 0);
}
function mappedColumnsForSubjects(book, subjectNames) {
    if (!book)
        return [];
    const subjectNameSet = new Set(subjectNames);
    return book.subject_columns.filter((column) => ((book.problem_json_mappings[column] ?? []).some((subjectName) => subjectNameSet.has(subjectName))));
}
function MetricTile({ label, value, tone = 'slate', }) {
    const toneClassName = {
        slate: 'border-slate-200 bg-slate-50 text-slate-900',
        sky: 'border-sky-200 bg-sky-50 text-sky-900',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        amber: 'border-amber-200 bg-amber-50 text-amber-900',
    }[tone];
    return (_jsxs("div", { className: `rounded-2xl border px-4 py-3 ${toneClassName}`, children: [_jsx("p", { className: "text-xs font-semibold text-slate-500", children: label }), _jsx("p", { className: "mt-1 text-2xl font-bold", children: value })] }));
}
export default function PassProbabilityPanel({ subjects, selectedSubjectNames, setSelectedSubjectNames, }) {
    const [draftSubjectNames, setDraftSubjectNames] = useState(selectedSubjectNames);
    const [passingScore, setPassingScore] = useState(loadInitialPassingScore);
    const [analysisPolicy, setAnalysisPolicy] = useState(loadInitialAnalysisPolicy);
    const [includePastExamRecords, setIncludePastExamRecords] = useState(loadInitialIncludePastExamRecords);
    const [pastExamWeight, setPastExamWeight] = useState(loadInitialPastExamWeight);
    const [registeredExams, setRegisteredExams] = useState(loadCountdownExams);
    const [selectedExamId, setSelectedExamId] = useState(loadInitialSelectedExamId);
    const [dailyPracticeCapacity, setDailyPracticeCapacity] = useState(loadInitialDailyPracticeCapacity);
    const [pastExamRecordsBook, setPastExamRecordsBook] = useState(null);
    const [selectedPastExamColumns, setSelectedPastExamColumns] = useState([]);
    const [isPastExamRecordsLoading, setIsPastExamRecordsLoading] = useState(false);
    const [data, setData] = useState(null);
    const [historyItems, setHistoryItems] = useState([]);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [lastRequest, setLastRequest] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const availableSubjectNameSet = useMemo(() => new Set(subjects.map((subject) => subject.name)), [subjects]);
    const draftSubjectNameSet = useMemo(() => new Set(draftSubjectNames), [draftSubjectNames]);
    const selectedPastExamColumnSet = useMemo(() => new Set(selectedPastExamColumns), [selectedPastExamColumns]);
    const hasPastExamMappings = useMemo(() => hasProblemJsonMappings(pastExamRecordsBook), [pastExamRecordsBook]);
    const mappedPastExamColumns = useMemo(() => mappedColumnsForSubjects(pastExamRecordsBook, draftSubjectNames), [draftSubjectNames, pastExamRecordsBook]);
    const selectedExam = useMemo(() => registeredExams.find((exam) => String(exam.id) === selectedExamId) ?? null, [registeredExams, selectedExamId]);
    const pastExamScoreCount = useMemo(() => {
        if (!pastExamRecordsBook)
            return 0;
        return pastExamRecordsBook.rows.reduce((count, row) => (count + selectedPastExamColumns.filter((column) => typeof row.cells[column]?.score === 'number').length), 0);
    }, [pastExamRecordsBook, selectedPastExamColumns]);
    const hasUnappliedChanges = useMemo(() => {
        if (!lastRequest)
            return draftSubjectNames.length > 0;
        if (lastRequest.passingScore !== passingScore)
            return true;
        if (lastRequest.analysisPolicy !== analysisPolicy)
            return true;
        if (lastRequest.includePastExamRecords !== includePastExamRecords)
            return true;
        if (lastRequest.pastExamWeight !== pastExamWeight)
            return true;
        if (lastRequest.examId !== (selectedExam ? String(selectedExam.id) : ''))
            return true;
        if (lastRequest.examDate !== (selectedExam?.date ?? ''))
            return true;
        if (lastRequest.dailyPracticeCapacity !== dailyPracticeCapacity)
            return true;
        if (lastRequest.subjects.length !== draftSubjectNames.length)
            return true;
        const lastSubjectSet = new Set(lastRequest.subjects);
        if (draftSubjectNames.some((subjectName) => !lastSubjectSet.has(subjectName)))
            return true;
        if (lastRequest.pastExamColumns.length !== selectedPastExamColumns.length)
            return true;
        const lastPastExamColumnSet = new Set(lastRequest.pastExamColumns);
        return selectedPastExamColumns.some((column) => !lastPastExamColumnSet.has(column));
    }, [analysisPolicy, dailyPracticeCapacity, draftSubjectNames, includePastExamRecords, lastRequest, passingScore, pastExamWeight, selectedExam, selectedPastExamColumns]);
    useEffect(() => {
        try {
            localStorage.setItem(PASSING_SCORE_STORAGE_KEY, String(passingScore));
        }
        catch {
            // no-op
        }
    }, [passingScore]);
    useEffect(() => {
        try {
            localStorage.setItem(ANALYSIS_POLICY_STORAGE_KEY, analysisPolicy);
        }
        catch {
            // no-op
        }
    }, [analysisPolicy]);
    useEffect(() => {
        try {
            localStorage.setItem(PAST_EXAM_WEIGHT_STORAGE_KEY, String(pastExamWeight));
            localStorage.setItem(INCLUDE_PAST_EXAM_STORAGE_KEY, String(includePastExamRecords));
        }
        catch {
            // no-op
        }
    }, [includePastExamRecords, pastExamWeight]);
    useEffect(() => {
        try {
            localStorage.setItem(SELECTED_EXAM_STORAGE_KEY, selectedExamId);
            localStorage.setItem(DAILY_PRACTICE_CAPACITY_STORAGE_KEY, String(dailyPracticeCapacity));
        }
        catch {
            // no-op
        }
    }, [dailyPracticeCapacity, selectedExamId]);
    useEffect(() => {
        const reloadExams = () => setRegisteredExams(loadCountdownExams());
        window.addEventListener('focus', reloadExams);
        window.addEventListener('storage', reloadExams);
        return () => {
            window.removeEventListener('focus', reloadExams);
            window.removeEventListener('storage', reloadExams);
        };
    }, []);
    useEffect(() => {
        if (registeredExams.length === 0) {
            setSelectedExamId('');
            return;
        }
        setSelectedExamId((current) => {
            if (current && registeredExams.some((exam) => String(exam.id) === current)) {
                return current;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const nextExam = registeredExams.find((exam) => {
                const date = new Date(exam.date);
                date.setHours(0, 0, 0, 0);
                return date.getTime() >= today.getTime();
            });
            return nextExam ? String(nextExam.id) : String(registeredExams[0]?.id ?? '');
        });
    }, [registeredExams]);
    useEffect(() => {
        setDraftSubjectNames(selectedSubjectNames.filter((subjectName) => availableSubjectNameSet.has(subjectName)));
    }, [availableSubjectNameSet, selectedSubjectNames]);
    useEffect(() => {
        let isMounted = true;
        const loadPastExamRecords = async () => {
            setIsPastExamRecordsLoading(true);
            try {
                const response = await fetch(`${API_BASE_URL}/dashboard/past-exam-records`);
                const payload = await response.json().catch(() => null);
                if (!response.ok) {
                    throw new Error(payload?.detail || '過去問と模試記録の取得に失敗しました。');
                }
                if (!isMounted)
                    return;
                setPastExamRecordsBook(payload);
                setSelectedPastExamColumns((current) => {
                    const columns = Array.isArray(payload?.subject_columns) ? payload.subject_columns : [];
                    const available = new Set(columns);
                    const next = current.filter((column) => available.has(column));
                    return next.length > 0 ? next : columns;
                });
            }
            catch (e) {
                if (isMounted) {
                    setPastExamRecordsBook(null);
                    setSelectedPastExamColumns([]);
                }
            }
            finally {
                if (isMounted) {
                    setIsPastExamRecordsLoading(false);
                }
            }
        };
        void loadPastExamRecords();
        window.addEventListener('dashboard:pastExamRecordsUpdated', loadPastExamRecords);
        return () => {
            isMounted = false;
            window.removeEventListener('dashboard:pastExamRecordsUpdated', loadPastExamRecords);
        };
    }, []);
    useEffect(() => {
        if (!pastExamRecordsBook)
            return;
        const columns = pastExamRecordsBook.subject_columns;
        if (hasPastExamMappings) {
            setSelectedPastExamColumns(mappedPastExamColumns);
            return;
        }
        setSelectedPastExamColumns((current) => {
            const available = new Set(columns);
            const next = current.filter((column) => available.has(column));
            return next.length > 0 ? next : columns;
        });
    }, [hasPastExamMappings, mappedPastExamColumns, pastExamRecordsBook]);
    const loadHistory = async () => {
        setIsHistoryLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/dashboard/pass-probability/history?limit=10`);
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.detail || '合格可能性の履歴取得に失敗しました。');
            }
            setHistoryItems(Array.isArray(payload) ? payload : []);
        }
        catch {
            setHistoryItems([]);
        }
        finally {
            setIsHistoryLoading(false);
        }
    };
    useEffect(() => {
        void loadHistory();
    }, []);
    const runAnalysis = async () => {
        const targetSubjects = Array.from(new Set(draftSubjectNames))
            .filter((subjectName) => availableSubjectNameSet.has(subjectName));
        if (targetSubjects.length === 0) {
            setData(null);
            setLastRequest(null);
            setError('対象問題jsonが未選択です。');
            return;
        }
        setSelectedSubjectNames(targetSubjects);
        setIsLoading(true);
        setError('');
        try {
            const query = new URLSearchParams();
            targetSubjects.forEach((subject) => query.append('subjects', subject));
            query.append('passing_score', String(passingScore));
            query.append('analysis_policy', analysisPolicy);
            if (includePastExamRecords) {
                query.append('include_past_exam_records', 'true');
                selectedPastExamColumns.forEach((column) => query.append('past_exam_columns', column));
                query.append('past_exam_weight', String(pastExamWeight / 100));
            }
            if (selectedExam) {
                query.append('exam_name', selectedExam.name);
                query.append('exam_date', selectedExam.date);
            }
            query.append('daily_practice_capacity', String(dailyPracticeCapacity));
            const response = await fetch(`${API_BASE_URL}/dashboard/pass-probability?${query.toString()}`);
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.detail || '合格可能性の取得に失敗しました。');
            }
            setData(payload);
            setLastRequest({
                subjects: targetSubjects,
                passingScore,
                analysisPolicy,
                includePastExamRecords,
                pastExamColumns: includePastExamRecords ? selectedPastExamColumns : [],
                pastExamWeight,
                examId: selectedExam ? String(selectedExam.id) : '',
                examName: selectedExam?.name ?? '',
                examDate: selectedExam?.date ?? '',
                dailyPracticeCapacity,
            });
            void loadHistory();
        }
        catch (e) {
            setData(null);
            setLastRequest(null);
            setError(e.message || '合格可能性の取得に失敗しました。');
        }
        finally {
            setIsLoading(false);
        }
    };
    const toggleSubject = (subjectName) => {
        if (draftSubjectNameSet.has(subjectName)) {
            setDraftSubjectNames(draftSubjectNames.filter((name) => name !== subjectName));
        }
        else {
            setDraftSubjectNames([...draftSubjectNames, subjectName]);
        }
    };
    const togglePastExamColumn = (column) => {
        if (selectedPastExamColumnSet.has(column)) {
            setSelectedPastExamColumns(selectedPastExamColumns.filter((item) => item !== column));
        }
        else {
            setSelectedPastExamColumns([...selectedPastExamColumns, column]);
        }
    };
    const readinessTone = data && data.pass_probability >= 75
        ? 'text-emerald-700'
        : data && data.pass_probability >= 50
            ? 'text-sky-700'
            : data && data.pass_probability >= 30
                ? 'text-amber-700'
                : 'text-rose-700';
    return (_jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6", children: [_jsxs("div", { className: "flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-slate-400", children: "Readiness" }), _jsx("h2", { className: "mt-2 text-2xl font-bold text-slate-900", children: "\u5408\u683C\u53EF\u80FD\u6027" })] }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,18rem)_10rem_minmax(0,16rem)_10rem] xl:items-end", children: [_jsxs("label", { children: [_jsx("span", { className: "block text-xs font-semibold text-slate-600", children: "\u5BFE\u8C61\u554F\u984Cjson" }), _jsxs("div", { className: "mt-1 flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => setDraftSubjectNames(subjects.map((subject) => subject.name)), className: "rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50", children: "\u3059\u3079\u3066" }), _jsx("button", { type: "button", onClick: () => setDraftSubjectNames([]), className: "rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50", children: "\u89E3\u9664" }), _jsxs("span", { className: "text-xs text-slate-500", children: [draftSubjectNames.length, "\u4EF6"] })] })] }), _jsxs("label", { children: [_jsx("span", { className: "block text-xs font-semibold text-slate-600", children: "\u5408\u683C\u30E9\u30A4\u30F3" }), _jsxs("div", { className: "mt-1 flex items-center gap-2", children: [_jsx("input", { type: "number", min: 0, max: 100, value: passingScore, onChange: (event) => {
                                                    const value = Number(event.target.value);
                                                    setPassingScore(Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
                                                }, className: "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20" }), _jsx("span", { className: "text-sm font-semibold text-slate-500", children: "\u70B9" })] })] }), _jsxs("label", { children: [_jsx("span", { className: "block text-xs font-semibold text-slate-600", children: "\u8A66\u9A13\u65E5" }), _jsxs("select", { value: selectedExamId, onChange: (event) => setSelectedExamId(event.target.value), onFocus: () => setRegisteredExams(loadCountdownExams()), className: "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20", children: [_jsx("option", { value: "", children: registeredExams.length > 0 ? '未選択' : '登録なし' }), registeredExams.map((exam) => (_jsxs("option", { value: String(exam.id), children: [exam.name, " / ", exam.date] }, exam.id)))] })] }), _jsxs("label", { children: [_jsx("span", { className: "block text-xs font-semibold text-slate-600", children: "1\u65E5\u306E\u6F14\u7FD2\u4E0A\u9650" }), _jsxs("div", { className: "mt-1 flex items-center gap-2", children: [_jsx("input", { type: "number", min: 1, max: 500, value: dailyPracticeCapacity, onChange: (event) => {
                                                    const value = Number(event.target.value);
                                                    setDailyPracticeCapacity(Number.isFinite(value) ? Math.max(1, Math.min(500, Math.round(value))) : 1);
                                                }, className: "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20" }), _jsx("span", { className: "text-sm font-semibold text-slate-500", children: "\u554F" })] })] })] })] }), _jsxs("div", { className: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", children: [_jsx("span", { className: "text-xs font-semibold text-slate-600", children: "\u5206\u6790\u65B9\u91DD" }), _jsx("div", { className: "inline-flex rounded-md border border-slate-200 bg-slate-50 p-1", children: ['coverage_adjusted', 'answered_recent_weighted'].map((policy) => (_jsx("button", { type: "button", onClick: () => setAnalysisPolicy(policy), className: `rounded px-3 py-1.5 text-xs font-semibold transition ${analysisPolicy === policy
                                ? 'bg-white text-sky-700 shadow-sm'
                                : 'text-slate-500 hover:text-slate-800'}`, children: analysisPolicyLabel(policy) }, policy))) })] }), _jsxs("div", { className: "mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4", children: [_jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("label", { className: "flex items-center gap-2 text-sm font-semibold text-slate-800", children: [_jsx("input", { type: "checkbox", checked: includePastExamRecords, onChange: (event) => setIncludePastExamRecords(event.target.checked), className: "h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" }), _jsx("span", { children: "\u5B9F\u6226\u70B9\u6570\u3092\u53CD\u6620" })] }), _jsxs("div", { className: "flex items-center gap-3 text-sm text-slate-600", children: [_jsxs("span", { children: ["\u4FDD\u5B58\u6E08\u307F ", pastExamScoreCount, "\u4EF6"] }), hasPastExamMappings && (_jsxs("span", { children: ["JSON\u5BFE\u5FDC ", mappedPastExamColumns.length, "\u5217"] })), _jsxs("label", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs font-semibold text-slate-500", children: "\u53CD\u6620\u6BD4\u7387" }), _jsx("input", { type: "range", min: 0, max: 80, step: 5, value: pastExamWeight, disabled: !includePastExamRecords, onChange: (event) => setPastExamWeight(Number(event.target.value)), className: "w-28 accent-sky-600 disabled:opacity-40" }), _jsxs("span", { className: "w-10 text-right text-xs font-semibold text-slate-700", children: [pastExamWeight, "%"] })] })] })] }), _jsx("div", { className: "mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3", children: isPastExamRecordsLoading ? (_jsx("p", { className: "text-sm text-slate-500", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." })) : pastExamRecordsBook && pastExamRecordsBook.subject_columns.length > 0 ? (pastExamRecordsBook.subject_columns.map((column) => {
                            const scoreCount = scoreCountForColumn(pastExamRecordsBook, column);
                            const mappedSubjects = pastExamRecordsBook.problem_json_mappings[column] ?? [];
                            const isMappedToTarget = mappedSubjects.some((subjectName) => draftSubjectNameSet.has(subjectName));
                            const isSelectable = !hasPastExamMappings || isMappedToTarget;
                            return (_jsxs("label", { className: "flex min-w-0 items-center gap-2 text-sm text-slate-700", children: [_jsx("input", { type: "checkbox", checked: selectedPastExamColumnSet.has(column), disabled: !includePastExamRecords || !isSelectable, onChange: () => togglePastExamColumn(column), className: "h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-40" }), _jsx("span", { className: "truncate", title: column, children: column }), _jsx("span", { className: "shrink-0 text-xs text-slate-400", children: scoreCount }), hasPastExamMappings && (_jsx("span", { className: `shrink-0 text-xs font-semibold ${isMappedToTarget ? 'text-sky-700' : 'text-slate-400'}`, children: isMappedToTarget ? '対応' : '対象外' }))] }, column));
                        })) : (_jsx("p", { className: "text-sm text-slate-500", children: "\u4FDD\u5B58\u6E08\u307F\u8A18\u9332\u306A\u3057" })) })] }), _jsxs("div", { className: "mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { className: "text-sm text-slate-600", children: [data ? (_jsxs("span", { children: ["\u5206\u6790\u6E08\u307F: ", data.subjects.length, "\u4EF6 / ", analysisPolicyLabel(data.analysis_policy), " / \u5408\u683C\u30E9\u30A4\u30F3 ", data.passing_score.toFixed(1), "\u70B9 / \u4FDD\u5B58ID ", data.analysis_id.slice(-8)] })) : (_jsx("span", { children: "\u5206\u6790\u6E08\u307F\u30C7\u30FC\u30BF\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })), data?.past_exam_records.included && (_jsxs("span", { className: "ml-2", children: ["\u5B9F\u6226 ", data.past_exam_records.record_count, "\u4EF6 / \u53CD\u6620 ", (data.past_exam_records.effective_weight * 100).toFixed(0), "%"] })), data?.past_exam_records.mapping_applied && (_jsxs("span", { className: "ml-2", children: ["JSON\u5BFE\u5FDC ", data.past_exam_records.columns.length, "\u5217"] })), data?.practice_plan.exam_date && (_jsxs("span", { className: "ml-2", children: ["\u8A66\u9A13\u307E\u3067 ", data.practice_plan.days_to_exam ?? '-', "\u65E5 / 1\u65E5\u4E0A\u9650 ", data.practice_plan.daily_practice_capacity, "\u554F"] })), hasUnappliedChanges && _jsx("span", { className: "ml-2 font-semibold text-amber-700", children: "\u672A\u5206\u6790\u306E\u5909\u66F4\u3042\u308A" })] }), _jsx("button", { type: "button", onClick: () => void runAnalysis(), disabled: isLoading || draftSubjectNames.length === 0, className: "rounded-md bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-500", children: isLoading ? '分析中...' : '分析する' })] }), _jsx("div", { className: "mt-4 max-h-28 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3", children: _jsx("div", { className: "grid gap-2 sm:grid-cols-2 lg:grid-cols-3", children: subjects.map((subject) => (_jsxs("label", { className: "flex min-w-0 items-center gap-2 text-sm text-slate-700", children: [_jsx("input", { type: "checkbox", checked: draftSubjectNameSet.has(subject.name), onChange: () => toggleSubject(subject.name), className: "h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" }), _jsx("span", { className: "truncate", title: subject.name, children: subject.name })] }, subject.name))) }) }), _jsxs("div", { className: "mt-4 rounded-xl border border-slate-200 bg-white", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-slate-100 px-4 py-3", children: [_jsx("p", { className: "text-sm font-semibold text-slate-800", children: "\u5206\u6790\u5C65\u6B74" }), isHistoryLoading && _jsx("span", { className: "text-xs text-slate-400", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." })] }), historyItems.length > 0 ? (_jsx("div", { className: "divide-y divide-slate-100", children: historyItems.map((item) => (_jsxs("div", { className: "flex items-center justify-between gap-4 px-4 py-3 text-sm", children: [_jsx("span", { className: "text-slate-600", children: formatAnalyzedAt(item.analyzed_at) }), _jsx("span", { className: "font-bold text-slate-900", children: formatPercent(item.pass_probability) })] }, item.analysis_id))) })) : (_jsx("div", { className: "px-4 py-4 text-sm text-slate-500", children: "\u5C65\u6B74\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" }))] }), _jsx("div", { className: "mt-5", children: isLoading ? (_jsx("div", { className: "py-8", children: _jsx(LoadingSpinner, {}) })) : error ? (_jsx("div", { className: "rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error })) : draftSubjectNames.length === 0 ? (_jsx("div", { className: "rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500", children: "\u5BFE\u8C61\u554F\u984Cjson\u304C\u672A\u9078\u629E\u3067\u3059\u3002" })) : data ? (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { className: "grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-end justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-slate-500", children: "\u5408\u683C\u30E9\u30A4\u30F3\u5230\u9054\u53EF\u80FD\u6027" }), _jsx("p", { className: `mt-1 text-5xl font-bold ${readinessTone}`, children: formatPercent(data.pass_probability) })] }), _jsxs("div", { className: "text-right", children: [_jsx("p", { className: "text-sm font-semibold text-slate-500", children: "\u5224\u5B9A" }), _jsx("p", { className: `mt-1 text-xl font-bold ${readinessTone}`, children: data.readiness_label })] })] }), _jsx("div", { className: "mt-4 h-3 overflow-hidden rounded-full bg-slate-100", children: _jsx("div", { className: "h-full rounded-full bg-sky-600 transition-all", style: { width: `${Math.max(2, Math.min(100, data.pass_probability))}%` } }) }), _jsx("p", { className: "mt-3 text-sm leading-6 text-slate-600", children: data.recommendation })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(MetricTile, { label: "\u6700\u7D42\u63A8\u5B9A", value: `${data.expected_score.toFixed(1)}点`, tone: "sky" }), _jsx(MetricTile, { label: "\u60F3\u5B9A\u30EC\u30F3\u30B8", value: `${data.projected_score_low.toFixed(0)}-${data.projected_score_high.toFixed(0)}` }), _jsx(MetricTile, { label: "\u9032\u6357", value: formatPercent(data.coverage_rate), tone: "emerald" }), _jsx(MetricTile, { label: "\u6839\u62E0\u4FE1\u983C\u5EA6", value: formatPercent(data.evidence_confidence), tone: "amber" })] })] }), _jsxs("div", { className: "grid gap-3 md:grid-cols-4", children: [_jsx(MetricTile, { label: "\u554F\u984C\u7DCF\u6570", value: `${data.total_problems}` }), _jsx(MetricTile, { label: "\u5B9F\u65BD\u6E08\u307F\u554F\u984C", value: `${data.answered_problems}` }), _jsx(MetricTile, { label: "\u7DCF\u56DE\u7B54\u56DE\u6570", value: `${data.total_attempts}` }), _jsx(MetricTile, { label: "\u6B63\u7B54\u7387", value: formatPercent(data.accuracy_rate) })] }), _jsxs("div", { className: "grid gap-3 md:grid-cols-4", children: [_jsx(MetricTile, { label: "\u8A66\u9A13\u307E\u3067", value: data.practice_plan.days_to_exam != null ? `${data.practice_plan.days_to_exam}日` : '-', tone: "sky" }), _jsx(MetricTile, { label: "\u63A8\u5968\u6F14\u7FD2", value: `${data.practice_plan.total_recommended_attempts}問`, tone: "emerald" }), _jsx(MetricTile, { label: "1\u65E5\u76EE\u5B89", value: data.practice_plan.recommended_daily_attempts != null ? `${data.practice_plan.recommended_daily_attempts}問` : '-' }), _jsx(MetricTile, { label: "\u65E5\u7A0B", value: data.practice_plan.feasible_by_exam_date == null
                                        ? '未指定'
                                        : data.practice_plan.feasible_by_exam_date ? '収まる' : '不足', tone: data.practice_plan.feasible_by_exam_date === false ? 'amber' : 'emerald' })] }), data.past_exam_records.included && (_jsxs("div", { className: "grid gap-3 md:grid-cols-4", children: [_jsx(MetricTile, { label: "\u554F\u984C\u6F14\u7FD2\u63A8\u5B9A", value: `${data.base_expected_score.toFixed(1)}点` }), _jsx(MetricTile, { label: "\u5B9F\u6226\u70B9\u6570", value: data.past_exam_records.weighted_score != null ? `${data.past_exam_records.weighted_score.toFixed(1)}点` : '-', tone: "emerald" }), _jsx(MetricTile, { label: "\u5B9F\u6226\u8A18\u9332\u6570", value: `${data.past_exam_records.record_count}` }), _jsx(MetricTile, { label: "\u5B9F\u52B9\u53CD\u6620", value: formatPercent(data.past_exam_records.effective_weight * 100), tone: "amber" })] })), data.past_exam_records.mapping_applied && (_jsxs("div", { className: "rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900", children: [_jsx("p", { className: "font-semibold", children: "\u5B9F\u6226\u70B9\u6570\u306E\u5BFE\u5FDC\u5217" }), _jsxs("p", { className: "mt-1", children: [data.past_exam_records.columns.length > 0 ? data.past_exam_records.columns.join(' / ') : '対応する列なし', data.past_exam_records.ignored_columns.length > 0 && (_jsxs("span", { className: "text-sky-700", children: [' ', "\u5BFE\u8C61\u5916: ", data.past_exam_records.ignored_columns.join(' / ')] }))] })] })), _jsxs("div", { className: "rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600", children: [_jsx("p", { className: "font-semibold text-slate-700", children: "\u7B97\u5B9A\u30ED\u30B8\u30C3\u30AF" }), _jsxs("p", { className: "mt-1", children: [data.analysis_policy === 'answered_recent_weighted'
                                            ? '未解答問題は推定得点の母集団から外し、解答済み問題は直近5回の重み付き正答率と最後の正誤を強めに見て問題ごとの推定正答確率を出します。'
                                            : '未実施問題は対象内の初回正答率と同じ値で置き、実施済み問題は累計正答率、直近5回の重み付き正答率、最後の正誤を混ぜて問題ごとの推定正答確率を出します。', "\u5B9F\u6226\u70B9\u6570\u3092\u53CD\u6620\u3059\u308B\u5834\u5408\u306F\u3001\u554F\u984CJSON\u30DE\u30C3\u30D4\u30F3\u30B0\u306B\u4E00\u81F4\u3059\u308B\u79D1\u76EE\u5217\u3060\u3051\u3092\u4F7F\u3044\u3001\u65B0\u3057\u3044\u6A21\u8A66/\u904E\u53BB\u554F\u307B\u3069\u91CD\u304F\u5E73\u5747\u3057\u3001\u6307\u5B9A\u6BD4\u7387\u3092\u4E0A\u9650\u306B\u6700\u7D42\u63A8\u5B9A\u3078\u6DF7\u305C\u307E\u3059\u3002 \u305D\u306E\u63A8\u5B9A\u5F97\u70B9\u3092\u3001\u554F\u984C\u6570\u7531\u6765\u306E\u3070\u3089\u3064\u304D\u3001\u5408\u683C\u30E9\u30A4\u30F3\u3068\u306E\u5DEE\u3001\u5C65\u6B74\u91CF\u30FB\u9032\u6357\u306B\u3088\u308B\u6839\u62E0\u4FE1\u983C\u5EA6\u3067\u5408\u683C\u30E9\u30A4\u30F3\u5230\u9054\u53EF\u80FD\u6027\u3078\u88DC\u6B63\u3057\u307E\u3059\u3002 \u8A66\u9A13\u65E5\u3092\u9078\u629E\u3057\u305F\u5834\u5408\u306F\u3001\u554F\u984CJSON\u3054\u3068\u306E\u4E0D\u8DB3\u70B9\u3001\u672A\u5B9F\u65BD\u6570\u3001\u5F31\u70B9\u6570\u304B\u3089\u63A8\u5968\u6F14\u7FD2\u91CF\u3092\u51FA\u3057\u3001\u6B8B\u65E5\u6570\u30681\u65E5\u306E\u6F14\u7FD2\u4E0A\u9650\u306B\u53CE\u307E\u308B\u304B\u3067\u53EF\u80FD\u6027\u3092\u6642\u9593\u88DC\u6B63\u3057\u307E\u3059\u3002"] })] }), _jsx("div", { className: "overflow-x-auto rounded-xl border border-slate-200", children: _jsxs("table", { className: "min-w-[1120px] w-full text-sm", children: [_jsx("thead", { className: "bg-slate-100 text-left text-xs font-semibold text-slate-600", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3", children: "\u554F\u984Cjson" }), _jsx("th", { className: "px-3 py-3 text-right", children: "\u9032\u6357" }), _jsx("th", { className: "px-3 py-3 text-right", children: "\u6B63\u7B54\u7387" }), _jsx("th", { className: "px-3 py-3 text-right", children: "\u63A8\u5B9A\u5F97\u70B9" }), _jsx("th", { className: "px-3 py-3 text-right", children: "\u53EF\u80FD\u6027" }), _jsx("th", { className: "px-3 py-3 text-right", children: "\u5F31\u70B9" }), _jsx("th", { className: "px-3 py-3 text-right", children: "\u5B89\u5B9A" }), _jsx("th", { className: "px-3 py-3 text-right", children: "\u63A8\u5968\u6F14\u7FD2" }), _jsx("th", { className: "px-3 py-3 text-right", children: "1\u65E5\u76EE\u5B89" }), _jsx("th", { className: "px-3 py-3", children: "\u91CD\u70B9" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100", children: data.subject_breakdown.map((item) => {
                                            const recommendation = data.practice_plan.subject_recommendations.find((entry) => entry.subject === item.subject);
                                            return (_jsxs("tr", { className: "hover:bg-slate-50", children: [_jsx("td", { className: "max-w-[20rem] truncate px-3 py-3 font-semibold text-slate-800", title: item.subject, children: item.subject }), _jsxs("td", { className: "px-3 py-3 text-right text-slate-600", children: [item.answered_problems, "/", item.total_problems, " (", formatPercent(item.coverage_rate), ")"] }), _jsx("td", { className: "px-3 py-3 text-right text-slate-600", children: formatPercent(item.accuracy_rate) }), _jsxs("td", { className: "px-3 py-3 text-right text-slate-600", children: [item.expected_score.toFixed(1), "\u70B9"] }), _jsx("td", { className: "px-3 py-3 text-right font-semibold text-slate-800", children: formatPercent(item.pass_probability) }), _jsx("td", { className: "px-3 py-3 text-right text-rose-700", children: item.weak_problem_count }), _jsx("td", { className: "px-3 py-3 text-right text-emerald-700", children: item.strong_problem_count }), _jsxs("td", { className: "px-3 py-3 text-right font-semibold text-slate-800", children: [recommendation?.recommended_attempts ?? 0, "\u554F"] }), _jsx("td", { className: "px-3 py-3 text-right text-slate-600", children: recommendation?.daily_attempts != null ? `${recommendation.daily_attempts}問` : '-' }), _jsx("td", { className: "max-w-[16rem] px-3 py-3 text-slate-600", title: recommendation?.reason ?? '', children: recommendation?.focus ?? '-' })] }, item.subject));
                                        }) })] }) })] })) : (_jsx("div", { className: "rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500", children: "\u672A\u5206\u6790\u3067\u3059\u3002" })) })] }));
}
//# sourceMappingURL=PassProbabilityPanel.js.map