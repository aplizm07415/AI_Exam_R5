import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';
import { markdownComponents } from './components/markdownComponents';
import mplusRegularFontUrl from './assets/fonts/MPLUS1p-Regular.ttf';
const API_BASE_URL = '/api';
const PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY = 'paperPracticePendingRequest';
const PDF_FONT_FILE_NAME = 'MPLUS1p-Regular.ttf';
const PDF_FONT_NAME = 'MPLUS1p';
const PAPER_PAGE_WIDTH = 595;
const PAPER_PAGE_HEIGHT = 842;
const PDF_MAX_FONT_SIZE = 15;
const PDF_MIN_FONT_SIZE = 7;
const JAPANESE_CHOICE_LABELS = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク'];
let pdfFontBinaryStringPromise = null;
function arrayBufferToBinaryString(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return binary;
}
function loadPdfFontBinaryString() {
    if (!pdfFontBinaryStringPromise) {
        pdfFontBinaryStringPromise = fetch(mplusRegularFontUrl)
            .then((response) => {
            if (!response.ok) {
                throw new Error('PDF用フォントの取得に失敗しました。');
            }
            return response.arrayBuffer();
        })
            .then(arrayBufferToBinaryString);
    }
    return pdfFontBinaryStringPromise;
}
function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value;
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}
function getLotDisplayTitle(lot) {
    if (/^紙演習ロット \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(lot.title)) {
        return `紙演習ロット ${formatDateTime(lot.created_at)}`;
    }
    return lot.title;
}
function modeLabel(mode) {
    const labels = {
        today_remaining: '今日の残り',
        random: 'ランダム',
        weak_area: '苦手克服',
        unanswered: '未解答問題',
        specific_area: '特定領域',
        paper_practice: '紙演習',
    };
    return mode ? labels[mode] ?? mode : '-';
}
function choiceDisplayLabel(index, fallback) {
    return JAPANESE_CHOICE_LABELS[index] ?? fallback;
}
function sanitizeFilename(value) {
    return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'paper-practice-lot';
}
function normalizePdfText(value) {
    return (value ?? '').replace(/\r\n/g, '\n').trim();
}
function getChoiceDisplayForLabel(question, label) {
    const index = question.choices.findIndex((choice) => choice.label === label);
    if (index < 0)
        return label;
    return choiceDisplayLabel(index, label);
}
function PaperReviewCard({ item, }) {
    const selectedChoice = item.question.choices.find((choice) => choice.label === item.selectedAnswer);
    const correctChoice = item.question.choices.find((choice) => choice.label === item.question.answer);
    return (_jsxs("div", { className: "rounded-xl border border-slate-200 bg-white p-4 shadow-sm", children: [_jsxs("div", { className: "mb-3 flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { className: "text-sm font-semibold text-slate-900", children: ["\u30ED\u30C3\u30C8\u5185 ", item.lotNumber, "\u554F\u76EE"] }), _jsx("div", { className: `rounded-full px-3 py-1 text-xs font-semibold ${item.isCorrect ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`, children: item.isCorrect ? '正解' : '不正解' })] }), _jsx("p", { className: "whitespace-pre-wrap text-sm font-semibold text-slate-800", children: item.question.question_text }), _jsxs("div", { className: "mt-4 grid gap-2 text-sm sm:grid-cols-2", children: [_jsxs("div", { className: "rounded-lg bg-slate-50 p-3", children: [_jsx("div", { className: "text-xs font-semibold text-slate-500", children: "\u9078\u629E" }), _jsx("div", { className: "mt-1 text-slate-800", children: selectedChoice ? `${item.selectedAnswer}. ${selectedChoice.text}` : item.selectedAnswer })] }), _jsxs("div", { className: "rounded-lg bg-emerald-50 p-3", children: [_jsx("div", { className: "text-xs font-semibold text-emerald-700", children: "\u6B63\u89E3" }), _jsx("div", { className: "mt-1 text-emerald-950", children: correctChoice ? `${item.question.answer}. ${correctChoice.text}` : item.question.answer })] })] }), _jsxs("div", { className: "mt-4 border-t border-slate-200 pt-4", children: [_jsx("h4", { className: "text-base font-semibold text-primary-new", children: "\u89E3\u8AAC" }), _jsx("div", { className: "prose prose-sm mt-2 max-w-none text-slate-700", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkBreaks], components: markdownComponents, children: item.question.explanation?.text || 'この問題の解説はありません。' }) })] })] }));
}
export default function PaperPracticePage() {
    const [lots, setLots] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreatingLot, setIsCreatingLot] = useState(false);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [deletingLotId, setDeletingLotId] = useState(null);
    const [isSubmittingAnswers, setIsSubmittingAnswers] = useState(false);
    const [pdfProgress, setPdfProgress] = useState('');
    const [error, setError] = useState('');
    const [answerLot, setAnswerLot] = useState(null);
    const [answers, setAnswers] = useState({});
    const [gradedAnswers, setGradedAnswers] = useState([]);
    const [modalStep, setModalStep] = useState('answer');
    const [reviewKind, setReviewKind] = useState('incorrect');
    const [reviewIndex, setReviewIndex] = useState(0);
    const pendingHandledRef = useRef(false);
    const fetchLots = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const response = await fetch(`${API_BASE_URL}/paper-practice/lots`);
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '紙演習ロットの取得に失敗しました。');
            }
            const payload = await response.json();
            setLots(payload);
        }
        catch (fetchError) {
            setError(fetchError instanceof Error ? fetchError.message : '紙演習ロットの取得に失敗しました。');
        }
        finally {
            setIsLoading(false);
        }
    }, []);
    const createLot = useCallback(async (request) => {
        setIsCreatingLot(true);
        setError('');
        try {
            const response = await fetch(`${API_BASE_URL}/paper-practice/lots`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '紙演習ロットの作成に失敗しました。');
            }
            const lot = await response.json();
            setLots((current) => [lot, ...current.filter((item) => item.id !== lot.id)]);
        }
        catch (createError) {
            setError(createError instanceof Error ? createError.message : '紙演習ロットの作成に失敗しました。');
        }
        finally {
            setIsCreatingLot(false);
        }
    }, []);
    useEffect(() => {
        void fetchLots();
    }, [fetchLots]);
    useEffect(() => {
        if (pendingHandledRef.current)
            return;
        pendingHandledRef.current = true;
        const raw = sessionStorage.getItem(PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY);
        if (!raw)
            return;
        sessionStorage.removeItem(PAPER_PRACTICE_PENDING_REQUEST_STORAGE_KEY);
        try {
            const parsed = JSON.parse(raw);
            void createLot(parsed);
        }
        catch {
            setError('紙演習ロット作成条件の読み込みに失敗しました。');
        }
    }, [createLot]);
    const openAnswerModal = (lot) => {
        setAnswerLot(lot);
        setAnswers({});
        setGradedAnswers([]);
        setModalStep('answer');
        setReviewKind('incorrect');
        setReviewIndex(0);
        setError('');
    };
    const closeAnswerModal = () => {
        if (isSubmittingAnswers)
            return;
        setAnswerLot(null);
        setAnswers({});
        setGradedAnswers([]);
        setModalStep('answer');
    };
    const deleteLot = async (lot) => {
        if (deletingLotId)
            return;
        if (!window.confirm(`ロット「${lot.title}」を削除しますか？`))
            return;
        setDeletingLotId(lot.id);
        setError('');
        try {
            const response = await fetch(`${API_BASE_URL}/paper-practice/lots/${encodeURIComponent(lot.id)}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '紙演習ロットの削除に失敗しました。');
            }
            setLots((current) => current.filter((item) => item.id !== lot.id));
            if (answerLot?.id === lot.id) {
                setAnswerLot(null);
                setAnswers({});
                setGradedAnswers([]);
                setModalStep('answer');
            }
        }
        catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : '紙演習ロットの削除に失敗しました。');
        }
        finally {
            setDeletingLotId(null);
        }
    };
    const exportLotPdf = async (lot) => {
        if (isExportingPdf)
            return;
        setIsExportingPdf(true);
        setPdfProgress('PDFを準備しています...');
        setError('');
        try {
            const { jsPDF } = await import('jspdf');
            const fontBinary = await loadPdfFontBinaryString();
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'px',
                format: [PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT],
                compress: true,
            });
            pdf.addFileToVFS(PDF_FONT_FILE_NAME, fontBinary);
            pdf.addFont(PDF_FONT_FILE_NAME, PDF_FONT_NAME, 'normal');
            pdf.setFont(PDF_FONT_NAME, 'normal');
            const contentWidth = PAPER_PAGE_WIDTH - 32;
            const drawLines = (lines, x, y, lineHeight) => {
                lines.forEach((line, index) => {
                    pdf.text(line, x, y + index * lineHeight);
                });
            };
            lot.questions.forEach((question, questionIndex) => {
                if (questionIndex > 0) {
                    pdf.addPage([PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT], 'portrait');
                }
                setPdfProgress(`PDFを生成中... ${questionIndex + 1} / ${lot.questions.length}`);
                const baseBlocks = [
                    `${getLotDisplayTitle(lot)} / ロット内 ${questionIndex + 1}問目`,
                    `${question.subject}${question.category ? ` / ${question.category}` : ''}`,
                    '',
                    normalizePdfText(question.question_text),
                    '',
                    ...question.choices.map((choice, choiceIndex) => `${choiceDisplayLabel(choiceIndex, choice.label)}. ${choice.text}`),
                ];
                let fontSize = PDF_MAX_FONT_SIZE;
                let renderedLines = [];
                while (fontSize >= PDF_MIN_FONT_SIZE) {
                    pdf.setFontSize(fontSize);
                    renderedLines = baseBlocks.flatMap((block) => (block ? pdf.splitTextToSize(block, contentWidth) : ['']));
                    const lineHeight = fontSize * 1.35;
                    if (renderedLines.length * lineHeight <= PAPER_PAGE_HEIGHT - 34) {
                        break;
                    }
                    fontSize -= 1;
                }
                pdf.setFillColor(255, 255, 255);
                pdf.rect(0, 0, PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT, 'F');
                pdf.setTextColor(15, 23, 42);
                pdf.setFontSize(fontSize);
                drawLines(renderedLines, 16, 24, fontSize * 1.35);
            });
            pdf.save(`${sanitizeFilename(getLotDisplayTitle(lot))}.pdf`);
        }
        catch (exportError) {
            setError(exportError instanceof Error ? exportError.message : 'PDF出力に失敗しました。');
        }
        finally {
            setIsExportingPdf(false);
            setPdfProgress('');
        }
    };
    const submitAnswers = async () => {
        if (!answerLot || isSubmittingAnswers || gradedAnswers.length > 0)
            return;
        const missingNumbers = answerLot.questions
            .map((question, index) => (answers[question.id] ? null : index + 1))
            .filter((value) => value !== null);
        if (missingNumbers.length > 0) {
            setError(`未入力の問題があります: ${missingNumbers.join(', ')}`);
            return;
        }
        const graded = answerLot.questions.map((question, index) => ({
            lotNumber: index + 1,
            question,
            selectedAnswer: answers[question.id],
            isCorrect: answers[question.id] === question.answer,
        }));
        try {
            setIsSubmittingAnswers(true);
            setError('');
            const response = await fetch(`${API_BASE_URL}/history/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(graded.map((item) => ({
                    problem_id: item.question.id,
                    subject: item.question.subject,
                    selected_answer: item.selectedAnswer,
                    is_correct: item.isCorrect,
                    category: item.question.category,
                    mode: 'paper_practice',
                }))),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '一括採点結果の保存に失敗しました。');
            }
            setGradedAnswers(graded);
            setReviewKind(graded.some((item) => !item.isCorrect) ? 'incorrect' : 'correct');
            setReviewIndex(0);
            setModalStep('result');
        }
        catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : '一括採点結果の保存に失敗しました。');
        }
        finally {
            setIsSubmittingAnswers(false);
        }
    };
    const currentReviewItems = useMemo(() => gradedAnswers.filter((item) => (reviewKind === 'incorrect' ? !item.isCorrect : item.isCorrect)), [gradedAnswers, reviewKind]);
    const currentReviewItem = currentReviewItems[Math.min(reviewIndex, Math.max(0, currentReviewItems.length - 1))];
    const correctCount = gradedAnswers.filter((item) => item.isCorrect).length;
    const incorrectCount = gradedAnswers.length - correctCount;
    const answeredCount = answerLot ? answerLot.questions.filter((question) => answers[question.id]).length : 0;
    const accuracy = gradedAnswers.length > 0 ? Math.round((correctCount / gradedAnswers.length) * 100) : 0;
    const startReview = (kind) => {
        setReviewKind(kind);
        setReviewIndex(0);
        setModalStep('review');
    };
    return (_jsxs("div", { className: "mx-auto max-w-5xl px-4 py-4", children: [_jsxs("div", { className: "mb-5 flex flex-wrap items-end justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-slate-900", children: "\u7D19\u6F14\u7FD2\u30E2\u30FC\u30C9" }), _jsx("p", { className: "mt-1 text-sm text-slate-500", children: "\u30ED\u30C3\u30C8\u4E00\u89A7" })] }), _jsx("button", { type: "button", onClick: () => void fetchLots(), disabled: isLoading || isCreatingLot, className: "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50", children: "\u66F4\u65B0" })] }), isCreatingLot && (_jsx("div", { className: "mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800", children: "\u30ED\u30C3\u30C8\u3092\u4F5C\u6210\u3057\u3066\u3044\u307E\u3059..." })), pdfProgress && (_jsx("div", { className: "mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700", children: pdfProgress })), error && (_jsx("div", { className: "mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700", children: error })), isLoading ? (_jsx(LoadingSpinner, {})) : lots.length === 0 ? (_jsx("div", { className: "rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500", children: "\u30ED\u30C3\u30C8\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsx("div", { className: "space-y-3", children: lots.map((lot) => (_jsx("div", { className: "rounded-xl border border-slate-200 bg-white p-4 shadow-sm", children: _jsxs("div", { className: "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-lg font-semibold text-slate-900", children: getLotDisplayTitle(lot) }), _jsxs("div", { className: "mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500", children: [_jsx("span", { children: formatDateTime(lot.created_at) }), _jsxs("span", { children: [lot.count, "\u554F"] }), _jsx("span", { children: modeLabel(lot.source_mode || lot.mode) }), _jsx("span", { className: "truncate", children: lot.subjects.join(', ') })] })] }), _jsxs("div", { className: "grid grid-cols-3 gap-2 sm:w-80", children: [_jsx("button", { type: "button", onClick: () => void exportLotPdf(lot), disabled: isExportingPdf || deletingLotId === lot.id, className: "rounded-md border border-slate-700 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50", children: "PDF\u51FA\u529B" }), _jsx("button", { type: "button", onClick: () => openAnswerModal(lot), disabled: deletingLotId === lot.id, className: "rounded-md bg-primary-new px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50", children: "\u6F14\u7FD2\u958B\u59CB" }), _jsx("button", { type: "button", onClick: () => void deleteLot(lot), disabled: deletingLotId === lot.id, className: "rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50", children: deletingLotId === lot.id ? '削除中...' : '削除' })] })] }) }, lot.id))) })), answerLot && (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-2 py-3 sm:px-4 sm:py-6", children: _jsxs("div", { className: "grid h-[92dvh] max-h-[56rem] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg bg-white shadow-2xl", children: [_jsxs("div", { className: "border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "truncate text-lg font-semibold text-slate-900", children: getLotDisplayTitle(answerLot) }), _jsxs("p", { className: "text-xs text-slate-500", children: [answerLot.count, "\u554F / ", formatDateTime(answerLot.created_at)] })] }), _jsx("button", { type: "button", onClick: closeAnswerModal, className: "rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50", children: "\u9589\u3058\u308B" })] }), _jsxs("div", { className: "mt-3 grid grid-cols-3 gap-2 text-center text-xs font-semibold", children: [_jsx("div", { className: `rounded-md px-2 py-2 ${modalStep === 'answer' ? 'bg-primary-new text-white' : 'bg-slate-100 text-slate-500'}`, children: "\u89E3\u7B54\u5165\u529B" }), _jsx("div", { className: `rounded-md px-2 py-2 ${modalStep === 'result' ? 'bg-primary-new text-white' : 'bg-slate-100 text-slate-500'}`, children: "\u63A1\u70B9\u7D50\u679C" }), _jsx("div", { className: `rounded-md px-2 py-2 ${modalStep === 'review' ? 'bg-primary-new text-white' : 'bg-slate-100 text-slate-500'}`, children: "\u89E3\u8AAC\u78BA\u8A8D" })] })] }), _jsxs("div", { className: "min-h-0 overflow-y-auto px-3 py-4 sm:px-5", children: [modalStep === 'answer' && (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600", children: ["\u5165\u529B\u6E08\u307F ", answeredCount, " / ", answerLot.questions.length] }), answerLot.questions.map((question, index) => (_jsxs("div", { className: "grid grid-cols-[4.75rem_minmax(0,1fr)] items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white", children: [_jsx("div", { className: "flex items-center justify-center bg-slate-50 px-2 text-sm font-semibold text-slate-800", children: index + 1 }), _jsx("div", { className: "grid grid-cols-2 gap-2 p-2 sm:grid-cols-4", children: question.choices.map((choice, choiceIndex) => (_jsxs("label", { className: `flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm font-semibold transition-colors ${answers[question.id] === choice.label
                                                            ? 'border-primary-new bg-blue-50 text-primary-new'
                                                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`, children: [_jsx("input", { type: "radio", name: `paper-answer-${question.id}`, value: choice.label, checked: answers[question.id] === choice.label, onChange: () => setAnswers((current) => ({ ...current, [question.id]: choice.label })), className: "h-4 w-4" }), _jsx("span", { children: choiceDisplayLabel(choiceIndex, choice.label) })] }, choice.label))) })] }, question.id)))] })), modalStep === 'result' && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-4", children: [_jsxs("div", { className: "rounded-lg bg-slate-100 p-4 text-center", children: [_jsx("div", { className: "text-xs font-semibold text-slate-500", children: "\u63A1\u70B9\u6E08\u307F" }), _jsx("div", { className: "mt-1 text-2xl font-bold text-slate-800", children: gradedAnswers.length })] }), _jsxs("div", { className: "rounded-lg bg-emerald-50 p-4 text-center", children: [_jsx("div", { className: "text-xs font-semibold text-emerald-700", children: "\u6B63\u89E3" }), _jsx("div", { className: "mt-1 text-2xl font-bold text-emerald-800", children: correctCount })] }), _jsxs("div", { className: "rounded-lg bg-rose-50 p-4 text-center", children: [_jsx("div", { className: "text-xs font-semibold text-rose-700", children: "\u4E0D\u6B63\u89E3" }), _jsx("div", { className: "mt-1 text-2xl font-bold text-rose-700", children: incorrectCount })] }), _jsxs("div", { className: "rounded-lg bg-blue-50 p-4 text-center", children: [_jsx("div", { className: "text-xs font-semibold text-blue-700", children: "\u6B63\u7B54\u7387" }), _jsxs("div", { className: "mt-1 text-2xl font-bold text-blue-800", children: [accuracy, "%"] })] })] }), _jsxs("div", { className: "overflow-hidden rounded-lg border border-slate-200", children: [_jsxs("div", { className: "grid grid-cols-[4rem_1fr_1fr_5rem] bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500", children: [_jsx("div", { children: "No." }), _jsx("div", { children: "\u9078\u629E" }), _jsx("div", { children: "\u6B63\u89E3" }), _jsx("div", { className: "text-right", children: "\u7D50\u679C" })] }), _jsx("div", { className: "max-h-[42vh] overflow-y-auto divide-y divide-slate-100", children: gradedAnswers.map((item) => (_jsxs("div", { className: "grid grid-cols-[4rem_1fr_1fr_5rem] items-center px-3 py-2 text-sm", children: [_jsx("div", { className: "font-semibold text-slate-700", children: item.lotNumber }), _jsx("div", { className: "text-slate-700", children: getChoiceDisplayForLabel(item.question, item.selectedAnswer) }), _jsx("div", { className: "text-slate-700", children: getChoiceDisplayForLabel(item.question, item.question.answer) }), _jsx("div", { className: `text-right text-xs font-semibold ${item.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`, children: item.isCorrect ? '正解' : '不正解' })] }, `${item.question.id}-${item.lotNumber}`))) })] }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [_jsx("button", { type: "button", onClick: () => startReview('incorrect'), disabled: incorrectCount === 0, className: "rounded-md bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-500", children: "\u4E0D\u6B63\u89E3\u306E\u89E3\u8AAC\u3092\u78BA\u8A8D" }), _jsx("button", { type: "button", onClick: () => startReview('correct'), disabled: correctCount === 0, className: "rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-500", children: "\u6B63\u89E3\u306E\u89E3\u8AAC\u3092\u78BA\u8A8D" })] })] })), modalStep === 'review' && (_jsxs("div", { children: [_jsxs("div", { className: "mb-4 flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => startReview('incorrect'), disabled: incorrectCount === 0, className: `rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${reviewKind === 'incorrect' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`, children: "\u4E0D\u6B63\u89E3" }), _jsx("button", { type: "button", onClick: () => startReview('correct'), disabled: correctCount === 0, className: `rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${reviewKind === 'correct' ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`, children: "\u6B63\u89E3" })] }), _jsx("button", { type: "button", onClick: () => setModalStep('result'), className: "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50", children: "\u7D50\u679C\u3078\u623B\u308B" })] }), currentReviewItem ? (_jsxs("div", { className: "space-y-3", children: [_jsx(PaperReviewCard, { item: currentReviewItem }), _jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("button", { type: "button", onClick: () => setReviewIndex((current) => Math.max(0, current - 1)), disabled: reviewIndex <= 0, className: "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50", children: "\u524D\u3078" }), _jsxs("div", { className: "text-sm text-slate-500", children: [Math.min(reviewIndex + 1, currentReviewItems.length), " / ", currentReviewItems.length] }), _jsx("button", { type: "button", onClick: () => setReviewIndex((current) => Math.min(currentReviewItems.length - 1, current + 1)), disabled: reviewIndex >= currentReviewItems.length - 1, className: "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50", children: "\u6B21\u3078" })] })] })) : (_jsx("div", { className: "rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500", children: "\u5BFE\u8C61\u306E\u554F\u984C\u306F\u3042\u308A\u307E\u305B\u3093\u3002" }))] }))] }), _jsx("div", { className: "border-t border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4", children: modalStep === 'answer' ? (_jsx("button", { type: "button", onClick: () => void submitAnswers(), disabled: isSubmittingAnswers, className: "w-full rounded-md bg-primary-new px-4 py-3 text-base font-medium text-white hover:bg-blue-700 disabled:bg-gray-300", children: isSubmittingAnswers ? '採点中...' : '一括採点' })) : modalStep === 'result' ? (_jsx("button", { type: "button", onClick: closeAnswerModal, className: "w-full rounded-md bg-slate-800 px-4 py-3 text-base font-medium text-white hover:bg-slate-700", children: "\u5B8C\u4E86" })) : (_jsxs("div", { className: "grid gap-2 sm:grid-cols-2", children: [_jsx("button", { type: "button", onClick: () => setModalStep('result'), className: "rounded-md border border-slate-300 px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50", children: "\u7D50\u679C\u3078\u623B\u308B" }), _jsx("button", { type: "button", onClick: closeAnswerModal, className: "rounded-md bg-slate-800 px-4 py-3 text-base font-medium text-white hover:bg-slate-700", children: "\u5B8C\u4E86" })] })) })] }) }))] }));
}
//# sourceMappingURL=PaperPracticePage.js.map