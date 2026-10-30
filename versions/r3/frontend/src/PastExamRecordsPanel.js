import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
const API_BASE_URL = '/api';
const PASS_SCORE = 60;
const emptyBook = {
    subject_columns: [
        '財務・会計',
        '企業経営理論',
        '運営管理',
        '経営法務',
        '経営情報システム',
        '中小企業経営・中小企業政策',
    ],
    problem_json_mappings: {},
    rows: [],
    updated_at: null,
};
function createRecordId() {
    return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function toDateTimeInputValue(value) {
    if (!value)
        return '';
    return value.slice(0, 16);
}
function normalizeScoreInput(value) {
    if (value.trim() === '')
        return null;
    const next = Number(value);
    if (!Number.isFinite(next))
        return null;
    return Math.max(0, Math.min(100, next));
}
export default function PastExamRecordsPanel({ subjects }) {
    const [book, setBook] = useState(emptyBook);
    const [newRowLabel, setNewRowLabel] = useState('');
    const [newSubjectColumn, setNewSubjectColumn] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const completedCellCount = useMemo(() => {
        return book.rows.reduce((count, row) => {
            return count + book.subject_columns.filter((subject) => row.cells[subject]?.score != null).length;
        }, 0);
    }, [book.rows, book.subject_columns]);
    const passedCellCount = useMemo(() => {
        return book.rows.reduce((count, row) => {
            return count + book.subject_columns.filter((subject) => {
                const score = row.cells[subject]?.score;
                return typeof score === 'number' && score >= PASS_SCORE;
            }).length;
        }, 0);
    }, [book.rows, book.subject_columns]);
    const mappedColumnCount = useMemo(() => {
        return book.subject_columns.filter((subject) => (book.problem_json_mappings[subject] ?? []).length > 0).length;
    }, [book.problem_json_mappings, book.subject_columns]);
    useEffect(() => {
        let isMounted = true;
        const loadRecords = async () => {
            setIsLoading(true);
            setError('');
            try {
                const response = await fetch(`${API_BASE_URL}/dashboard/past-exam-records`);
                const data = await response.json().catch(() => null);
                if (!response.ok) {
                    throw new Error(data?.detail || '過去問と模試記録の取得に失敗しました。');
                }
                if (isMounted) {
                    setBook(data);
                    setIsDirty(false);
                }
            }
            catch (e) {
                if (isMounted) {
                    setError(e.message || '過去問と模試記録の取得に失敗しました。');
                }
            }
            finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };
        void loadRecords();
        return () => {
            isMounted = false;
        };
    }, []);
    const updateBook = (updater) => {
        setBook((current) => updater(current));
        setIsDirty(true);
        setMessage('');
    };
    const addRow = () => {
        const label = newRowLabel.trim();
        if (!label)
            return;
        updateBook((current) => ({
            ...current,
            rows: [
                ...current.rows,
                {
                    id: createRecordId(),
                    label,
                    cells: {},
                },
            ],
        }));
        setNewRowLabel('');
    };
    const updateRowLabel = (rowId, label) => {
        updateBook((current) => ({
            ...current,
            rows: current.rows.map((row) => (row.id === rowId ? { ...row, label } : row)),
        }));
    };
    const deleteRow = (rowId) => {
        updateBook((current) => ({
            ...current,
            rows: current.rows.filter((row) => row.id !== rowId),
        }));
    };
    const addSubjectColumn = () => {
        const subject = newSubjectColumn.trim();
        if (!subject || book.subject_columns.includes(subject))
            return;
        updateBook((current) => ({
            ...current,
            subject_columns: [...current.subject_columns, subject],
        }));
        setNewSubjectColumn('');
    };
    const deleteSubjectColumn = (subject) => {
        if (book.subject_columns.length <= 1)
            return;
        updateBook((current) => {
            const nextMappings = { ...current.problem_json_mappings };
            delete nextMappings[subject];
            return {
                ...current,
                subject_columns: current.subject_columns.filter((column) => column !== subject),
                problem_json_mappings: nextMappings,
                rows: current.rows.map((row) => {
                    const nextCells = { ...row.cells };
                    delete nextCells[subject];
                    return { ...row, cells: nextCells };
                }),
            };
        });
    };
    const updateCell = (rowId, subject, patch) => {
        updateBook((current) => ({
            ...current,
            rows: current.rows.map((row) => {
                if (row.id !== rowId)
                    return row;
                const currentCell = row.cells[subject] ?? {};
                const nextCell = { ...currentCell, ...patch };
                const nextCells = { ...row.cells, [subject]: nextCell };
                return { ...row, cells: nextCells };
            }),
        }));
    };
    const toggleMappedSubject = (recordSubject, problemJsonName) => {
        updateBook((current) => {
            const currentMapped = current.problem_json_mappings[recordSubject] ?? [];
            const exists = currentMapped.includes(problemJsonName);
            const nextMapped = exists
                ? currentMapped.filter((name) => name !== problemJsonName)
                : [...currentMapped, problemJsonName];
            const nextMappings = { ...current.problem_json_mappings };
            if (nextMapped.length > 0) {
                nextMappings[recordSubject] = nextMapped;
            }
            else {
                delete nextMappings[recordSubject];
            }
            return { ...current, problem_json_mappings: nextMappings };
        });
    };
    const saveRecords = async () => {
        setIsSaving(true);
        setError('');
        setMessage('');
        try {
            const response = await fetch(`${API_BASE_URL}/dashboard/past-exam-records`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(book),
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.detail || '過去問と模試記録の保存に失敗しました。');
            }
            setBook(data);
            setIsDirty(false);
            setMessage('保存しました。');
            window.dispatchEvent(new Event('dashboard:pastExamRecordsUpdated'));
        }
        catch (e) {
            setError(e.message || '過去問と模試記録の保存に失敗しました。');
        }
        finally {
            setIsSaving(false);
        }
    };
    return (_jsxs("section", { className: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6", children: [_jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.18em] text-slate-400", children: "Exam Records" }), _jsx("h2", { className: "mt-2 text-2xl font-bold text-slate-900", children: "\u904E\u53BB\u554F\u3068\u6A21\u8A66\u8A18\u9332" })] }), _jsxs("div", { className: "grid grid-cols-3 gap-3 sm:min-w-[390px]", children: [_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3", children: [_jsx("p", { className: "text-xs font-semibold text-slate-500", children: "\u5165\u529B\u6E08\u307F" }), _jsx("p", { className: "mt-1 text-2xl font-bold text-slate-900", children: completedCellCount })] }), _jsxs("div", { className: "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3", children: [_jsx("p", { className: "text-xs font-semibold text-emerald-700", children: "60\u70B9\u4EE5\u4E0A" }), _jsx("p", { className: "mt-1 text-2xl font-bold text-emerald-800", children: passedCellCount })] }), _jsxs("div", { className: "rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3", children: [_jsx("p", { className: "text-xs font-semibold text-sky-700", children: "JSON\u5BFE\u5FDC" }), _jsx("p", { className: "mt-1 text-2xl font-bold text-sky-900", children: mappedColumnCount })] })] })] }), _jsxs("div", { className: "mt-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between", children: [_jsxs("div", { className: "grid flex-1 gap-3 lg:grid-cols-2", children: [_jsxs("div", { className: "flex flex-col gap-2 sm:flex-row", children: [_jsxs("label", { className: "flex-1", children: [_jsx("span", { className: "block text-xs font-semibold text-slate-600", children: "\u5E74\u5EA6\u30FB\u6A21\u8A66\u540D" }), _jsx("input", { type: "text", value: newRowLabel, onChange: (event) => setNewRowLabel(event.target.value), onKeyDown: (event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        addRow();
                                                    }
                                                }, className: "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20", placeholder: "\u4F8B: \u4EE4\u548C6\u5E74\u5EA6 / TAC\u6A21\u8A66" })] }), _jsx("button", { type: "button", onClick: addRow, disabled: !newRowLabel.trim(), className: "rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 sm:self-end", children: "\u884C\u3092\u8FFD\u52A0" })] }), _jsxs("div", { className: "flex flex-col gap-2 sm:flex-row", children: [_jsxs("label", { className: "flex-1", children: [_jsx("span", { className: "block text-xs font-semibold text-slate-600", children: "\u79D1\u76EE\u540D" }), _jsx("input", { type: "text", value: newSubjectColumn, onChange: (event) => setNewSubjectColumn(event.target.value), onKeyDown: (event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        addSubjectColumn();
                                                    }
                                                }, className: "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20", placeholder: "\u4F8B: \u7D4C\u6E08\u5B66\u30FB\u7D4C\u6E08\u653F\u7B56" })] }), _jsx("button", { type: "button", onClick: addSubjectColumn, disabled: !newSubjectColumn.trim() || book.subject_columns.includes(newSubjectColumn.trim()), className: "rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 sm:self-end", children: "\u79D1\u76EE\u3092\u8FFD\u52A0" })] })] }), _jsx("button", { type: "button", onClick: () => void saveRecords(), disabled: isSaving || isLoading || !isDirty, className: "rounded-md bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-500", children: isSaving ? '保存中...' : '保存' })] }), newSubjectColumn.trim() && book.subject_columns.includes(newSubjectColumn.trim()) && (_jsx("p", { className: "mt-2 text-sm text-amber-700", children: "\u540C\u3058\u79D1\u76EE\u540D\u304C\u3059\u3067\u306B\u3042\u308A\u307E\u3059\u3002" })), (error || message || isDirty) && (_jsxs("div", { className: "mt-3 text-sm", children: [error && _jsx("p", { className: "text-rose-700", children: error }), message && _jsx("p", { className: "text-emerald-700", children: message }), isDirty && !message && !error && _jsx("p", { className: "text-slate-500", children: "\u672A\u4FDD\u5B58\u306E\u5909\u66F4\u304C\u3042\u308A\u307E\u3059\u3002" })] })), !isLoading && (_jsxs("div", { className: "mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4", children: [_jsxs("div", { className: "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-slate-800", children: "\u554F\u984CJSON\u30DE\u30C3\u30D4\u30F3\u30B0" }), _jsx("p", { className: "text-xs text-slate-500", children: "\u5404\u79D1\u76EE\u5217\u306B\u5BFE\u5FDC\u3059\u308B\u554F\u984CJSON\u3092\u4FDD\u5B58\u3057\u307E\u3059\u3002" })] }), _jsxs("p", { className: "text-xs font-semibold text-slate-500", children: [mappedColumnCount, "/", book.subject_columns.length, "\u5217"] })] }), _jsx("div", { className: "mt-3 grid gap-3 lg:grid-cols-2", children: book.subject_columns.map((recordSubject) => (_jsxs("div", { className: "rounded-lg border border-slate-200 bg-white p-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("p", { className: "min-w-0 truncate text-sm font-semibold text-slate-800", title: recordSubject, children: recordSubject }), _jsxs("div", { className: "flex shrink-0 items-center gap-2", children: [_jsxs("span", { className: "text-xs text-slate-400", children: [(book.problem_json_mappings[recordSubject] ?? []).length, "\u4EF6"] }), _jsx("button", { type: "button", onClick: () => deleteSubjectColumn(recordSubject), disabled: book.subject_columns.length <= 1, className: "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300", children: "\u524A\u9664" })] })] }), _jsx("div", { className: "mt-2 max-h-32 overflow-y-auto rounded-md border border-slate-100 bg-slate-50 p-2", children: subjects.length === 0 ? (_jsx("p", { className: "text-xs text-slate-500", children: "\u554F\u984CJSON\u306A\u3057" })) : (_jsx("div", { className: "grid gap-1", children: subjects.map((subject) => (_jsxs("label", { className: "flex min-w-0 items-center gap-2 text-xs text-slate-700", children: [_jsx("input", { type: "checkbox", checked: (book.problem_json_mappings[recordSubject] ?? []).includes(subject.name), onChange: () => toggleMappedSubject(recordSubject, subject.name), className: "h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" }), _jsx("span", { className: "truncate", title: subject.name, children: subject.name })] }, `${recordSubject}-${subject.name}`))) })) })] }, recordSubject))) })] })), _jsx("div", { className: "mt-5 overflow-x-auto rounded-xl border border-slate-200", children: isLoading ? (_jsx("div", { className: "p-8 text-center text-sm text-slate-500", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." })) : (_jsxs("table", { className: "min-w-[980px] w-full border-collapse text-sm", children: [_jsx("thead", { className: "bg-slate-100 text-left text-xs font-semibold text-slate-600", children: _jsxs("tr", { children: [_jsx("th", { className: "w-56 border-b border-slate-200 px-3 py-3", children: "\u5E74\u5EA6\u30FB\u6A21\u8A66" }), book.subject_columns.map((subject) => (_jsx("th", { className: "min-w-[12rem] border-b border-slate-200 px-3 py-3", children: subject }, subject))), _jsx("th", { className: "w-24 border-b border-slate-200 px-3 py-3 text-right", children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { children: book.rows.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: book.subject_columns.length + 2, className: "px-3 py-8 text-center text-sm text-slate-500", children: "\u8A18\u9332\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" }) })) : (book.rows.map((row) => (_jsxs("tr", { className: "border-b border-slate-100 last:border-b-0", children: [_jsx("td", { className: "align-top bg-slate-50 px-3 py-3", children: _jsx("input", { type: "text", value: row.label, onChange: (event) => updateRowLabel(row.id, event.target.value), className: "block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20" }) }), book.subject_columns.map((subject) => {
                                        const cell = row.cells[subject] ?? {};
                                        const isPassed = typeof cell.score === 'number' && cell.score >= PASS_SCORE;
                                        return (_jsx("td", { className: `align-top px-3 py-3 transition-colors ${isPassed ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-200' : 'bg-white'}`, children: _jsxs("div", { className: "grid gap-2", children: [_jsx("input", { type: "datetime-local", value: toDateTimeInputValue(cell.attempted_at), onChange: (event) => updateCell(row.id, subject, { attempted_at: event.target.value || null }), className: "block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "number", min: 0, max: 100, value: cell.score ?? '', onChange: (event) => updateCell(row.id, subject, { score: normalizeScoreInput(event.target.value) }), className: "block w-24 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20" }), _jsx("span", { className: `text-xs font-semibold ${isPassed ? 'text-emerald-700' : 'text-slate-400'}`, children: isPassed ? '60点以上' : '点' })] })] }) }, `${row.id}-${subject}`));
                                    }), _jsx("td", { className: "align-top px-3 py-3 text-right", children: _jsx("button", { type: "button", onClick: () => deleteRow(row.id), className: "rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50", children: "\u524A\u9664" }) })] }, row.id)))) })] })) })] }));
}
//# sourceMappingURL=PastExamRecordsPanel.js.map