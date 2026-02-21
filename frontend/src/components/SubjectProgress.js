import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';
const API_BASE_URL = "/api";
const SubjectProgress = ({ selectedSubjectNames, quizMode }) => {
    const [progressData, setProgressData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        const fetchProgressData = async () => {
            if (quizMode === 'today_remaining' || selectedSubjectNames.length === 0) {
                setProgressData(null);
                return;
            }
            setIsLoading(true);
            setError(null);
            try {
                const params = new URLSearchParams();
                selectedSubjectNames.forEach(name => params.append('subject_names', name));
                const response = await fetch(`${API_BASE_URL}/progress/subjects?${params.toString()}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch progress data.');
                }
                const data = await response.json();
                setProgressData(data);
            }
            catch (e) {
                setError(e.message);
                setProgressData(null);
            }
            finally {
                setIsLoading(false);
            }
        };
        fetchProgressData();
    }, [selectedSubjectNames, quizMode]);
    if (isLoading) {
        return _jsx("div", { className: "my-4", children: _jsx(LoadingSpinner, {}) });
    }
    if (error) {
        return _jsx("div", { className: "my-4 text-center text-red-500", children: error });
    }
    if (!progressData || selectedSubjectNames.length === 0 || quizMode === 'today_remaining') {
        return null;
    }
    return (_jsxs("div", { className: "my-6 p-4 bg-white rounded-lg shadow", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "\u79D1\u76EE\u5225\u9032\u6357" }), _jsx("div", { className: "space-y-4", children: selectedSubjectNames.map(subjectName => {
                    const data = progressData[subjectName];
                    if (!data || data.total_problems === 0) {
                        return (_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-gray-600", children: subjectName.replace('.json', '') }), _jsx("p", { className: "text-sm text-gray-400", children: "\u9032\u6357\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })] }, subjectName));
                    }
                    const correctlyAnsweredPct = (data.correctly_answered_once / data.total_problems) * 100;
                    const incorrectlyAnsweredOnly = data.answered_problems - data.correctly_answered_once;
                    const incorrectlyAnsweredPct = (incorrectlyAnsweredOnly / data.total_problems) * 100;
                    const unansweredPct = (data.unanswered_problems / data.total_problems) * 100;
                    return (_jsxs("div", { children: [_jsxs("p", { className: "text-sm font-medium text-gray-800 mb-1", children: [subjectName.replace('.json', ''), " (", data.total_problems, "\u554F)"] }), _jsxs("div", { className: "w-full bg-gray-200 rounded-full h-4 flex overflow-hidden", children: [_jsx("div", { className: "bg-green-500 h-4", style: { width: `${correctlyAnsweredPct}%` }, title: `正解済み: ${data.correctly_answered_once}問 (${correctlyAnsweredPct.toFixed(1)}%)` }), _jsx("div", { className: "bg-yellow-400 h-4", style: { width: `${incorrectlyAnsweredPct}%` }, title: `不正解のみ: ${incorrectlyAnsweredOnly}問 (${incorrectlyAnsweredPct.toFixed(1)}%)` }), _jsx("div", { className: "bg-gray-300 h-4", style: { width: `${unansweredPct}%` }, title: `未解答: ${data.unanswered_problems}問 (${unansweredPct.toFixed(1)}%)` })] }), _jsxs("div", { className: "text-xs text-gray-500 mt-1 flex justify-between", children: [_jsxs("span", { children: ["\u6B63\u89E3: ", data.correctly_answered_once] }), _jsxs("span", { children: ["\u4E0D\u6B63\u89E3\u306E\u307F: ", incorrectlyAnsweredOnly] }), _jsxs("span", { children: ["\u672A\u89E3\u7B54: ", data.unanswered_problems] })] })] }, subjectName));
                }) })] }));
};
export default SubjectProgress;
//# sourceMappingURL=SubjectProgress.js.map