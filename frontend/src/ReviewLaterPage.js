import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
const API_BASE_URL = '/api';
export default function ReviewLaterPage() {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [selectedKey, setSelectedKey] = useState('');
    const [editingProblem, setEditingProblem] = useState(null);
    const [customExplanationText, setCustomExplanationText] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSavingProblem, setIsSavingProblem] = useState(false);
    const [isSavingMemo, setIsSavingMemo] = useState(false);
    const [isRegisteringHistory, setIsRegisteringHistory] = useState('');
    const [isFindingSimilar, setIsFindingSimilar] = useState(false);
    const [similarTopics, setSimilarTopics] = useState([]);
    const [isOralVivaActive, setIsOralVivaActive] = useState(false);
    const [oralVivaStepIndex, setOralVivaStepIndex] = useState(0);
    const [oralVivaMessages, setOralVivaMessages] = useState([]);
    const [oralVivaInput, setOralVivaInput] = useState('');
    const [oralVivaScores, setOralVivaScores] = useState({ logicality: 0, specificity: 0, reproducibility: 0 });
    const [oralVivaResult, setOralVivaResult] = useState(null);
    const [isOralVivaLoading, setIsOralVivaLoading] = useState(false);
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
    const selectedItem = useMemo(() => items.find((item) => `${item.subject}::${item.problem_id}` === selectedKey) ?? null, [items, selectedKey]);
    useEffect(() => {
        if (selectedItem?.question) {
            setEditingProblem({ ...selectedItem.question });
            setCustomExplanationText(selectedItem.question.custom_explanation || '');
        }
        else {
            setEditingProblem(null);
            setCustomExplanationText('');
        }
        setIsOralVivaActive(false);
        setOralVivaStepIndex(0);
        setOralVivaMessages([]);
        setOralVivaInput('');
        setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
        setOralVivaResult(null);
        setIsOralVivaLoading(false);
    }, [selectedItem]);
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
    const handleSaveProblem = async () => {
        if (!editingProblem)
            return;
        try {
            setIsSavingProblem(true);
            const { image_urls, explanation_image_urls, custom_explanation, custom_explanation_image_data_url, custom_question_image_data_url, ...payload } = editingProblem;
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
            setItems((prev) => prev.map((item) => item.subject === updatedProblem.subject && item.problem_id === updatedProblem.id
                ? { ...item, question: { ...item.question, ...updatedProblem } }
                : item));
            setEditingProblem((prev) => (prev ? { ...prev, ...updatedProblem } : prev));
        }
        catch (saveError) {
            console.error(saveError);
            setError(saveError instanceof Error ? saveError.message : '問題の更新に失敗しました。');
        }
        finally {
            setIsSavingProblem(false);
        }
    };
    const handleSaveMemo = async () => {
        if (!editingProblem)
            return;
        try {
            setIsSavingMemo(true);
            const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: customExplanationText,
                    explanation_image_data_url: editingProblem.custom_explanation_image_data_url ?? null,
                    question_image_data_url: editingProblem.custom_question_image_data_url ?? null,
                }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
            }
            setItems((prev) => prev.map((item) => item.subject === editingProblem.subject && item.problem_id === editingProblem.id && item.question
                ? {
                    ...item,
                    question: {
                        ...item.question,
                        custom_explanation: customExplanationText,
                        custom_explanation_image_data_url: editingProblem.custom_explanation_image_data_url,
                        custom_question_image_data_url: editingProblem.custom_question_image_data_url,
                    },
                }
                : item));
            setEditingProblem((prev) => prev
                ? {
                    ...prev,
                    custom_explanation: customExplanationText,
                    custom_explanation_image_data_url: prev.custom_explanation_image_data_url,
                    custom_question_image_data_url: prev.custom_question_image_data_url,
                }
                : prev);
        }
        catch (saveError) {
            console.error(saveError);
            setError(saveError instanceof Error ? saveError.message : 'My Memo の保存に失敗しました。');
        }
        finally {
            setIsSavingMemo(false);
        }
    };
    const saveMemoText = async (text) => {
        if (!editingProblem)
            return;
        const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                explanation_image_data_url: editingProblem.custom_explanation_image_data_url ?? null,
                question_image_data_url: editingProblem.custom_question_image_data_url ?? null,
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
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
    const handleCustomImageUpload = async (kind, file) => {
        if (!editingProblem || !file)
            return;
        try {
            const dataUrl = await readFileAsDataUrl(file);
            if (kind === 'question') {
                setEditingProblem((prev) => (prev ? { ...prev, custom_question_image_data_url: dataUrl } : prev));
            }
            else {
                setEditingProblem((prev) => (prev ? { ...prev, custom_explanation_image_data_url: dataUrl } : prev));
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
            const response = await fetch(`${API_BASE_URL}/review-later/${encodeURIComponent(itemToRemove.problem_id)}?subject=${encodeURIComponent(itemToRemove.subject)}`, { method: 'DELETE' });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '登録解除に失敗しました。');
            }
            await fetchItems();
        }
        catch (removeError) {
            console.error(removeError);
            setError(removeError instanceof Error ? removeError.message : '登録解除に失敗しました。');
        }
    };
    const handleRegisterHistory = async (outcome) => {
        if (!selectedItem)
            return;
        try {
            setIsRegisteringHistory(outcome);
            setError('');
            const response = await fetch(`${API_BASE_URL}/review-later/${encodeURIComponent(selectedItem.subject)}/${encodeURIComponent(selectedItem.problem_id)}/register-history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outcome }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '実績登録に失敗しました。');
            }
            await fetchItems();
        }
        catch (registerError) {
            console.error(registerError);
            setError(registerError instanceof Error ? registerError.message : '実績登録に失敗しました。');
        }
        finally {
            setIsRegisteringHistory('');
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
            navigate('/?adhoc=1');
        }
        catch (similarError) {
            setError(similarError instanceof Error ? similarError.message : '類題の取得に失敗しました。');
        }
        finally {
            setIsFindingSimilar(false);
        }
    };
    return (_jsxs("div", { className: "max-w-7xl mx-auto space-y-6", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-3xl font-bold text-dark", children: "\u5F8C\u3067\u78BA\u8A8D" }), _jsx("p", { className: "text-sm text-gray-500 mt-1", children: "\u73FE\u5728\u3082\u767B\u9332\u72B6\u614B\u306E\u554F\u984C\u3092\u3059\u3079\u3066\u8868\u793A\u3057\u307E\u3059\u3002\u5B9F\u7E3E\u767B\u9332\u3092\u884C\u3046\u3068\u81EA\u52D5\u3067\u767B\u9332\u89E3\u9664\u3055\u308C\u307E\u3059\u3002" })] }), _jsx(Link, { to: "/dashboard", className: "px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg shadow-sm hover:bg-gray-50", children: "\u5206\u6790\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u3078\u623B\u308B" })] }), error && _jsx("div", { className: "rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700", children: error }), isLoading ? (_jsx(LoadingSpinner, {})) : items.length === 0 ? (_jsx("div", { className: "bg-white rounded-xl shadow p-8 text-sm text-gray-500", children: "\u767B\u9332\u3055\u308C\u305F\u554F\u984C\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("div", { className: "grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]", children: [_jsx("div", { className: "bg-white rounded-xl shadow p-4 space-y-3", children: items.map((item) => {
                            const itemKey = `${item.subject}::${item.problem_id}`;
                            const active = itemKey === selectedKey;
                            return (_jsxs("div", { className: `rounded-lg border px-4 py-3 transition-colors ${active ? 'border-primary-new bg-blue-50' : 'border-gray-200 bg-white'}`, children: [_jsxs("button", { type: "button", onClick: () => setSelectedKey(itemKey), className: "w-full text-left", children: [_jsx("div", { className: "text-xs text-gray-500 truncate", children: item.subject }), _jsx("div", { className: "mt-1 text-sm font-semibold text-gray-800 line-clamp-2", children: item.question?.question_text || item.error || '問題を読み込めませんでした。' }), _jsxs("div", { className: "mt-2 text-[11px] text-gray-400", children: ["\u66F4\u65B0: ", new Date(item.updated_at).toLocaleString()] })] }), _jsx("div", { className: "mt-3 flex justify-end", children: _jsx("button", { type: "button", onClick: () => void handleRemove(item), className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50", children: "\u4E00\u89A7\u3067\u767B\u9332\u89E3\u9664" }) })] }, itemKey));
                        }) }), _jsx("div", { className: "bg-white rounded-xl shadow p-6", children: !selectedItem || !editingProblem ? (_jsx("div", { className: "text-sm text-gray-500", children: "\u8868\u793A\u3067\u304D\u308B\u554F\u984C\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-500", children: editingProblem.subject }), _jsxs("div", { className: "text-sm text-gray-500", children: ["\u554F\u984CID: ", editingProblem.id] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => void handleRegisterHistory('correct'), disabled: isRegisteringHistory !== '', className: "px-4 py-2 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:bg-gray-300", children: isRegisteringHistory === 'correct' ? '登録中...' : '正解実績を登録' }), _jsx("button", { type: "button", onClick: () => void handleRegisterHistory('incorrect'), disabled: isRegisteringHistory !== '', className: "px-4 py-2 rounded-md bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:bg-gray-300", children: isRegisteringHistory === 'incorrect' ? '登録中...' : '誤答実績を登録' }), _jsx("button", { type: "button", onClick: () => void handleStartSimilarPractice(), disabled: isFindingSimilar || isRegisteringHistory !== '', className: "px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-gray-300", children: isFindingSimilar ? '類題検索中...' : '類題出題' }), _jsx("button", { type: "button", onClick: () => openIpadReview('air'), disabled: isRegisteringHistory !== '', className: "px-4 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700", children: "iPad Air\u3067\u958B\u304F" }), _jsx("button", { type: "button", onClick: () => openIpadReview('mini'), disabled: isRegisteringHistory !== '', className: "px-4 py-2 rounded-md bg-sky-600 text-white text-sm font-medium hover:bg-sky-700", children: "iPad mini\u3067\u958B\u304F" }), _jsx("button", { type: "button", onClick: () => void handleRemove(), disabled: isRegisteringHistory !== '', className: "px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200", children: "\u767B\u9332\u89E3\u9664" })] })] }), similarTopics.length > 0 && (_jsxs("div", { className: "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900", children: ["AI\u62BD\u51FA\u30C8\u30D4\u30C3\u30AF: ", similarTopics.join(', ')] })), _jsxs("section", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-800", children: "\u554F\u984C\u30C7\u30FC\u30BF" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u554F\u984C\u6587" }), _jsx("textarea", { name: "question_text", value: editingProblem.question_text, onChange: handleProblemChange, rows: 5, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("div", { className: "space-y-3", children: editingProblem.choices.map((choice, index) => (_jsxs("div", { className: "grid grid-cols-1 gap-2 md:grid-cols-[100px_minmax(0,1fr)]", children: [_jsx("input", { value: choice.label, onChange: (event) => handleChoiceChange(index, 'label', event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" }), _jsx("input", { value: choice.text, onChange: (event) => handleChoiceChange(index, 'text', event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" })] }, `${choice.label}-${index}`))) }), _jsxs("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u6B63\u89E3" }), _jsx("input", { name: "answer", value: editingProblem.answer, onChange: handleProblemChange, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsx("input", { name: "category", value: editingProblem.category || '', onChange: handleProblemChange, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u89E3\u8AAC" }), _jsx("textarea", { name: "explanation.text", value: editingProblem.explanation.text, onChange: handleProblemChange, rows: 6, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("button", { type: "button", onClick: () => void handleSaveProblem(), disabled: isSavingProblem, className: "px-5 py-2 rounded-md bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:bg-gray-300", children: isSavingProblem ? '保存中...' : '問題データを保存' })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-800", children: "My Memo" }), _jsx("textarea", { value: customExplanationText, onChange: (event) => setCustomExplanationText(event.target.value), rows: 5, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" }), _jsxs("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u554F\u984C\u6587\u88DC\u8DB3\u753B\u50CF\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9" }), _jsx("input", { type: "file", accept: "image/*", onChange: (event) => void handleCustomImageUpload('question', event.target.files?.[0]), className: "block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" }), editingProblem.custom_question_image_data_url && (_jsx("button", { type: "button", onClick: () => setEditingProblem((prev) => (prev ? { ...prev, custom_question_image_data_url: undefined } : prev)), className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50", children: "\u554F\u984C\u6587\u88DC\u8DB3\u753B\u50CF\u3092\u524A\u9664" }))] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9" }), _jsx("input", { type: "file", accept: "image/*", onChange: (event) => void handleCustomImageUpload('explanation', event.target.files?.[0]), className: "block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" }), editingProblem.custom_explanation_image_data_url && (_jsx("button", { type: "button", onClick: () => setEditingProblem((prev) => (prev ? { ...prev, custom_explanation_image_data_url: undefined } : prev)), className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u3092\u524A\u9664" }))] })] }), _jsx("button", { type: "button", onClick: () => void handleSaveMemo(), disabled: isSavingMemo, className: "px-5 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300", children: isSavingMemo ? '保存中...' : 'My Memoを保存' }), _jsxs("div", { className: "rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("h4", { className: "text-sm font-semibold text-sky-900", children: "\u53E3\u982D\u8A66\u554F\u30E2\u30FC\u30C9" }), !isOralVivaActive ? (_jsx("button", { type: "button", onClick: () => void startOralViva(), disabled: isOralVivaLoading, className: "px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300", children: isOralVivaLoading ? '開始中...' : '口頭試問を開始' })) : (_jsxs("div", { className: "text-right", children: [_jsxs("p", { className: "text-xs font-semibold text-sky-900", children: ["\u30B9\u30C6\u30C3\u30D7: ", oralVivaStepLabels[oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)]], " (", Math.min(oralVivaStepIndex + 1, oralVivaSteps.length), "/", oralVivaSteps.length, ")"] }), _jsx("p", { className: "text-[11px] text-sky-700", children: "\u7D42\u4E86\u6761\u4EF6: 4\u30B9\u30C6\u30C3\u30D7\u5B8C\u4E86 or \u8981\u7D04\u3078\u30B9\u30AD\u30C3\u30D7" })] }))] }), isOralVivaActive && (_jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-2", children: [
                                                                ['論理性', oralVivaScores.logicality],
                                                                ['具体性', oralVivaScores.specificity],
                                                                ['再現性', oralVivaScores.reproducibility],
                                                            ].map(([label, value]) => (_jsxs("div", { className: "rounded-md border border-sky-200 bg-white px-2 py-2", children: [_jsxs("div", { className: "flex justify-between text-xs text-sky-900 mb-1", children: [_jsx("span", { children: label }), _jsx("span", { children: value })] }), _jsx("div", { className: "h-2 rounded bg-sky-100 overflow-hidden", children: _jsx("div", { className: "h-full bg-sky-500", style: { width: `${Math.max(0, Math.min(100, value))}%` } }) })] }, label))) }), _jsx("div", { className: "max-h-64 overflow-y-auto rounded-md border border-sky-200 bg-white p-2 space-y-2", children: oralVivaMessages.map((msg, idx) => (_jsxs("div", { className: `rounded-md px-2 py-1 text-sm ${msg.role === 'assistant' ? 'bg-sky-100 text-sky-900' : 'bg-gray-100 text-gray-800'}`, children: [_jsx("p", { className: "text-[11px] font-semibold", children: msg.role === 'assistant' ? 'AI面接官' : 'あなた' }), _jsx("p", { className: "whitespace-pre-wrap", children: msg.content })] }, `${msg.role}-${idx}`))) }), !oralVivaResult && (_jsxs("div", { className: "space-y-2", children: [_jsx("textarea", { value: oralVivaInput, onChange: (event) => setOralVivaInput(event.target.value), rows: 3, className: "w-full rounded-md border border-sky-300 px-3 py-2 text-sm bg-white", placeholder: "\u56DE\u7B54\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => void submitOralViva(), disabled: isOralVivaLoading || !oralVivaInput.trim(), className: "px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300", children: isOralVivaLoading ? '送信中...' : '送信' }), _jsx("button", { type: "button", onClick: () => void skipToSummary(), disabled: isOralVivaLoading, className: "px-3 py-1.5 rounded-md border border-sky-300 bg-white text-sky-900 text-xs font-medium hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400", children: "\u8981\u7D04\u3078\u30B9\u30AD\u30C3\u30D7" }), _jsx("button", { type: "button", onClick: () => setIsOralVivaActive(false), disabled: isOralVivaLoading, className: "px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400", children: "\u53E3\u982D\u8A66\u554F\u3092\u9589\u3058\u308B" })] })] })), oralVivaResult && (_jsxs("div", { className: "rounded-md border border-sky-200 bg-white p-3 space-y-2", children: [_jsx("h5", { className: "text-sm font-semibold text-sky-900", children: "\u6700\u7D42\u30D5\u30A3\u30FC\u30C9\u30D0\u30C3\u30AF" }), _jsx("ul", { className: "list-disc pl-5 text-sm text-gray-700 space-y-1", children: oralVivaResult.improvementPoints.map((point, idx) => (_jsx("li", { children: point }, `${point}-${idx}`))) }), oralVivaResult.miniQuizQuestion && (_jsxs("p", { className: "text-sm text-gray-800 whitespace-pre-wrap", children: ["\u6B21\u56DE\u78BA\u8A8D\u30DF\u30CB\u554F\u984C: ", oralVivaResult.miniQuizQuestion] })), oralVivaResult.miniQuizAnswer && (_jsxs("p", { className: "text-sm text-gray-700 whitespace-pre-wrap", children: ["\u60F3\u5B9A\u89E3\u7B54: ", oralVivaResult.miniQuizAnswer] })), _jsx("p", { className: "text-xs text-gray-500", children: "\u6700\u7D42\u8981\u7D04\u306F My Memo \u306B\u81EA\u52D5\u8FFD\u8A18\u30FB\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002" })] }))] }))] }), editingProblem.custom_question_image_data_url && (_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-gray-700 mb-2", children: "\u554F\u984C\u6587\u88DC\u8DB3\u753B\u50CF" }), _jsx("img", { src: editingProblem.custom_question_image_data_url, alt: "Question supplement", className: "max-h-56 rounded-lg border border-gray-200 bg-gray-50" })] })), editingProblem.custom_explanation_image_data_url && (_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-gray-700 mb-2", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF" }), _jsx("img", { src: editingProblem.custom_explanation_image_data_url, alt: "Explanation supplement", className: "max-h-56 rounded-lg border border-gray-200 bg-gray-50" })] }))] })] })) })] }))] }));
}
//# sourceMappingURL=ReviewLaterPage.js.map