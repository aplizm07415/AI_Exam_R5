import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { BarChartIcon, LoaderIcon, PencilIcon } from './components/icons';
import { askSecondaryExamOralViva, fetchSecondaryExamDetail, fetchSecondaryExamResult, } from './secondaryExam/api';
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
function formatPoints(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '-';
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function QuestionResultCard({ packet, result, answerText, }) {
    if (!result) {
        return null;
    }
    return (_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: packet.question_key }), _jsx("div", { className: "mt-1 text-sm font-semibold leading-7 text-slate-900", children: packet.prompt_text_clean })] }), _jsxs("div", { className: "rounded-2xl bg-slate-900 px-3 py-2 text-right text-white", children: [_jsxs("div", { className: "text-sm font-semibold", children: [formatPoints(result.score), " / ", formatPoints(result.max_score), "\u70B9"] }), _jsxs("div", { className: "text-xs text-slate-300", children: [result.score_percentage, "%"] })] })] }), _jsxs("div", { className: "mt-4 rounded-2xl bg-slate-50 px-4 py-4", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Your Answer" }), _jsx("div", { className: "mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800", children: answerText.trim() ? answerText : '未回答' })] }), _jsxs("div", { className: "mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-3", children: [_jsxs("div", { className: "rounded-xl bg-slate-50 px-3 py-2", children: ["\u6587\u5B57\u6570: ", result.char_count, result.char_limit ? ` / ${result.char_limit}` : ''] }), _jsxs("div", { className: "rounded-xl bg-slate-50 px-3 py-2", children: ["\u89B3\u70B9\u4E00\u81F4: ", result.coverage_score] }), _jsxs("div", { className: "rounded-xl bg-slate-50 px-3 py-2", children: ["\u8A2D\u554F\u5BFE\u5FDC: ", result.prompt_score] })] }), _jsxs("div", { className: "mt-4 grid gap-4 lg:grid-cols-2", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500", children: "\u826F\u3044\u70B9" }), _jsx("ul", { className: "mt-2 space-y-2 text-sm text-slate-700", children: result.positives.map((item) => (_jsx("li", { className: "rounded-xl bg-emerald-50 px-3 py-2", children: item }, item))) })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-rose-500", children: "\u6539\u5584\u30DD\u30A4\u30F3\u30C8" }), _jsx("ul", { className: "mt-2 space-y-2 text-sm text-slate-700", children: result.improvement_points.map((item) => (_jsx("li", { className: "rounded-xl bg-rose-50 px-3 py-2", children: item }, item))) })] })] }), _jsxs("div", { className: "mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700", children: [_jsx("div", { className: "font-semibold text-sky-700", children: "\u30A2\u30C9\u30D0\u30A4\u30B9" }), _jsx("div", { className: "mt-1", children: result.advice })] })] }));
}
function AttemptHistoryCard({ attempt, selected, onSelect, }) {
    return (_jsx("button", { type: "button", onClick: () => onSelect(attempt.attempt_id), className: `w-full rounded-2xl border px-4 py-3 text-left transition ${selected
            ? 'border-sky-500 bg-sky-50 shadow-sm'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`, children: _jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-sm font-semibold text-slate-900", children: [formatPoints(attempt.overall_score), " / ", formatPoints(attempt.total_possible_score), "\u70B9"] }), _jsxs("div", { className: "mt-1 text-xs text-slate-500", children: [attempt.overall_percentage, "% \u30FB ", formatDateTime(attempt.scored_at)] })] }), _jsxs("div", { className: "text-right text-xs text-slate-500", children: [_jsxs("div", { children: [attempt.answered_questions, " / ", attempt.total_questions, "\u8A2D\u554F"] }), _jsx("div", { children: attempt.cached ? 'キャッシュ再利用' : '新規採点' })] })] }) }));
}
export default function SecondaryExamResultPage() {
    const navigate = useNavigate();
    const { attemptId } = useParams();
    const [detail, setDetail] = useState(null);
    const [result, setResult] = useState(null);
    const [selectedHistoryAttemptId, setSelectedHistoryAttemptId] = useState(attemptId ?? null);
    const [oralVivaInput, setOralVivaInput] = useState('');
    const [oralVivaConversation, setOralVivaConversation] = useState([]);
    const [oralVivaSuggestedFollowups, setOralVivaSuggestedFollowups] = useState([]);
    const [oralVivaCitedQuestionKeys, setOralVivaCitedQuestionKeys] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAskingOralViva, setIsAskingOralViva] = useState(false);
    const [error, setError] = useState('');
    const questionPackets = detail?.bundle.normalized_scoring_input.question_prompt_packets ?? [];
    const resultHistory = detail?.result_history ?? [];
    const selectedHistoryAttempt = useMemo(() => resultHistory.find((item) => item.attempt_id === selectedHistoryAttemptId) ?? null, [resultHistory, selectedHistoryAttemptId]);
    useEffect(() => {
        const load = async () => {
            if (!attemptId) {
                setError('採点結果IDが指定されていません。');
                setIsLoading(false);
                return;
            }
            setIsLoading(true);
            setError('');
            try {
                const nextResult = await fetchSecondaryExamResult(attemptId);
                const nextDetail = await fetchSecondaryExamDetail(nextResult.year_label, nextResult.case_no);
                setResult(nextResult);
                setDetail(nextDetail);
                setSelectedHistoryAttemptId(attemptId);
            }
            catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '採点結果の読み込みに失敗しました。');
            }
            finally {
                setIsLoading(false);
            }
        };
        void load();
    }, [attemptId]);
    useEffect(() => {
        const loadSelectedResult = async () => {
            if (!selectedHistoryAttemptId || selectedHistoryAttemptId === result?.attempt_id) {
                return;
            }
            setError('');
            try {
                const nextResult = await fetchSecondaryExamResult(selectedHistoryAttemptId);
                setResult(nextResult);
                setOralVivaConversation([]);
                setOralVivaSuggestedFollowups([]);
                setOralVivaCitedQuestionKeys([]);
                setOralVivaInput('');
                navigate(`/secondary-exam/results/${selectedHistoryAttemptId}`, { replace: true });
            }
            catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '採点結果の読み込みに失敗しました。');
            }
        };
        void loadSelectedResult();
    }, [navigate, result?.attempt_id, selectedHistoryAttemptId]);
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
    if (error && !detail && !result) {
        return _jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error });
    }
    if (!detail || !result) {
        return _jsx("div", { className: "rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600", children: "\u63A1\u70B9\u7D50\u679C\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002" });
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("section", { className: "rounded-[2rem] bg-gradient-to-br from-[#0f172a] via-[#12355b] to-[#1d4f91] p-6 text-white shadow-xl md:p-8", children: _jsxs("div", { className: "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "max-w-3xl", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.28em] text-sky-200", children: "Scoring Result" }), _jsxs("h2", { className: "mt-3 text-3xl font-bold leading-tight md:text-4xl", children: [detail.bundle.year_label, " \u4E8B\u4F8B", detail.bundle.case_no, " \u63A1\u70B9\u7D50\u679C"] }), _jsx("p", { className: "mt-3 text-sm leading-7 text-sky-100", children: "\u554F\u984C\u6587PDF\u306F\u8868\u793A\u305B\u305A\u3001\u63D0\u51FA\u7B54\u6848\u3068AI\u63A1\u70B9\u5185\u5BB9\u3092\u8A2D\u554F\u3054\u3068\u306B\u632F\u308A\u8FD4\u308C\u307E\u3059\u3002" })] }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsxs("button", { type: "button", onClick: () => navigate(`/secondary-exam?view=dashboard&year=${detail.bundle.year_label}&case=${detail.bundle.case_no}`), className: "inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15", children: [_jsx(BarChartIcon, { className: "h-4 w-4" }), "\u7BA1\u7406\u753B\u9762\u3078\u623B\u308B"] }), _jsxs("button", { type: "button", onClick: () => navigate(`/secondary-exam?view=practice&year=${detail.bundle.year_label}&case=${detail.bundle.case_no}`), className: "inline-flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100", children: [_jsx(PencilIcon, { className: "h-4 w-4" }), "\u65B0\u898F\u3067\u6F14\u7FD2\u3059\u308B"] })] })] }) }), error ? (_jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error })) : null, _jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Summary" }), _jsxs("h3", { className: "mt-1 text-2xl font-semibold text-slate-900", children: ["\u7DCF\u5408 ", formatPoints(result.overall_score), " / ", formatPoints(result.total_possible_score), "\u70B9"] }), _jsxs("div", { className: "mt-1 text-sm font-semibold text-sky-700", children: [result.overall_percentage, "%"] }), _jsx("p", { className: "mt-2 text-sm leading-7 text-slate-600", children: result.overall_feedback.summary })] }), _jsxs("div", { className: "rounded-3xl bg-slate-900 px-5 py-4 text-white", children: [_jsx("div", { className: "text-xs uppercase tracking-[0.2em] text-slate-300", children: "Scored At" }), _jsx("div", { className: "mt-2 text-sm font-semibold", children: formatDateTime(result.scored_at) }), _jsx("div", { className: "mt-1 text-xs text-slate-300", children: result.cached ? '同一答案のキャッシュ結果' : result.overall_feedback.used_ai ? 'AI採点を使用' : 'ローカル評価を使用' })] })] }), _jsx("div", { className: "mt-4 flex flex-wrap gap-2", children: result.overall_feedback.priority_actions.map((item) => (_jsx("span", { className: "rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700", children: item }, item))) })] }), resultHistory.length > 0 ? (_jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Score History" }), _jsx("h3", { className: "mt-1 text-xl font-semibold text-slate-900", children: "\u5C65\u6B74\u3054\u3068\u306E\u632F\u308A\u8FD4\u308A" })] }), _jsxs("div", { className: "rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600", children: [resultHistory.length, "\u4EF6"] })] }), _jsxs("div", { className: "mt-5 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]", children: [_jsx("div", { className: "space-y-3", children: resultHistory.map((attempt) => (_jsx(AttemptHistoryCard, { attempt: attempt, selected: attempt.attempt_id === selectedHistoryAttempt?.attempt_id, onSelect: setSelectedHistoryAttemptId }, attempt.attempt_id))) }), _jsx("div", { className: "rounded-2xl bg-slate-50 p-4 text-sm text-slate-600", children: "\u5DE6\u306E\u5C65\u6B74\u3092\u9078\u3076\u3068\u3001\u305D\u306E\u56DE\u306E\u56DE\u7B54\u5185\u5BB9\u3068AI\u63A1\u70B9\u7D50\u679C\u3092\u3053\u306E\u30DA\u30FC\u30B8\u3067\u5207\u308A\u66FF\u3048\u3066\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002" })] })] })) : null, _jsx("section", { className: "space-y-4", children: questionPackets.map((packet) => (_jsx(QuestionResultCard, { packet: packet, result: result.question_results.find((item) => item.question_key === packet.question_key), answerText: result.answers[packet.question_key] ?? '' }, `${result.attempt_id}-${packet.question_key}`))) }), _jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Case Oral Viva" }), _jsx("h3", { className: "mt-1 text-xl font-semibold text-slate-900", children: "\u63A1\u70B9\u5F8C\u306E\u53E3\u982D\u8A66\u554FQ&A" }), _jsx("p", { className: "mt-2 text-sm leading-7 text-slate-600", children: "\u3053\u306E\u63A1\u70B9\u7D50\u679C\u3092\u524D\u63D0\u306B\u3001\u8A2D\u554F\u6A2A\u65AD\u306E\u78BA\u8A8D\u3084\u66F8\u304D\u76F4\u3057\u30DD\u30A4\u30F3\u30C8\u3092\u6DF1\u6398\u308A\u3067\u304D\u307E\u3059\u3002" })] }), _jsxs("div", { className: "rounded-2xl bg-slate-100 px-4 py-3 text-xs font-semibold text-slate-600", children: ["\u5BFE\u8C61\u7D50\u679C: ", formatDateTime(result.scored_at)] })] }), oralVivaCitedQuestionKeys.length > 0 ? (_jsx("div", { className: "mt-4 flex flex-wrap gap-2", children: oralVivaCitedQuestionKeys.map((questionKey) => (_jsxs("span", { className: "rounded-full bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700", children: ["\u95A2\u9023\u8A2D\u554F ", questionKey] }, questionKey))) })) : null, _jsx("div", { className: "mt-5 space-y-3", children: oralVivaConversation.length > 0 ? (oralVivaConversation.map((turn, index) => (_jsxs("div", { className: `rounded-2xl px-4 py-3 text-sm leading-7 ${turn.role === 'assistant' ? 'bg-slate-50 text-slate-800' : 'bg-sky-50 text-sky-950'}`, children: [_jsx("div", { className: "mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400", children: turn.role === 'assistant' ? 'Examiner' : 'You' }), _jsx("div", { className: "whitespace-pre-wrap", children: turn.content })] }, `${turn.role}-${index}`)))) : (_jsx("div", { className: "rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600", children: "\u4F8B: \u300C\u8A2D\u554F1\u3068\u8A2D\u554F2\u3067\u4E00\u8CAB\u3057\u3066\u8A00\u3046\u3079\u304D\u5F37\u307F\u306F\uFF1F\u300D\u300C\u4ECA\u56DE\u306E\u7B54\u6848\u3067\u6700\u512A\u5148\u306E\u66F8\u304D\u76F4\u3057\u30DD\u30A4\u30F3\u30C8\u306F\uFF1F\u300D" })) }), oralVivaSuggestedFollowups.length > 0 ? (_jsx("div", { className: "mt-4 flex flex-wrap gap-2", children: oralVivaSuggestedFollowups.map((item) => (_jsx("button", { type: "button", onClick: () => void handleAskOralViva(item), disabled: isAskingOralViva, className: "rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60", children: item }, item))) })) : null, _jsxs("div", { className: "mt-5", children: [_jsx("textarea", { value: oralVivaInput, onChange: (event) => setOralVivaInput(event.target.value), placeholder: "\u3053\u306E\u63A1\u70B9\u7D50\u679C\u306B\u3064\u3044\u3066\u78BA\u8A8D\u3057\u305F\u3044\u3053\u3068\u3092\u5165\u529B\u3057\u307E\u3059\u3002", className: "min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-sky-400" }), _jsx("div", { className: "mt-3 flex justify-end", children: _jsxs("button", { type: "button", onClick: () => void handleAskOralViva(), disabled: isAskingOralViva || !oralVivaInput.trim(), className: "inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60", children: [isAskingOralViva ? _jsx(LoaderIcon, { className: "h-4 w-4 animate-spin" }) : null, isAskingOralViva ? '回答生成中...' : '質問する'] }) })] })] })] }));
}
//# sourceMappingURL=SecondaryExamResultPage.js.map