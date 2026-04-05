import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import { PencilIcon } from './components/icons';
import { fetchSecondaryExamDetail, fetchSecondaryExamResult } from './secondaryExam/api';
function formatRichText(value) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (value && typeof value === 'object') {
        return Object.entries(value)
            .map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`)
            .join('\n');
    }
    return '';
}
function getChecklistItems(packet) {
    const rubricCandidates = Array.isArray(packet.rubric_candidates) ? packet.rubric_candidates : [];
    return rubricCandidates.flatMap((item) => item.checklist_items ?? []);
}
function findRubricForPacket(detail, packet) {
    const rubrics = detail.bundle.rubrics ?? [];
    return rubrics.find((item) => String(item.question_no ?? item.question ?? '') === String(packet.question_no))
        ?? rubrics.find((item) => typeof item.question === 'string' && item.question.includes(String(packet.question_no)));
}
function findExplanationForPacket(detail, packet) {
    const explanations = detail.bundle.explanations ?? [];
    return explanations.find((item) => String(item.question_no ?? '') === String(packet.question_no));
}
function ExplanationSection({ title, content, }) {
    if (!content.trim()) {
        return null;
    }
    return (_jsxs("section", { className: "rounded-2xl bg-slate-50 px-4 py-4", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: title }), _jsx("div", { className: "mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700", children: content })] }));
}
function ChecklistSection({ items }) {
    if (items.length === 0) {
        return null;
    }
    return (_jsxs("section", { className: "rounded-2xl bg-amber-50 px-4 py-4", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-amber-700", children: "\u63A1\u70B9\u89B3\u70B9" }), _jsx("ul", { className: "mt-2 space-y-2 text-sm leading-7 text-slate-700", children: items.map((item) => (_jsx("li", { className: "rounded-xl bg-white/70 px-3 py-2", children: item }, item))) })] }));
}
export default function SecondaryExamExplanationPage() {
    const navigate = useNavigate();
    const { attemptId } = useParams();
    const [detail, setDetail] = useState(null);
    const [result, setResult] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
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
            }
            catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '解説ページの読み込みに失敗しました。');
            }
            finally {
                setIsLoading(false);
            }
        };
        void load();
    }, [attemptId]);
    const explanationCards = useMemo(() => {
        if (!detail) {
            return [];
        }
        const packets = detail.bundle.normalized_scoring_input?.question_prompt_packets ?? [];
        return packets.map((packet) => {
            const rubric = findRubricForPacket(detail, packet);
            const explanation = findExplanationForPacket(detail, packet);
            const checklistItems = [
                ...((rubric?.採点観点 ?? []).filter((item) => typeof item === 'string' && item.trim().length > 0)),
                ...getChecklistItems(packet),
                ...((packet.calculation_breakdown?.scoring_checkpoints ?? []).filter((item) => typeof item === 'string' && item.trim().length > 0)),
            ];
            return {
                packet,
                modelAnswer: formatRichText(rubric?.模範解答) || formatRichText(explanation?.answer_example_text),
                explanationText: formatRichText(rubric?.解説)
                    || [explanation?.positioning_text, explanation?.solution_text, explanation?.difficulty_text]
                        .filter((item) => typeof item === 'string' && item.trim().length > 0)
                        .join('\n\n')
                    || (typeof packet.explanation_candidate === 'string' ? packet.explanation_candidate.trim() : ''),
                checklistItems: Array.from(new Set(checklistItems)),
            };
        }).filter((item) => item.modelAnswer || item.explanationText || item.checklistItems.length > 0);
    }, [detail]);
    if (isLoading) {
        return _jsx(LoadingSpinner, {});
    }
    if (error && !detail) {
        return _jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error });
    }
    if (!detail || !result) {
        return _jsx("div", { className: "rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600", children: "\u89E3\u8AAC\u30DA\u30FC\u30B8\u3092\u8868\u793A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" });
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("section", { className: "rounded-[2rem] bg-gradient-to-br from-[#172554] via-[#1d4ed8] to-[#60a5fa] p-6 text-white shadow-xl md:p-8", children: _jsxs("div", { className: "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "max-w-3xl", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.28em] text-sky-100", children: "Explanations" }), _jsxs("h2", { className: "mt-3 text-3xl font-bold leading-tight md:text-4xl", children: [detail.bundle.year_label, " \u4E8B\u4F8B", detail.bundle.case_no, " \u89E3\u8AAC\u30FB\u63A1\u70B9\u89B3\u70B9"] }), _jsx("p", { className: "mt-3 text-sm leading-7 text-sky-50", children: "\u6A21\u7BC4\u89E3\u7B54\u3001\u8A2D\u554F\u5225\u306E\u89E3\u8AAC\u3001\u63A1\u70B9\u89B3\u70B9\u3092\u307E\u3068\u3081\u3066\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002\u63A1\u70B9\u7D50\u679C\u3068\u306F\u5206\u96E2\u3057\u3066\u5FA9\u7FD2\u7528\u306B\u8AAD\u3081\u308B\u30DA\u30FC\u30B8\u3067\u3059\u3002" })] }), _jsx("div", { className: "flex flex-wrap gap-3", children: _jsxs("button", { type: "button", onClick: () => navigate(`/secondary-exam/results/${result.attempt_id}`), className: "inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15", children: [_jsx(PencilIcon, { className: "h-4 w-4" }), "\u63A1\u70B9\u7D50\u679C\u3078\u623B\u308B"] }) })] }) }), error ? (_jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error })) : null, explanationCards.length === 0 ? (_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm", children: "\u5229\u7528\u53EF\u80FD\u306A\u89E3\u8AAC\u30C7\u30FC\u30BF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002" })) : (explanationCards.map(({ packet, modelAnswer, explanationText, checklistItems }) => (_jsxs("article", { className: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: packet.question_key }), _jsx("h3", { className: "mt-1 text-xl font-semibold leading-8 text-slate-900", children: packet.prompt_text_clean })] }), _jsx("div", { className: "rounded-2xl bg-slate-900 px-3 py-2 text-right text-white", children: _jsx("div", { className: "text-sm font-semibold", children: "\u89E3\u8AAC" }) })] }), _jsxs("div", { className: "mt-5 space-y-4", children: [_jsx(ExplanationSection, { title: "\u6A21\u7BC4\u89E3\u7B54", content: modelAnswer }), _jsx(ExplanationSection, { title: "\u89E3\u8AAC", content: explanationText }), _jsx(ChecklistSection, { items: checklistItems })] })] }, packet.question_key))))] }));
}
//# sourceMappingURL=SecondaryExamExplanationPage.js.map