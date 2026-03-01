import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
const API_BASE_URL = '/api';
export default function ReviewLaterPage() {
    const [items, setItems] = useState([]);
    const [selectedKey, setSelectedKey] = useState('');
    const [editingProblem, setEditingProblem] = useState(null);
    const [customExplanationText, setCustomExplanationText] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSavingProblem, setIsSavingProblem] = useState(false);
    const [isSavingMemo, setIsSavingMemo] = useState(false);
    const [error, setError] = useState('');
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
                ? { ...item, question: { ...item.question, custom_explanation: customExplanationText } }
                : item));
            setEditingProblem((prev) => (prev ? { ...prev, custom_explanation: customExplanationText } : prev));
        }
        catch (saveError) {
            console.error(saveError);
            setError(saveError instanceof Error ? saveError.message : 'My Memo の保存に失敗しました。');
        }
        finally {
            setIsSavingMemo(false);
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
    const openIpadReview = () => {
        if (!selectedItem)
            return;
        const deepLink = `quizapp://quiz-review?base=${encodeURIComponent(window.location.origin)}` +
            `&subject=${encodeURIComponent(selectedItem.subject)}` +
            `&problem=${encodeURIComponent(selectedItem.problem_id)}`;
        window.location.href = deepLink;
    };
    return (_jsxs("div", { className: "max-w-7xl mx-auto space-y-6", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-3xl font-bold text-dark", children: "\u5F8C\u3067\u78BA\u8A8D" }), _jsx("p", { className: "text-sm text-gray-500 mt-1", children: "\u6F14\u7FD2\u4E2D\u306B\u767B\u9332\u3057\u305F\u554F\u984C\u3092\u307E\u3068\u3081\u3066\u78BA\u8A8D\u3057\u307E\u3059\u3002" })] }), _jsx(Link, { to: "/dashboard", className: "px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg shadow-sm hover:bg-gray-50", children: "\u5206\u6790\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u3078\u623B\u308B" })] }), error && _jsx("div", { className: "rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700", children: error }), isLoading ? (_jsx(LoadingSpinner, {})) : items.length === 0 ? (_jsx("div", { className: "bg-white rounded-xl shadow p-8 text-sm text-gray-500", children: "\u767B\u9332\u3055\u308C\u305F\u554F\u984C\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("div", { className: "grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]", children: [_jsx("div", { className: "bg-white rounded-xl shadow p-4 space-y-3", children: items.map((item) => {
                            const itemKey = `${item.subject}::${item.problem_id}`;
                            const active = itemKey === selectedKey;
                            return (_jsxs("div", { className: `rounded-lg border px-4 py-3 transition-colors ${active ? 'border-primary-new bg-blue-50' : 'border-gray-200 bg-white'}`, children: [_jsxs("button", { type: "button", onClick: () => setSelectedKey(itemKey), className: "w-full text-left", children: [_jsx("div", { className: "text-xs text-gray-500 truncate", children: item.subject }), _jsx("div", { className: "mt-1 text-sm font-semibold text-gray-800 line-clamp-2", children: item.question?.question_text || item.error || '問題を読み込めませんでした。' }), _jsxs("div", { className: "mt-2 text-[11px] text-gray-400", children: ["\u66F4\u65B0: ", new Date(item.updated_at).toLocaleString()] })] }), _jsx("div", { className: "mt-3 flex justify-end", children: _jsx("button", { type: "button", onClick: () => void handleRemove(item), className: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50", children: "\u4E00\u89A7\u3067\u767B\u9332\u89E3\u9664" }) })] }, itemKey));
                        }) }), _jsx("div", { className: "bg-white rounded-xl shadow p-6", children: !selectedItem || !editingProblem ? (_jsx("div", { className: "text-sm text-gray-500", children: "\u8868\u793A\u3067\u304D\u308B\u554F\u984C\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-gray-500", children: editingProblem.subject }), _jsxs("div", { className: "text-sm text-gray-500", children: ["\u554F\u984CID: ", editingProblem.id] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: openIpadReview, className: "px-4 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700", children: "iPad\u30A2\u30D7\u30EA\u3067\u958B\u304F" }), _jsx("button", { type: "button", onClick: () => void handleRemove(), className: "px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200", children: "\u767B\u9332\u89E3\u9664" })] })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-800", children: "\u554F\u984C\u30C7\u30FC\u30BF" }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u554F\u984C\u6587" }), _jsx("textarea", { name: "question_text", value: editingProblem.question_text, onChange: handleProblemChange, rows: 5, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("div", { className: "space-y-3", children: editingProblem.choices.map((choice, index) => (_jsxs("div", { className: "grid grid-cols-1 gap-2 md:grid-cols-[100px_minmax(0,1fr)]", children: [_jsx("input", { value: choice.label, onChange: (event) => handleChoiceChange(index, 'label', event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" }), _jsx("input", { value: choice.text, onChange: (event) => handleChoiceChange(index, 'text', event.target.value), className: "rounded-md border border-gray-300 px-3 py-2 text-sm" })] }, `${choice.label}-${index}`))) }), _jsxs("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u6B63\u89E3" }), _jsx("input", { name: "answer", value: editingProblem.answer, onChange: handleProblemChange, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsx("input", { name: "category", value: editingProblem.category || '', onChange: handleProblemChange, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u89E3\u8AAC" }), _jsx("textarea", { name: "explanation.text", value: editingProblem.explanation.text, onChange: handleProblemChange, rows: 6, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" })] }), _jsx("button", { type: "button", onClick: () => void handleSaveProblem(), disabled: isSavingProblem, className: "px-5 py-2 rounded-md bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:bg-gray-300", children: isSavingProblem ? '保存中...' : '問題データを保存' })] }), _jsxs("section", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-800", children: "My Memo" }), _jsx("textarea", { value: customExplanationText, onChange: (event) => setCustomExplanationText(event.target.value), rows: 5, className: "w-full rounded-md border border-gray-300 px-3 py-2 text-sm" }), _jsx("button", { type: "button", onClick: () => void handleSaveMemo(), disabled: isSavingMemo, className: "px-5 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300", children: isSavingMemo ? '保存中...' : 'My Memoを保存' }), editingProblem.custom_question_image_data_url && (_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-gray-700 mb-2", children: "\u554F\u984C\u6587\u88DC\u8DB3\u753B\u50CF" }), _jsx("img", { src: editingProblem.custom_question_image_data_url, alt: "Question supplement", className: "max-h-56 rounded-lg border border-gray-200 bg-gray-50" })] })), editingProblem.custom_explanation_image_data_url && (_jsxs("div", { children: [_jsx("div", { className: "text-sm font-medium text-gray-700 mb-2", children: "\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF" }), _jsx("img", { src: editingProblem.custom_explanation_image_data_url, alt: "Explanation supplement", className: "max-h-56 rounded-lg border border-gray-200 bg-gray-50" })] }))] })] })) })] }))] }));
}
//# sourceMappingURL=ReviewLaterPage.js.map