import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import mplusRegularFontUrl from './assets/fonts/MPLUS1p-Regular.ttf';
const API_BASE_URL = '/api';
const ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY = 'adhocQuizHistoryMode';
const SIMILAR_PRACTICE_HISTORY_MODE = 'similar_practice';
const getCustomImageUrls = (urls, legacyUrl) => {
    const normalized = (urls ?? []).filter((url) => typeof url === 'string' && url.trim().length > 0);
    if (normalized.length > 0) {
        return normalized;
    }
    return legacyUrl && legacyUrl.trim() ? [legacyUrl] : [];
};
const PDF_FONT_FILE_NAME = 'MPLUS1p-Regular.ttf';
const PDF_FONT_NAME = 'MPLUS1p';
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
function normalizePdfText(value) {
    return (value ?? '').replace(/\r\n/g, '\n').trim();
}
export default function ReviewLaterPage() {
    const navigate = useNavigate();
    const subjectProblemsCacheRef = useRef({});
    const firstMissedCacheRef = useRef({});
    const [items, setItems] = useState([]);
    const [subjectNames, setSubjectNames] = useState([]);
    const [selectedSubjectName, setSelectedSubjectName] = useState('');
    const [subjectProblems, setSubjectProblems] = useState([]);
    const [isLoadingSubjectProblems, setIsLoadingSubjectProblems] = useState(false);
    const [sortMode, setSortMode] = useState('default');
    const [firstMissedIds, setFirstMissedIds] = useState(new Set());
    const [firstMissedDateById, setFirstMissedDateById] = useState({});
    const [firstMissedDateFrom, setFirstMissedDateFrom] = useState('');
    const [firstMissedDateTo, setFirstMissedDateTo] = useState('');
    const [selectedKey, setSelectedKey] = useState('');
    const [editingProblem, setEditingProblem] = useState(null);
    const [customExplanationText, setCustomExplanationText] = useState('');
    const [showStructuredQuestionFields, setShowStructuredQuestionFields] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSavingProblem, setIsSavingProblem] = useState(false);
    const [isSavingMemo, setIsSavingMemo] = useState(false);
    const [isRegisteringHistory, setIsRegisteringHistory] = useState(false);
    const [isReorganizingExplanation, setIsReorganizingExplanation] = useState(false);
    const [aiExplanationReview, setAiExplanationReview] = useState(null);
    const [isFindingSimilar, setIsFindingSimilar] = useState(false);
    const [isBulkRegisteringFirstMissed, setIsBulkRegisteringFirstMissed] = useState(false);
    const [similarTopics, setSimilarTopics] = useState([]);
    const [isOralVivaActive, setIsOralVivaActive] = useState(false);
    const [oralVivaStepIndex, setOralVivaStepIndex] = useState(0);
    const [oralVivaMessages, setOralVivaMessages] = useState([]);
    const [oralVivaInput, setOralVivaInput] = useState('');
    const [oralVivaScores, setOralVivaScores] = useState({ logicality: 0, specificity: 0, reproducibility: 0 });
    const [oralVivaResult, setOralVivaResult] = useState(null);
    const [isOralVivaLoading, setIsOralVivaLoading] = useState(false);
    const [isExportingPdf, setIsExportingPdf] = useState(false);
    const [pdfExportProgress, setPdfExportProgress] = useState('');
    const [error, setError] = useState('');
    const oralVivaSteps = ['root', 'refute', 'apply', 'summary'];
    const oralVivaStepLabels = { root: '根拠', refute: '反証', apply: '応用', summary: '要約' };
    const fetchItems = async () => {
        setIsLoading(true);
        setError('');
        try {
            const response = await fetch(`${API_BASE_URL}/review-later`);
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '後で確認一覧の取得に失敗しました。');
            }
            const data = await response.json();
            setItems(data);
            setSelectedKey((prev) => {
                if (prev && data.some((item) => `${item.subject}::${item.problem_id}` === prev)) {
                    return prev;
                }
                const first = data[0];
                return first ? `${first.subject}::${first.problem_id}` : '';
            });
        }
        catch (fetchError) {
            console.error(fetchError);
            setError(fetchError instanceof Error ? fetchError.message : '後で確認一覧の取得に失敗しました。');
            setItems([]);
            setSelectedKey('');
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        void fetchItems();
    }, []);
    useEffect(() => {
        const fetchSubjects = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/subjects`);
                if (!response.ok) {
                    throw new Error('科目一覧の取得に失敗しました。');
                }
                const names = await response.json();
                const filtered = names
                    .filter((name) => name.endsWith('.json') &&
                    !name.includes('/') &&
                    name !== 'plans.json' &&
                    !name.startsWith('history/') &&
                    !name.startsWith('custom-explanations/') &&
                    !name.startsWith('soragaki/') &&
                    !name.startsWith('review-later/'))
                    .sort((a, b) => a.localeCompare(b));
                setSubjectNames(filtered);
                setSelectedSubjectName((prev) => prev || filtered[0] || '');
            }
            catch (fetchError) {
                console.error(fetchError);
            }
        };
        void fetchSubjects();
    }, []);
    const selectedItem = useMemo(() => items.find((item) => `${item.subject}::${item.problem_id}` === selectedKey) ?? null, [items, selectedKey]);
    const questionSupplementImageUrls = editingProblem
        ? getCustomImageUrls(editingProblem.custom_question_image_data_urls, editingProblem.custom_question_image_data_url)
        : [];
    const explanationSupplementImageUrls = editingProblem
        ? getCustomImageUrls(editingProblem.custom_explanation_image_data_urls, editingProblem.custom_explanation_image_data_url)
        : [];
    const selectedProblem = useMemo(() => {
        if (selectedItem?.question) {
            return selectedItem.question;
        }
        return subjectProblems.find((problem) => `${problem.subject}::${problem.id}` === selectedKey) ?? null;
    }, [selectedItem, subjectProblems, selectedKey]);
    const reviewLaterKeySet = useMemo(() => new Set(items.map((item) => `${item.subject}::${item.problem_id}`)), [items]);
    const removeReviewLaterEntryLocally = (subject, problemId) => {
        const targetKey = `${subject}::${problemId}`;
        setItems((prev) => {
            const next = prev.filter((item) => `${item.subject}::${item.problem_id}` !== targetKey);
            setSelectedKey((currentKey) => {
                if (currentKey !== targetKey) {
                    return currentKey && next.some((item) => `${item.subject}::${item.problem_id}` === currentKey)
                        ? currentKey
                        : (next[0] ? `${next[0].subject}::${next[0].problem_id}` : '');
                }
                return next[0] ? `${next[0].subject}::${next[0].problem_id}` : '';
            });
            return next;
        });
    };
    const sortedSubjectProblems = useMemo(() => {
        const filtered = subjectProblems.filter((problem) => {
            if (!firstMissedDateFrom && !firstMissedDateTo) {
                return true;
            }
            const firstMissedAt = firstMissedDateById[problem.id];
            if (!firstMissedAt) {
                return false;
            }
            const localDate = firstMissedAt.slice(0, 10);
            if (firstMissedDateFrom && localDate < firstMissedDateFrom) {
                return false;
            }
            if (firstMissedDateTo && localDate > firstMissedDateTo) {
                return false;
            }
            return true;
        });
        const next = [...filtered];
        if (sortMode === 'first_missed') {
            next.sort((a, b) => {
                const aFirstMissed = firstMissedIds.has(a.id) ? 1 : 0;
                const bFirstMissed = firstMissedIds.has(b.id) ? 1 : 0;
                if (aFirstMissed !== bFirstMissed) {
                    return bFirstMissed - aFirstMissed;
                }
                return a.id.localeCompare(b.id);
            });
            return next;
        }
        return next.sort((a, b) => a.id.localeCompare(b.id));
    }, [subjectProblems, sortMode, firstMissedIds, firstMissedDateById, firstMissedDateFrom, firstMissedDateTo]);
    const unregisteredFirstMissedProblems = useMemo(() => sortedSubjectProblems.filter((problem) => firstMissedIds.has(problem.id) && !reviewLaterKeySet.has(`${problem.subject}::${problem.id}`)), [sortedSubjectProblems, firstMissedIds, reviewLaterKeySet]);
    useEffect(() => {
        if (subjectNames.length === 0) {
            return;
        }
        setSelectedSubjectName((prev) => {
            if (prev && subjectNames.includes(prev)) {
                return prev;
            }
            return selectedItem?.subject && subjectNames.includes(selectedItem.subject)
                ? selectedItem.subject
                : subjectNames[0] || '';
        });
    }, [selectedItem?.subject, subjectNames]);
    useEffect(() => {
        if (selectedProblem) {
            setEditingProblem({ ...selectedProblem });
            setCustomExplanationText(selectedProblem.custom_explanation || '');
        }
        else {
            setEditingProblem(null);
            setCustomExplanationText('');
        }
        setIsOralVivaActive(false);
        setAiExplanationReview(null);
        setShowStructuredQuestionFields(false);
        setOralVivaStepIndex(0);
        setOralVivaMessages([]);
        setOralVivaInput('');
        setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
        setOralVivaResult(null);
        setIsOralVivaLoading(false);
    }, [selectedProblem]);
    useEffect(() => {
        const fetchSubjectProblems = async () => {
            if (!selectedSubjectName) {
                setSubjectProblems([]);
                setFirstMissedIds(new Set());
                setFirstMissedDateById({});
                return;
            }
            const cachedProblems = subjectProblemsCacheRef.current[selectedSubjectName];
            const cachedFirstMissed = firstMissedCacheRef.current[selectedSubjectName];
            if (cachedProblems && cachedFirstMissed) {
                setSubjectProblems(cachedProblems);
                setFirstMissedIds(new Set(cachedFirstMissed.ids));
                setFirstMissedDateById(cachedFirstMissed.dates);
                return;
            }
            setIsLoadingSubjectProblems(true);
            try {
                const [problemsResponse, firstMissedResponse] = await Promise.all([
                    fetch(`${API_BASE_URL}/subjects/${encodeURIComponent(selectedSubjectName)}/problems`),
                    fetch(`${API_BASE_URL}/analytics/export/first-missed-problems?subjects=${encodeURIComponent(selectedSubjectName)}`),
                ]);
                if (!problemsResponse.ok) {
                    const payload = await problemsResponse.json().catch(() => null);
                    throw new Error(payload?.detail || '科目問題一覧の取得に失敗しました。');
                }
                const problems = await problemsResponse.json();
                subjectProblemsCacheRef.current[selectedSubjectName] = problems;
                setSubjectProblems(problems);
                if (firstMissedResponse.ok) {
                    const payload = await firstMissedResponse.json();
                    const firstMissedQuestions = payload.questions || [];
                    const ids = firstMissedQuestions.map((question) => question.id);
                    const dates = Object.fromEntries(firstMissedQuestions
                        .filter((question) => question.first_missed_answered_at)
                        .map((question) => [question.id, question.first_missed_answered_at]));
                    firstMissedCacheRef.current[selectedSubjectName] = { ids, dates };
                    setFirstMissedIds(new Set(ids));
                    setFirstMissedDateById(dates);
                }
                else {
                    firstMissedCacheRef.current[selectedSubjectName] = { ids: [], dates: {} };
                    setFirstMissedIds(new Set());
                    setFirstMissedDateById({});
                }
            }
            catch (fetchError) {
                console.error(fetchError);
                setError(fetchError instanceof Error ? fetchError.message : '科目問題一覧の取得に失敗しました。');
                setSubjectProblems([]);
                setFirstMissedIds(new Set());
                setFirstMissedDateById({});
            }
            finally {
                setIsLoadingSubjectProblems(false);
            }
        };
        void fetchSubjectProblems();
    }, [selectedSubjectName]);
    const handleProblemChange = (event) => {
        if (!editingProblem)
            return;
        const { name, value } = event.target;
        if (name.startsWith('explanation.')) {
            const key = name.split('.')[1];
            setEditingProblem({
                ...editingProblem,
                explanation: {
                    ...editingProblem.explanation,
                    [key]: value,
                },
            });
            return;
        }
        setEditingProblem({ ...editingProblem, [name]: value });
    };
    const handleChoiceChange = (index, field, value) => {
        if (!editingProblem)
            return;
        const nextChoices = [...editingProblem.choices];
        const currentChoice = nextChoices[index];
        if (!currentChoice)
            return;
        nextChoices[index] = {
            label: field === 'label' ? value : currentChoice.label,
            text: field === 'text' ? value : currentChoice.text,
        };
        setEditingProblem({ ...editingProblem, choices: nextChoices });
    };
    const saveProblemData = async () => {
        if (!editingProblem)
            return;
        const { image_urls, explanation_image_urls, custom_explanation, custom_explanation_image_data_url, custom_question_image_data_url, custom_explanation_image_data_urls, custom_question_image_data_urls, ...payload } = editingProblem;
        const response = await fetch(`${API_BASE_URL}/subjects/${encodeURIComponent(editingProblem.subject)}/problems/${encodeURIComponent(editingProblem.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.detail || '問題の更新に失敗しました。');
        }
        const updatedProblem = await response.json();
        subjectProblemsCacheRef.current[updatedProblem.subject] = (subjectProblemsCacheRef.current[updatedProblem.subject] ?? []).map((problem) => (problem.id === updatedProblem.id ? { ...problem, ...updatedProblem } : problem));
        setItems((prev) => prev.map((item) => item.subject === updatedProblem.subject && item.problem_id === updatedProblem.id
            ? { ...item, question: { ...item.question, ...updatedProblem } }
            : item));
        setEditingProblem((prev) => (prev ? { ...prev, ...updatedProblem } : prev));
    };
    const saveMemoData = async () => {
        if (!editingProblem)
            return;
        const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: customExplanationText,
                explanation_image_data_urls: explanationSupplementImageUrls,
                question_image_data_urls: questionSupplementImageUrls,
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
        }
        subjectProblemsCacheRef.current[editingProblem.subject] = (subjectProblemsCacheRef.current[editingProblem.subject] ?? []).map((problem) => (problem.id === editingProblem.id
            ? {
                ...problem,
                custom_explanation: customExplanationText,
                custom_explanation_image_data_urls: explanationSupplementImageUrls,
                custom_question_image_data_urls: questionSupplementImageUrls,
                custom_explanation_image_data_url: explanationSupplementImageUrls[0],
                custom_question_image_data_url: questionSupplementImageUrls[0],
            }
            : problem));
        setItems((prev) => prev.map((item) => item.subject === editingProblem.subject && item.problem_id === editingProblem.id && item.question
            ? {
                ...item,
                question: {
                    ...item.question,
                    custom_explanation: customExplanationText,
                    custom_explanation_image_data_urls: explanationSupplementImageUrls,
                    custom_question_image_data_urls: questionSupplementImageUrls,
                    custom_explanation_image_data_url: explanationSupplementImageUrls[0],
                    custom_question_image_data_url: questionSupplementImageUrls[0],
                },
            }
            : item));
        setEditingProblem((prev) => prev
            ? {
                ...prev,
                custom_explanation: customExplanationText,
                custom_explanation_image_data_urls: explanationSupplementImageUrls,
                custom_question_image_data_urls: questionSupplementImageUrls,
                custom_explanation_image_data_url: explanationSupplementImageUrls[0],
                custom_question_image_data_url: questionSupplementImageUrls[0],
            }
            : prev);
    };
    const handleSaveAll = async () => {
        if (!editingProblem || isSavingProblem || isSavingMemo)
            return;
        setError('');
        setIsSavingProblem(true);
        setIsSavingMemo(true);
        try {
            await saveProblemData();
            await saveMemoData();
        }
        catch (saveError) {
            console.error(saveError);
            setError(saveError instanceof Error ? saveError.message : '保存に失敗しました。');
        }
        finally {
            setIsSavingProblem(false);
            setIsSavingMemo(false);
        }
    };
    const handleSaveProblem = async () => {
        await handleSaveAll();
    };
    const handleSaveMemo = async () => {
        await handleSaveAll();
    };
    const saveMemoText = async (text) => {
        if (!editingProblem)
            return;
        const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                explanation_image_data_urls: explanationSupplementImageUrls,
                question_image_data_urls: questionSupplementImageUrls,
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
        }
    };
    const reorganizeExplanationWithAi = async () => {
        if (!editingProblem || isReorganizingExplanation)
            return;
        try {
            setIsReorganizingExplanation(true);
            setAiExplanationReview(null);
            setError('');
            const response = await fetch(`${API_BASE_URL}/review-later/${encodeURIComponent(editingProblem.subject)}/${encodeURIComponent(editingProblem.id)}/reorganize-explanation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: editingProblem }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.detail || 'AI整理に失敗しました。');
            }
            const nextExplanation = (payload.reorganized_explanation || '').trim();
            if (!nextExplanation) {
                throw new Error('AI整理結果が空でした。');
            }
            setEditingProblem((prev) => prev ? {
                ...prev,
                explanation: {
                    ...prev.explanation,
                    text: nextExplanation,
                },
            } : prev);
            setAiExplanationReview({
                notes: Array.isArray(payload.consistency_notes) ? payload.consistency_notes : [],
                usedAi: Boolean(payload.used_ai),
            });
        }
        catch (organizeError) {
            console.error(organizeError);
            setError(organizeError instanceof Error ? organizeError.message : 'AI整理に失敗しました。');
        }
        finally {
            setIsReorganizingExplanation(false);
        }
    };
    const startOralViva = async () => {
        if (!editingProblem || isOralVivaLoading)
            return;
        setIsOralVivaLoading(true);
        setError('');
        setIsOralVivaActive(true);
        setOralVivaStepIndex(0);
        setOralVivaMessages([]);
        setOralVivaResult(null);
        try {
            const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    step: 'root',
                    question: {
                        problem_id: editingProblem.id,
                        question_text: editingProblem.question_text,
                        explanation_text: editingProblem.explanation.text || '',
                        correct_answer: editingProblem.answer,
                        selected_answer: null,
                        was_correct: null,
                    },
                    conversation: [],
                    user_message: '',
                }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.detail || '口頭試問の開始に失敗しました。');
            }
            const payload = await res.json();
            setOralVivaMessages([{ role: 'assistant', content: payload.assistant_message }]);
            setOralVivaScores(payload.scores);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '口頭試問の開始に失敗しました。');
            setIsOralVivaActive(false);
        }
        finally {
            setIsOralVivaLoading(false);
        }
    };
    const submitOralViva = async () => {
        if (!editingProblem || !isOralVivaActive || isOralVivaLoading)
            return;
        const message = oralVivaInput.trim();
        if (!message)
            return;
        const step = oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)];
        const userTurn = { role: 'user', content: message };
        setOralVivaInput('');
        setOralVivaMessages((prev) => [...prev, userTurn]);
        setIsOralVivaLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    step,
                    question: {
                        problem_id: editingProblem.id,
                        question_text: editingProblem.question_text,
                        explanation_text: editingProblem.explanation.text || '',
                        correct_answer: editingProblem.answer,
                        selected_answer: null,
                        was_correct: null,
                    },
                    conversation: [...oralVivaMessages, userTurn],
                    user_message: message,
                }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.detail || '口頭試問の送信に失敗しました。');
            }
            const payload = await res.json();
            setOralVivaMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
            setOralVivaScores(payload.scores);
            if (payload.is_final_step) {
                setOralVivaResult({
                    improvementPoints: payload.improvement_points ?? [],
                    miniQuizQuestion: payload.mini_quiz_question ?? '',
                    miniQuizAnswer: payload.mini_quiz_answer ?? '',
                });
                if (payload.memo_summary && payload.memo_summary.trim()) {
                    const appended = customExplanationText.trim()
                        ? `${customExplanationText.trim()}\n\n---\n\n【口頭試問まとめ】\n${payload.memo_summary.trim()}`
                        : `【口頭試問まとめ】\n${payload.memo_summary.trim()}`;
                    setCustomExplanationText(appended);
                    await saveMemoText(appended);
                }
            }
            else {
                setOralVivaStepIndex((prev) => Math.min(prev + 1, oralVivaSteps.length - 1));
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '口頭試問の送信に失敗しました。');
        }
        finally {
            setIsOralVivaLoading(false);
        }
    };
    const skipToSummary = async () => {
        if (!editingProblem || !isOralVivaActive || isOralVivaLoading)
            return;
        const userTurn = { role: 'user', content: 'ここまでの内容を要約して終了してください。' };
        setOralVivaStepIndex(oralVivaSteps.length - 1);
        setOralVivaMessages((prev) => [...prev, userTurn]);
        setIsOralVivaLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    step: 'summary',
                    question: {
                        problem_id: editingProblem.id,
                        question_text: editingProblem.question_text,
                        explanation_text: editingProblem.explanation.text || '',
                        correct_answer: editingProblem.answer,
                        selected_answer: null,
                        was_correct: null,
                    },
                    conversation: [...oralVivaMessages, userTurn],
                    user_message: userTurn.content,
                }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.detail || '要約生成に失敗しました。');
            }
            const payload = await res.json();
            setOralVivaMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
            setOralVivaScores(payload.scores);
            setOralVivaResult({
                improvementPoints: payload.improvement_points ?? [],
                miniQuizQuestion: payload.mini_quiz_question ?? '',
                miniQuizAnswer: payload.mini_quiz_answer ?? '',
            });
            if (payload.memo_summary && payload.memo_summary.trim()) {
                const appended = customExplanationText.trim()
                    ? `${customExplanationText.trim()}\n\n---\n\n【口頭試問まとめ】\n${payload.memo_summary.trim()}`
                    : `【口頭試問まとめ】\n${payload.memo_summary.trim()}`;
                setCustomExplanationText(appended);
                await saveMemoText(appended);
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '要約生成に失敗しました。');
        }
        finally {
            setIsOralVivaLoading(false);
        }
    };
    const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
                resolve(result);
                return;
            }
            reject(new Error('画像の読み込みに失敗しました。'));
        };
        reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
        reader.readAsDataURL(file);
    });
    const handleCustomImageUpload = async (kind, files) => {
        if (!editingProblem || !files || files.length === 0)
            return;
        try {
            const dataUrls = await Promise.all(Array.from(files).map((file) => readFileAsDataUrl(file)));
            if (kind === 'question') {
                setEditingProblem((prev) => {
                    if (!prev)
                        return prev;
                    const nextUrls = [...getCustomImageUrls(prev.custom_question_image_data_urls, prev.custom_question_image_data_url), ...dataUrls];
                    return {
                        ...prev,
                        custom_question_image_data_urls: nextUrls,
                        custom_question_image_data_url: nextUrls[0],
                    };
                });
            }
            else {
                setEditingProblem((prev) => {
                    if (!prev)
                        return prev;
                    const nextUrls = [...getCustomImageUrls(prev.custom_explanation_image_data_urls, prev.custom_explanation_image_data_url), ...dataUrls];
                    return {
                        ...prev,
                        custom_explanation_image_data_urls: nextUrls,
                        custom_explanation_image_data_url: nextUrls[0],
                    };
                });
            }
        }
        catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : '画像の読み込みに失敗しました。');
        }
    };
    const handleRemove = async (targetItem) => {
        const itemToRemove = targetItem ?? selectedItem;
        if (!itemToRemove)
            return;
        try {
            setIsRegisteringHistory(true);
            const response = await fetch(`${API_BASE_URL}/review-later/${encodeURIComponent(itemToRemove.subject)}/${encodeURIComponent(itemToRemove.problem_id)}/register-history`, { method: 'POST' });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '登録解除に失敗しました。');
            }
            removeReviewLaterEntryLocally(itemToRemove.subject, itemToRemove.problem_id);
        }
        catch (removeError) {
            console.error(removeError);
            setError(removeError instanceof Error ? removeError.message : '登録解除に失敗しました。');
        }
        finally {
            setIsRegisteringHistory(false);
        }
    };
    const handleToggleReviewLater = async (problem, enabled) => {
        try {
            setError('');
            const response = await fetch(enabled
                ? `${API_BASE_URL}/review-later`
                : `${API_BASE_URL}/review-later/${encodeURIComponent(problem.id)}?subject=${encodeURIComponent(problem.subject)}`, enabled
                ? {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subject: problem.subject, problem_id: problem.id }),
                }
                : { method: 'DELETE' });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '後で確認の更新に失敗しました。');
            }
            if (enabled) {
                const now = new Date().toISOString();
                setItems((prev) => {
                    const itemKey = `${problem.subject}::${problem.id}`;
                    if (prev.some((item) => `${item.subject}::${item.problem_id}` === itemKey)) {
                        return prev;
                    }
                    return [
                        {
                            subject: problem.subject,
                            problem_id: problem.id,
                            created_at: now,
                            updated_at: now,
                            question: problem,
                            error: null,
                        },
                        ...prev,
                    ];
                });
            }
            else {
                removeReviewLaterEntryLocally(problem.subject, problem.id);
            }
        }
        catch (toggleError) {
            console.error(toggleError);
            setError(toggleError instanceof Error ? toggleError.message : '後で確認の更新に失敗しました。');
        }
    };
    const handleBulkRegisterFirstMissed = async () => {
        if (unregisteredFirstMissedProblems.length === 0 || isBulkRegisteringFirstMissed)
            return;
        try {
            setIsBulkRegisteringFirstMissed(true);
            setError('');
            const responses = await Promise.all(unregisteredFirstMissedProblems.map((problem) => fetch(`${API_BASE_URL}/review-later`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject: problem.subject, problem_id: problem.id }),
            })));
            const failed = responses.find((response) => !response.ok);
            if (failed) {
                const payload = await failed.json().catch(() => null);
                throw new Error(payload?.detail || '初回不正解問題の一括登録に失敗しました。');
            }
            await fetchItems();
        }
        catch (bulkError) {
            console.error(bulkError);
            setError(bulkError instanceof Error ? bulkError.message : '初回不正解問題の一括登録に失敗しました。');
        }
        finally {
            setIsBulkRegisteringFirstMissed(false);
        }
    };
    const openIpadReview = (profile) => {
        if (!selectedItem)
            return;
        const deepLink = `quizapp://quiz-review?base=${encodeURIComponent(window.location.origin)}` +
            `&subject=${encodeURIComponent(selectedItem.subject)}` +
            `&problem=${encodeURIComponent(selectedItem.problem_id)}` +
            `&profile=${encodeURIComponent(profile)}`;
        window.location.href = deepLink;
    };
    const handleStartSimilarPractice = async () => {
        if (!selectedItem || !selectedItem.question)
            return;
        setIsFindingSimilar(true);
        setError('');
        setSimilarTopics([]);
        try {
            const response = await fetch(`${API_BASE_URL}/review-later/${encodeURIComponent(selectedItem.subject)}/${encodeURIComponent(selectedItem.problem_id)}/similar?count=5`);
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '類題の取得に失敗しました。');
            }
            const payload = await response.json();
            const quizSet = Array.isArray(payload.quiz_set) ? payload.quiz_set : [];
            const topics = Array.isArray(payload.topic_keywords) ? payload.topic_keywords : [];
            setSimilarTopics(topics);
            if (quizSet.length === 0) {
                setError('類題が見つかりませんでした。');
                return;
            }
            sessionStorage.setItem('adhocQuizSet', JSON.stringify(quizSet));
            sessionStorage.setItem('adhocQuizLabel', `類題演習: ${selectedItem.problem_id}`);
            sessionStorage.setItem(ADHOC_QUIZ_HISTORY_MODE_STORAGE_KEY, SIMILAR_PRACTICE_HISTORY_MODE);
            navigate('/?adhoc=1');
        }
        catch (similarError) {
            setError(similarError instanceof Error ? similarError.message : '類題の取得に失敗しました。');
        }
        finally {
            setIsFindingSimilar(false);
        }
    };
    const exportReviewLaterPdf = async () => {
        const exportItems = items.filter((item) => Boolean(item.question));
        if (exportItems.length === 0 || isExportingPdf) {
            return;
        }
        setIsExportingPdf(true);
        setPdfExportProgress('PDFを準備しています...');
        setError('');
        try {
            const { jsPDF } = await import('jspdf');
            const fontBinary = await loadPdfFontBinaryString();
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4',
                compress: true,
            });
            pdf.addFileToVFS(PDF_FONT_FILE_NAME, fontBinary);
            pdf.addFont(PDF_FONT_FILE_NAME, PDF_FONT_NAME, 'normal');
            pdf.setFont(PDF_FONT_NAME, 'normal');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const marginX = 12;
            const marginTop = 12;
            const marginBottom = 12;
            const contentWidth = pageWidth - marginX * 2;
            const maxY = pageHeight - marginBottom;
            const drawSection = (title, body, cursorY) => {
                const normalizedBody = normalizePdfText(body);
                if (!normalizedBody) {
                    return { cursorY, truncated: false };
                }
                pdf.setFontSize(10);
                pdf.text(title, marginX, cursorY);
                cursorY += 5;
                pdf.setFontSize(9);
                const lines = pdf.splitTextToSize(normalizedBody, contentWidth);
                const remainingHeight = maxY - cursorY;
                const maxLines = Math.max(1, Math.floor(remainingHeight / 4.4));
                let truncated = false;
                let printableLines = lines;
                if (printableLines.length > maxLines) {
                    truncated = true;
                    printableLines = printableLines.slice(0, maxLines);
                    const lastLine = printableLines[printableLines.length - 1] || '';
                    printableLines[printableLines.length - 1] = lastLine.length > 2 ? `${lastLine.slice(0, Math.max(0, lastLine.length - 2))}…` : '…';
                }
                pdf.text(printableLines, marginX, cursorY);
                cursorY += printableLines.length * 4.4 + 3;
                return { cursorY, truncated };
            };
            exportItems.forEach((item, index) => {
                if (index > 0) {
                    pdf.addPage('a4', 'portrait');
                    pdf.setFont(PDF_FONT_NAME, 'normal');
                }
                setPdfExportProgress(`PDFを生成中... ${index + 1} / ${exportItems.length}`);
                const question = item.question;
                let cursorY = marginTop;
                let truncatedAny = false;
                pdf.setFontSize(12);
                pdf.text(`${question.subject} / ${question.id}`, marginX, cursorY);
                cursorY += 6;
                const metaParts = [
                    question.category ? `カテゴリ: ${question.category}` : null,
                    question.first_missed_answered_at ? `初回不正解: ${question.first_missed_answered_at.slice(0, 10)}` : null,
                    `登録日: ${item.created_at.slice(0, 10)}`,
                ].filter((part) => Boolean(part));
                pdf.setFontSize(9);
                pdf.text(metaParts.join(' / '), marginX, cursorY);
                cursorY += 7;
                const sections = [
                    { title: '問題文', body: question.question_text },
                    { title: '選択肢', body: question.choices.map((choice) => `${choice.label}. ${choice.text}`).join('\n') },
                    { title: '正解', body: question.answer },
                    { title: '解説', body: question.explanation?.text || '' },
                    { title: 'My Memo', body: question.custom_explanation || '' },
                ];
                sections.forEach((section) => {
                    if (cursorY >= maxY - 4) {
                        truncatedAny = true;
                        return;
                    }
                    const result = drawSection(section.title, section.body, cursorY);
                    cursorY = result.cursorY;
                    truncatedAny = truncatedAny || result.truncated;
                });
                if (truncatedAny) {
                    pdf.setFontSize(8);
                    pdf.text('※ 1問1ページに収めるため、一部を省略しています。', marginX, maxY);
                }
            });
            pdf.save(`review-later-${new Date().toISOString().slice(0, 10)}.pdf`);
            setPdfExportProgress('');
        }
        catch (exportError) {
            console.error(exportError);
            setError(exportError instanceof Error ? exportError.message : '後で確認PDFの生成に失敗しました。');
        }
        finally {
            setIsExportingPdf(false);
            setPdfExportProgress('');
        }
    };
    return (_jsxs("div", { className: "mx-auto w-full max-w-[3200px] space-y-6 px-4 sm:px-6", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-3xl font-bold text-dark", children: "\u5F8C\u3067\u78BA\u8A8D" }), _jsx("p", { className: "text-sm text-gray-500 mt-1", children: "\u73FE\u5728\u3082\u767B\u9332\u72B6\u614B\u306E\u554F\u984C\u3092\u3059\u3079\u3066\u8868\u793A\u3057\u307E\u3059\u3002\u767B\u9332\u89E3\u9664\u6642\u306B\u3001\u5B9F\u7E3E\u30922\u4EF6\u8A08\u4E0A\u3059\u308B\u304B\u3001\u672A\u8A08\u4E0A\u306E\u307E\u307E\u89E3\u9664\u3059\u308B\u304B\u3092\u9078\u3079\u307E\u3059\u3002" }), _jsxs("p", { className: "mt-2 text-sm font-semibold text-amber-800", children: ["\u767B\u9332\u4E2D ", items.length, "\u4EF6"] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => { void exportReviewLaterPdf(); }, disabled: isExportingPdf || items.every((item) => !item.question), className: "px-4 py-2 bg-slate-900 text-white rounded-lg shadow-sm hover:bg-slate-800 disabled:bg-gray-300 disabled:cursor-not-allowed", children: isExportingPdf ? 'PDF生成中...' : '一覧をPDF出力' }), _jsx(Link, { to: "/dashboard", className: "px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg shadow-sm hover:bg-gray-50", children: "\u5206\u6790\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u3078\u623B\u308B" })] })] }), error && _jsx("div", { className: "rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700", children: error }), pdfExportProgress ? (_jsx("div", { className: "rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800", children: pdfExportProgress })) : null, isLoading ? (_jsx(LoadingSpinner, {})) : items.length === 0 ? (_jsx("div", { className: "bg-white rounded-xl shadow p-8 text-sm text-gray-500", children: "\u767B\u9332\u3055\u308C\u305F\u554F\u984C\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("div", { className: "grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-4 space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-gray-100 pb-3", children: [_jsx("div", { className: "text-sm font-semibold text-gray-800", children: "\u4E00\u89A7" }), _jsxs("div", { className: "rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800", children: [items.length, "\u4EF6"] })] }), items.map((item) => {
                                const itemKey = `${item.subject}::${item.problem_id}`;
                                const active = itemKey === selectedKey;
                                return (_jsx("div", { className: `rounded-lg border px-4 py-3 transition-colors ${active ? 'border-primary-new bg-blue-50' : 'border-gray-200 bg-white'}`, children: _jsxs("button", { type: "button", onClick: () => setSelectedKey(itemKey), className: "w-full text-left", children: [_jsx("div", { className: "text-xs text-gray-500 truncate", children: item.subject }), _jsx("div", { className: "mt-1 whitespace-pre-wrap text-sm font-semibold text-gray-800 line-clamp-2", children: item.question?.question_text || item.error || '問題を読み込めませんでした。' }), _jsxs("div", { className: "mt-2 text-[11px] text-gray-400", children: ["\u66F4\u65B0: ", new Date(item.updated_at).toLocaleString()] })] }) }, itemKey));
                            })] }), _jsx("div", { className: "bg-white rounded-xl shadow p-6", children: !editingProblem ? (_jsx("div", { className: "text-sm text-gray-500", children: "\u8868\u793A\u3067\u304D\u308B\u554F\u984C\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-500", children: editingProblem.subject }), _jsxs("div", { className: "text-sm text-gray-500", children: ["\u554F\u984CID: ", editingProblem.id] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => void handleStartSimilarPractice(), disabled: isFindingSimilar || isRegisteringHistory || !selectedItem, className: "px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-gray-300", children: isFindingSimilar ? '類題検索中...' : '類題出題' }), _jsx("button", { type: "button", onClick: () => openIpadReview('air'), disabled: isRegisteringHistory, className: "px-4 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700", children: "iPad Air\u3067\u958B\u304F" }), _jsx("button", { type: "button", onClick: () => openIpadReview('mini'), disabled: isRegisteringHistory, className: "px-4 py-2 rounded-md bg-sky-600 text-white text-sm font-medium hover:bg-sky-700", children: "iPad mini\u3067\u958B\u304F" }), selectedItem && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => void handleRemove(), disabled: isRegisteringHistory, className: "px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200", children: isRegisteringHistory ? '解除中...' : '登録解除(実績2件)' }), _jsx("button", { type: "button", onClick: async () => {
                                                                if (!selectedItem)
                                                                    return;
                                                                try {
                                                                    const response = await fetch(`${API_BASE_URL}/review-later/${encodeURIComponent(selectedItem.problem_id)}?subject=${encodeURIComponent(selectedItem.subject)}`, { method: 'DELETE' });
                                                                    if (!response.ok) {
                                                                        const payload = await response.json().catch(() => null);
                                                                        throw new Error(payload?.detail || '登録解除に失敗しました。');
                                                                    }
                                                                    removeReviewLaterEntryLocally(selectedItem.subject, selectedItem.problem_id);
                                                                }
                                                                catch (removeError) {
                                                                    console.error(removeError);
                                                                    setError(removeError instanceof Error ? removeError.message : '登録解除に失敗しました。');
                                                                }
                                                            }, disabled: isRegisteringHistory, className: "px-4 py-2 rounded-md bg-white border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50", children: "\u767B\u9332\u89E3\u9664(\u5B9F\u7E3E\u672A\u8A08\u4E0A)" })] }))] })] }), similarTopics.length > 0 && (_jsxs("div", { className: "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900", children: ["AI\u62BD\u51FA\u30C8\u30D4\u30C3\u30AF: ", similarTopics.join(', ')] })), (isFindingSimilar || isReorganizingExplanation) && (_jsxs("div", { className: "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-3 text-xs font-semibold text-emerald-900", children: [_jsx("span", { children: "AI\u51E6\u7406\u4E2D" }), _jsx("span", { children: isFindingSimilar ? '類題候補を抽出中' : '整合性を確認・整理中' })] }), _jsx("div", { className: "mt-2 h-2 overflow-hidden rounded-full bg-emerald-100", children: _jsx("div", { className: "h-full w-2/3 animate-pulse rounded-full bg-emerald-500" }) })] })), _jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-800", children: "\u554F\u984C\u30C7\u30FC\u30BF" }), _jsx("button", { type: "button", onClick: () => setShowStructuredQuestionFields((prev) => !prev), className: `rounded-md border px-3 py-1.5 text-xs font-semibold ${showStructuredQuestionFields
                                                        ? 'border-slate-700 bg-slate-800 text-white'
                                                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`, children: "md / Mermaid" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u554F\u984C\u6587" }), _jsx("textarea", { name: "question_text", value: editingProblem.question_text, onChange: handleProblemChange, rows: 13, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), showStructuredQuestionFields && (_jsxs("div", { className: "grid grid-cols-1 gap-4 xl:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u554F\u984C\u6587 md" }), _jsx("textarea", { name: "question_text_md", value: editingProblem.question_text_md || '', onChange: handleProblemChange, rows: 12, className: "w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u554F\u984C\u6587 Mermaid" }), _jsx("textarea", { name: "question_text_mermaid", value: editingProblem.question_text_mermaid || '', onChange: handleProblemChange, rows: 12, className: "w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm" })] })] })), _jsx("div", { className: "space-y-3", children: editingProblem.choices.map((choice, index) => (_jsxs("div", { className: "grid grid-cols-1 gap-2 md:grid-cols-[100px_minmax(0,1fr)]", children: [_jsx("input", { value: choice.label, onChange: (event) => handleChoiceChange(index, 'label', event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" }), _jsx("input", { value: choice.text, onChange: (event) => handleChoiceChange(index, 'text', event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" })] }, `${choice.label}-${index}`))) }), _jsxs("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u6B63\u89E3" }), _jsx("input", { name: "answer", value: editingProblem.answer, onChange: handleProblemChange, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700 mb-1", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsx("input", { name: "category", value: editingProblem.category || '', onChange: handleProblemChange, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] })] }), _jsxs("div", { children: [_jsxs("div", { className: "mb-1 flex flex-wrap items-center justify-between gap-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u89E3\u8AAC" }), _jsx("button", { type: "button", onClick: () => void reorganizeExplanationWithAi(), disabled: isReorganizingExplanation || isSavingProblem || isSavingMemo, className: "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:bg-gray-100 disabled:text-gray-400", children: isReorganizingExplanation ? 'AI整理中...' : 'AIで整合性確認・整理' })] }), _jsx("textarea", { name: "explanation.text", value: editingProblem.explanation.text, onChange: handleProblemChange, rows: 15, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" }), aiExplanationReview && (_jsxs("div", { className: "mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900", children: [_jsx("div", { className: "font-semibold", children: aiExplanationReview.usedAi ? 'AI整理結果' : 'ローカル整形結果' }), aiExplanationReview.notes.length > 0 ? (_jsx("ul", { className: "mt-1 list-disc space-y-1 pl-4", children: aiExplanationReview.notes.map((note, index) => (_jsx("li", { children: note }, `${note}-${index}`))) })) : (_jsx("p", { className: "mt-1", children: "\u6574\u5408\u6027\u30E1\u30E2\u306F\u3042\u308A\u307E\u305B\u3093\u3002" }))] }))] }), _jsx("button", { type: "button", onClick: () => void handleSaveProblem(), disabled: isSavingProblem || isSavingMemo, className: "px-5 py-2 rounded-md bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:bg-gray-300", children: isSavingProblem || isSavingMemo ? '保存中...' : '問題データを保存' })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-800", children: "My Memo" }), _jsx("textarea", { value: customExplanationText, onChange: (event) => setCustomExplanationText(event.target.value), rows: 5, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" }), _jsxs("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u554F\u984C\u6587\u88DC\u8DB3\u753B\u50CF\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9" }), _jsx("input", { type: "file", accept: "image/*", multiple: true, onChange: (event) => void handleCustomImageUpload('question', event.target.files), className: "block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" }), questionSupplementImageUrls.length > 0 && (_jsx("div", { className: "space-y-2", children: questionSupplementImageUrls.map((url, index) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { type: "button", onClick: () => setEditingProblem((prev) => {
                                                                            if (!prev)
                                                                                return prev;
                                                                            const nextUrls = getCustomImageUrls(prev.custom_question_image_data_urls, prev.custom_question_image_data_url)
                                                                                .filter((_, currentIndex) => currentIndex !== index);
                                                                            return {
                                                                                ...prev,
                                                                                custom_question_image_data_urls: nextUrls,
                                                                                custom_question_image_data_url: nextUrls[0],
                                                                            };
                                                                        }), className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50", children: ["\u554F\u984C\u6587\u88DC\u8DB3\u753B\u50CF", index + 1, "\u3092\u524A\u9664"] }), _jsxs("span", { className: "text-xs text-gray-500", children: ["\u753B\u50CF ", index + 1] })] }, `question-supplement-${index}`))) }))] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9" }), _jsx("input", { type: "file", accept: "image/*", multiple: true, onChange: (event) => void handleCustomImageUpload('explanation', event.target.files), className: "block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" }), explanationSupplementImageUrls.length > 0 && (_jsx("div", { className: "space-y-2", children: explanationSupplementImageUrls.map((url, index) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("button", { type: "button", onClick: () => setEditingProblem((prev) => {
                                                                            if (!prev)
                                                                                return prev;
                                                                            const nextUrls = getCustomImageUrls(prev.custom_explanation_image_data_urls, prev.custom_explanation_image_data_url)
                                                                                .filter((_, currentIndex) => currentIndex !== index);
                                                                            return {
                                                                                ...prev,
                                                                                custom_explanation_image_data_urls: nextUrls,
                                                                                custom_explanation_image_data_url: nextUrls[0],
                                                                            };
                                                                        }), className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50", children: ["\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF", index + 1, "\u3092\u524A\u9664"] }), _jsxs("span", { className: "text-xs text-gray-500", children: ["\u753B\u50CF ", index + 1] })] }, `explanation-supplement-${index}`))) }))] })] }), _jsx("button", { type: "button", onClick: () => void handleSaveMemo(), disabled: isSavingProblem || isSavingMemo, className: "px-5 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300", children: isSavingProblem || isSavingMemo ? '保存中...' : 'My Memoを保存' }), _jsxs("div", { className: "rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("h4", { className: "text-sm font-semibold text-sky-900", children: "\u53E3\u982D\u8A66\u554F\u30E2\u30FC\u30C9" }), !isOralVivaActive ? (_jsx("button", { type: "button", onClick: () => void startOralViva(), disabled: isOralVivaLoading, className: "px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300", children: isOralVivaLoading ? '開始中...' : '口頭試問を開始' })) : (_jsxs("div", { className: "text-right", children: [_jsxs("p", { className: "text-xs font-semibold text-sky-900", children: ["\u30B9\u30C6\u30C3\u30D7: ", oralVivaStepLabels[oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)]], " (", Math.min(oralVivaStepIndex + 1, oralVivaSteps.length), "/", oralVivaSteps.length, ")"] }), _jsx("p", { className: "text-[11px] text-sky-700", children: "\u7D42\u4E86\u6761\u4EF6: 4\u30B9\u30C6\u30C3\u30D7\u5B8C\u4E86 or \u8981\u7D04\u3078\u30B9\u30AD\u30C3\u30D7" })] }))] }), isOralVivaActive && (_jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-2", children: [
                                                                ['論理性', oralVivaScores.logicality],
                                                                ['具体性', oralVivaScores.specificity],
                                                                ['再現性', oralVivaScores.reproducibility],
                                                            ].map(([label, value]) => (_jsxs("div", { className: "rounded-md border border-sky-200 bg-white px-2 py-2", children: [_jsxs("div", { className: "flex justify-between text-xs text-sky-900 mb-1", children: [_jsx("span", { children: label }), _jsx("span", { children: value })] }), _jsx("div", { className: "h-2 rounded bg-sky-100 overflow-hidden", children: _jsx("div", { className: "h-full bg-sky-500", style: { width: `${Math.max(0, Math.min(100, value))}%` } }) })] }, label))) }), _jsx("div", { className: "max-h-64 overflow-y-auto rounded-md border border-sky-200 bg-white p-2 space-y-2", children: oralVivaMessages.map((msg, idx) => (_jsxs("div", { className: `rounded-md px-2 py-1 text-sm ${msg.role === 'assistant' ? 'bg-sky-100 text-sky-900' : 'bg-gray-100 text-gray-800'}`, children: [_jsx("p", { className: "text-[11px] font-semibold", children: msg.role === 'assistant' ? 'AI面接官' : 'あなた' }), _jsx("p", { className: "whitespace-pre-wrap", children: msg.content })] }, `${msg.role}-${idx}`))) }), !oralVivaResult && (_jsxs("div", { className: "space-y-2", children: [_jsx("textarea", { value: oralVivaInput, onChange: (event) => setOralVivaInput(event.target.value), rows: 3, className: "w-full rounded-md border border-sky-300 px-3 py-2 text-sm bg-white", placeholder: "\u56DE\u7B54\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => void submitOralViva(), disabled: isOralVivaLoading || !oralVivaInput.trim(), className: "px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300", children: isOralVivaLoading ? '送信中...' : '送信' }), _jsx("button", { type: "button", onClick: () => void skipToSummary(), disabled: isOralVivaLoading, className: "px-3 py-1.5 rounded-md border border-sky-300 bg-white text-sky-900 text-xs font-medium hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400", children: "\u8981\u7D04\u3078\u30B9\u30AD\u30C3\u30D7" }), _jsx("button", { type: "button", onClick: () => setIsOralVivaActive(false), disabled: isOralVivaLoading, className: "px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400", children: "\u53E3\u982D\u8A66\u554F\u3092\u9589\u3058\u308B" })] })] })), oralVivaResult && (_jsxs("div", { className: "rounded-md border border-sky-200 bg-white p-3 space-y-2", children: [_jsx("h5", { className: "text-sm font-semibold text-sky-900", children: "\u6700\u7D42\u30D5\u30A3\u30FC\u30C9\u30D0\u30C3\u30AF" }), _jsx("ul", { className: "list-disc pl-5 text-sm text-gray-700 space-y-1", children: oralVivaResult.improvementPoints.map((point, idx) => (_jsx("li", { children: point }, `${point}-${idx}`))) }), oralVivaResult.miniQuizQuestion && (_jsxs("p", { className: "text-sm text-gray-800 whitespace-pre-wrap", children: ["\u6B21\u56DE\u78BA\u8A8D\u30DF\u30CB\u554F\u984C: ", oralVivaResult.miniQuizQuestion] })), oralVivaResult.miniQuizAnswer && (_jsxs("p", { className: "text-sm text-gray-700 whitespace-pre-wrap", children: ["\u60F3\u5B9A\u89E3\u7B54: ", oralVivaResult.miniQuizAnswer] })), _jsx("p", { className: "text-xs text-gray-500", children: "\u6700\u7D42\u8981\u7D04\u306F My Memo \u306B\u81EA\u52D5\u8FFD\u8A18\u30FB\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002" })] }))] }))] }), questionSupplementImageUrls.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-gray-700 mb-2", children: "\u554F\u984C\u6587\u88DC\u8DB3\u753B\u50CF" }), _jsx("div", { className: "space-y-3", children: questionSupplementImageUrls.map((url, index) => (_jsx("img", { src: url, alt: `Question supplement ${index + 1}`, className: "max-h-56 rounded-lg border border-gray-200 bg-gray-50" }, `question-preview-${index}`))) })] })), explanationSupplementImageUrls.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-gray-700 mb-2", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF" }), _jsx("div", { className: "space-y-3", children: explanationSupplementImageUrls.map((url, index) => (_jsx("img", { src: url, alt: `Explanation supplement ${index + 1}`, className: "max-h-56 rounded-lg border border-gray-200 bg-gray-50" }, `explanation-preview-${index}`))) })] }))] })] })) })] })), _jsxs("div", { className: "bg-white rounded-xl shadow p-6 space-y-4", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-end md:justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "heading-2 text-xl font-semibold text-gray-800", children: "\u79D1\u76EE\u5225\u306E\u554F\u984C\u4E00\u89A7" }), _jsx("p", { className: "text-sm text-gray-500 mt-1", children: "\u3053\u3053\u3067\u306E\u5F8C\u3067\u78BA\u8A8D\u306E\u767B\u9332\u5207\u308A\u66FF\u3048\u306F\u3001\u5B9F\u7E3E\u3092\u8A18\u9332\u3057\u307E\u305B\u3093\u3002" })] }), _jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end", children: [_jsxs("label", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "heading-2 block mb-1", children: "\u79D1\u76EE" }), _jsx("select", { value: selectedSubjectName, onChange: (event) => setSelectedSubjectName(event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm", children: subjectNames.map((subjectName) => (_jsx("option", { value: subjectName, children: subjectName }, subjectName))) })] }), _jsxs("label", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "heading-2 block mb-1", children: "\u4E26\u3073\u9806" }), _jsxs("select", { value: sortMode, onChange: (event) => setSortMode(event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm", children: [_jsx("option", { value: "default", children: "\u554F\u984CID\u9806" }), _jsx("option", { value: "first_missed", children: "\u521D\u56DE\u4E0D\u6B63\u89E3\u3092\u4E0A\u4F4D" })] })] }), _jsxs("label", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "block mb-1", children: "\u4E0D\u6B63\u89E3\u65E5 From" }), _jsx("input", { type: "date", value: firstMissedDateFrom, onChange: (event) => setFirstMissedDateFrom(event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("label", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "block mb-1", children: "\u4E0D\u6B63\u89E3\u65E5 To" }), _jsx("input", { type: "date", value: firstMissedDateTo, onChange: (event) => setFirstMissedDateTo(event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("button", { type: "button", onClick: () => void handleBulkRegisterFirstMissed(), disabled: isBulkRegisteringFirstMissed || unregisteredFirstMissedProblems.length === 0, className: "rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:bg-gray-300", children: isBulkRegisteringFirstMissed
                                            ? '一括登録中...'
                                            : `表示中を一括で後で確認に登録${unregisteredFirstMissedProblems.length > 0 ? ` (${unregisteredFirstMissedProblems.length})` : ''}` })] })] }), isLoadingSubjectProblems ? (_jsx(LoadingSpinner, {})) : selectedSubjectName === '' ? (_jsx("div", { className: "text-sm text-gray-500", children: "\u79D1\u76EE\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b text-left text-gray-500", children: [_jsx("th", { className: "px-3 py-2", children: "\u554F\u984CID" }), _jsx("th", { className: "px-3 py-2", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsx("th", { className: "px-3 py-2", children: "\u554F\u984C\u6587" }), _jsx("th", { className: "px-3 py-2", children: "\u521D\u56DE\u4E0D\u6B63\u89E3" }), _jsx("th", { className: "px-3 py-2", children: "\u521D\u56DE\u4E0D\u6B63\u89E3\u65E5" }), _jsx("th", { className: "px-3 py-2", children: "\u5F8C\u3067\u78BA\u8A8D" })] }) }), _jsx("tbody", { children: sortedSubjectProblems.map((problem) => {
                                        const key = `${problem.subject}::${problem.id}`;
                                        const isReviewLater = reviewLaterKeySet.has(key);
                                        const firstMissedDate = firstMissedDateById[problem.id];
                                        return (_jsxs("tr", { className: "border-b align-top", children: [_jsx("td", { className: "px-3 py-2 font-medium text-gray-800", children: problem.id }), _jsx("td", { className: "px-3 py-2 text-gray-600", children: problem.category || '-' }), _jsx("td", { className: "px-3 py-2 text-gray-700", children: _jsx("button", { type: "button", onClick: () => setSelectedKey(key), className: "whitespace-pre-wrap text-left hover:text-primary-new", children: problem.question_text }) }), _jsx("td", { className: "px-3 py-2", children: firstMissedIds.has(problem.id) ? (_jsx("span", { className: "rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800", children: "\u5BFE\u8C61" })) : (_jsx("span", { className: "text-gray-400", children: "-" })) }), _jsx("td", { className: "px-3 py-2 text-gray-600", children: firstMissedDate ? firstMissedDate.slice(0, 10) : '-' }), _jsx("td", { className: "px-3 py-2", children: _jsx("button", { type: "button", onClick: () => void handleToggleReviewLater(problem, !isReviewLater), className: `rounded-md px-3 py-1.5 text-xs font-medium ${isReviewLater
                                                            ? 'bg-primary-new text-white hover:bg-blue-700'
                                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: isReviewLater ? '登録中' : '未登録' }) })] }, key));
                                    }) })] }) }))] })] }));
}
//# sourceMappingURL=ReviewLaterPage.js.map