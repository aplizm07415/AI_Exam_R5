import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo } from 'react';
// localStorageのキー
const STORAGE_KEY_EXAM_NAME = 'examName';
const STORAGE_KEY_EXAM_DATE = 'examDate';
export default function CountdownPage() {
    const [examName, setExamName] = useState('中小企業診断士 2次試験');
    const [examDate, setExamDate] = useState(new Date().toISOString().split('T')[0]);
    const [result, setResult] = useState(null);
    // マウント時にlocalStorageから値を読み込む
    useEffect(() => {
        const savedName = localStorage.getItem(STORAGE_KEY_EXAM_NAME);
        if (savedName) {
            setExamName(savedName);
        }
        const savedDate = localStorage.getItem(STORAGE_KEY_EXAM_DATE);
        if (savedDate) {
            setExamDate(savedDate);
        }
    }, []); // 空の依存配列で、マウント時に一度だけ実行
    // ... (rest of the component)
    // 試験名が変更されたらlocalStorageに保存
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_EXAM_NAME, examName);
    }, [examName]);
    // 試験日が変更されたらlocalStorageに保存
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY_EXAM_DATE, examDate);
    }, [examDate]);
    // 試験日までの日数を計算するロジック
    const calculateCountdown = (targetDateStr) => {
        if (!targetDateStr)
            return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0); // 今日の始まり
        const targetDate = new Date(targetDateStr);
        targetDate.setHours(0, 0, 0, 0); // 試験日の始まり
        const diffTime = targetDate.getTime() - today.getTime();
        if (diffTime < 0) {
            return { totalDays: 0, workdays: 0, weekends: 0 };
        }
        const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        let workdays = 0;
        let weekends = 0;
        for (let i = 0; i < totalDays; i++) {
            const currentDate = new Date(today.getTime() + i * (1000 * 60 * 60 * 24));
            const dayOfWeek = currentDate.getDay(); // 0 (Sunday) to 6 (Saturday)
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                weekends++;
            }
            else {
                workdays++;
            }
        }
        return { totalDays, workdays, weekends };
    };
    // 試験日が変更されたら再計算
    useEffect(() => {
        const calculationResult = calculateCountdown(examDate);
        setResult(calculationResult);
    }, [examDate]);
    return (_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs("div", { className: "bg-white rounded-xl shadow p-8", children: [_jsx("h2", { className: "text-2xl font-bold text-dark mb-6", children: "\u8A66\u9A13\u65E5\u30AB\u30A6\u30F3\u30C8\u30C0\u30A6\u30F3" }), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "exam-name", className: "block text-sm font-medium text-gray-700 mb-1", children: "\u8A66\u9A13\u540D" }), _jsx("input", { type: "text", id: "exam-name", value: examName, onChange: (e) => setExamName(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new", placeholder: "\u4F8B: \u3007\u3007\u6280\u8853\u8005\u8A66\u9A13" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "exam-date", className: "block text-sm font-medium text-gray-700 mb-1", children: "\u8A66\u9A13\u65E5" }), _jsx("input", { type: "date", id: "exam-date", value: examDate, onChange: (e) => setExamDate(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new" })] })] }), result && examDate && (_jsxs("div", { className: "mt-8 pt-6 border-t border-gray-200", children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-800", children: [_jsx("span", { className: "font-bold text-primary-new", children: examName }), " \u307E\u3067\u3001\u3042\u3068..."] }), _jsxs("div", { className: "mt-4 text-center", children: [_jsx("p", { className: "text-6xl font-bold text-primary-new", children: result.totalDays }), _jsx("p", { className: "text-lg text-gray-600", children: "\u65E5" })] }), _jsxs("div", { className: "mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-center", children: [_jsxs("div", { className: "bg-blue-50 p-4 rounded-lg", children: [_jsx("p", { className: "text-3xl font-semibold text-blue-600", children: result.workdays }), _jsx("p", { className: "text-sm text-blue-500", children: "\u5E73\u65E5" })] }), _jsxs("div", { className: "bg-green-50 p-4 rounded-lg", children: [_jsx("p", { className: "text-3xl font-semibold text-green-600", children: result.weekends }), _jsx("p", { className: "text-sm text-green-500", children: "\u4F11\u65E5" })] })] }), result.totalDays === 0 && new Date(examDate).setHours(0, 0, 0, 0) >= new Date().setHours(0, 0, 0, 0) && (_jsx("p", { className: "text-center mt-4 font-semibold text-lg text-rose-600", children: "\u672C\u756A\u5F53\u65E5\u3067\u3059\uFF01\u9811\u5F35\u3063\u3066\u304F\u3060\u3055\u3044\uFF01" }))] }))] }) }));
}
//# sourceMappingURL=CountdownPage.js.map