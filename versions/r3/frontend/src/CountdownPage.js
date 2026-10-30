import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo } from 'react';
import { getTodayYmdJst } from './utils/date';
const STORAGE_KEY_EXAMS = 'countdownExams';
const calculateCountdown = (targetDateStr) => {
    if (!targetDateStr)
        return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(targetDateStr);
    targetDate.setHours(0, 0, 0, 0);
    const diffTime = targetDate.getTime() - today.getTime();
    if (diffTime < 0) {
        return { totalDays: 0, workdays: 0, weekends: 0 };
    }
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    let workdays = 0;
    let weekends = 0;
    for (let i = 0; i < totalDays; i++) {
        const currentDate = new Date(today.getTime() + i * (1000 * 60 * 60 * 24));
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekends++;
        }
        else {
            workdays++;
        }
    }
    return { totalDays, workdays, weekends };
};
const CountdownItem = ({ exam, onDelete }) => {
    const result = useMemo(() => calculateCountdown(exam.date), [exam.date]);
    if (!result)
        return null;
    const isToday = result.totalDays === 0 && new Date(exam.date).setHours(0, 0, 0, 0) >= new Date().setHours(0, 0, 0, 0);
    return (_jsxs("div", { className: "bg-gray-50 rounded-xl p-6 relative", children: [_jsx("button", { onClick: () => onDelete(exam.id), className: "absolute top-3 right-3 text-gray-400 hover:text-danger transition-colors", title: "\u524A\u9664", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-5 w-5", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 2, children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" }) }) }), _jsxs("h3", { className: "text-lg font-semibold text-gray-800 pr-8", children: [_jsx("span", { className: "font-bold text-primary-new", children: exam.name }), " \u307E\u3067\u3001\u3042\u3068..."] }), _jsxs("div", { className: "mt-4 text-center", children: [_jsx("p", { className: "text-6xl font-bold text-primary-new", children: result.totalDays }), _jsx("p", { className: "text-lg text-gray-600", children: "\u65E5" })] }), _jsxs("div", { className: "mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-center", children: [_jsxs("div", { className: "bg-info/30 p-4 rounded-lg", children: [_jsx("p", { className: "text-3xl font-semibold text-primary", children: result.workdays }), _jsx("p", { className: "text-sm text-secondary", children: "\u5E73\u65E5" })] }), _jsxs("div", { className: "bg-success/20 p-4 rounded-lg", children: [_jsx("p", { className: "text-3xl font-semibold text-success", children: result.weekends }), _jsx("p", { className: "text-sm text-success", children: "\u4F11\u65E5" })] })] }), isToday && (_jsx("p", { className: "text-center mt-4 font-semibold text-lg text-danger", children: "\u672C\u756A\u5F53\u65E5\u3067\u3059\uFF01\u9811\u5F35\u3063\u3066\u304F\u3060\u3055\u3044\uFF01" }))] }));
};
export default function CountdownPage() {
    const [exams, setExams] = useState(() => {
        try {
            const savedExams = localStorage.getItem(STORAGE_KEY_EXAMS);
            return savedExams ? JSON.parse(savedExams) : [];
        }
        catch (e) {
            console.error("Failed to parse exams from localStorage", e);
            return [];
        }
    });
    const [newExamName, setNewExamName] = useState('');
    const [newExamDate, setNewExamDate] = useState(() => getTodayYmdJst());
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_EXAMS, JSON.stringify(exams));
    }, [exams]);
    const handleAddExam = () => {
        if (!newExamName.trim() || !newExamDate) {
            alert('試験名と試験日を入力してください。');
            return;
        }
        const newExam = {
            id: Date.now(),
            name: newExamName.trim(),
            date: newExamDate,
        };
        setExams(prevExams => [...prevExams, newExam]);
        // Reset form
        setNewExamName('');
        setNewExamDate(getTodayYmdJst());
    };
    const handleDeleteExam = (id) => {
        if (window.confirm('この試験を削除しますか？')) {
            setExams(prevExams => prevExams.filter(exam => exam.id !== id));
        }
    };
    return (_jsxs("div", { className: "max-w-2xl mx-auto space-y-8", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-8", children: [_jsx("h2", { className: "text-2xl font-bold text-dark mb-6", children: "\u65B0\u3057\u3044\u8A66\u9A13\u3092\u767B\u9332" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "new-exam-name", className: "block text-sm font-medium text-gray-700 mb-1", children: "\u8A66\u9A13\u540D" }), _jsx("input", { type: "text", id: "new-exam-name", value: newExamName, onChange: (e) => setNewExamName(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new", placeholder: "\u4F8B: \u3007\u3007\u6280\u8853\u8005\u8A66\u9A13" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "new-exam-date", className: "block text-sm font-medium text-gray-700 mb-1", children: "\u8A66\u9A13\u65E5" }), _jsx("input", { type: "date", id: "new-exam-date", value: newExamDate, onChange: (e) => setNewExamDate(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new" })] }), _jsx("div", { className: "text-right", children: _jsx("button", { onClick: handleAddExam, className: "inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-new hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-new", children: "\u767B\u9332\u3059\u308B" }) })] })] }), exams.length > 0 && (_jsxs("div", { className: "space-y-6", children: [_jsx("h2", { className: "text-2xl font-bold text-dark", children: "\u767B\u9332\u6E08\u307F\u8A66\u9A13\u30EA\u30B9\u30C8" }), exams
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                        .map(exam => (_jsx(CountdownItem, { exam: exam, onDelete: handleDeleteExam }, exam.id)))] }))] }));
}
//# sourceMappingURL=CountdownPage.js.map