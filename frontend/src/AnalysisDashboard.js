import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useMemo } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
const API_BASE_URL = "/api";
export default function AnalysisDashboard({ subjects, selectedSubjectName, setSelectedSubjectName, analytics, isLoading, error, dailySummary, isDailySummaryLoading, dailySummaryError, 
// Filters
startDate, setStartDate, endDate, setEndDate, categories, selectedCategory, setSelectedCategory, onApplyFilters, }) {
    const [isExporting, setIsExporting] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [consolidatedData, setConsolidatedData] = useState([]);
    const [isConsolidatedLoading, setIsConsolidatedLoading] = useState(false);
    const [consolidatedError, setConsolidatedError] = useState('');
    const [threshold, setThreshold] = useState(0);
    const fetchConsolidatedData = async () => {
        setIsConsolidatedLoading(true);
        setConsolidatedError('');
        try {
            const response = await fetch(`${API_BASE_URL}/history/daily-summary/all`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || '統合履歴の取得に失敗しました。');
            }
            const data = await response.json();
            setConsolidatedData(data);
        }
        catch (e) {
            setConsolidatedError(e.message);
            setConsolidatedData([]);
        }
        finally {
            setIsConsolidatedLoading(false);
        }
    };
    const openConsolidatedModal = () => {
        setIsModalOpen(true);
        fetchConsolidatedData();
    };
    const missedCategories = useMemo(() => {
        if (!analytics?.frequently_missed_categories)
            return [];
        return Object.entries(analytics.frequently_missed_categories)
            .map(([category, errors]) => ({ category, errors }))
            .sort((a, b) => b.errors - a.errors)
            .slice(0, 5);
    }, [analytics]);
    const trendData = useMemo(() => {
        if (!analytics?.daily_correct_rate_trend)
            return [];
        return Object.entries(analytics.daily_correct_rate_trend)
            .map(([date, rate]) => ({ date, rate: rate * 100 }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [analytics]);
    const handleExportMissedProblems = async () => {
        if (!selectedSubjectName) {
            alert("科目を選択してください。");
            return;
        }
        setIsExporting(true);
        try {
            const response = await fetch(`${API_BASE_URL}/analytics/${selectedSubjectName}/missed-problems`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || '不正解問題リストの取得に失敗しました。');
            }
            const data = await response.json();
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `missed_problems_${selectedSubjectName}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
        catch (e) {
            alert(`エクスポートに失敗しました: ${e.message}`);
        }
        finally {
            setIsExporting(false);
        }
    };
    return (_jsxs(_Fragment, { children: [isModalOpen && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col", children: [_jsxs("div", { className: "flex justify-between items-center p-4 border-b", children: [_jsx("h3", { className: "text-xl font-bold text-gray-800", children: "\u7D71\u5408\u65E5\u5225\u5C65\u6B74 (\u5168\u79D1\u76EE)" }), _jsx("button", { onClick: () => setIsModalOpen(false), className: "text-gray-400 hover:text-gray-600", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-6 w-6", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) }) })] }), _jsx("div", { className: "p-6 overflow-y-auto", children: isConsolidatedLoading ? (_jsx(LoadingSpinner, {})) : consolidatedError ? (_jsx("p", { className: "text-danger text-sm text-center", children: consolidatedError })) : consolidatedData.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500 text-center", children: "\u5C65\u6B74\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-100", children: _jsxs("tr", { children: [_jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u65E5\u4ED8" }), _jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u7DCF\u5B9F\u65BD\u6570" }), _jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u7DCF\u6B63\u7B54\u6570" }), _jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u5168\u4F53\u6B63\u7B54\u7387" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: consolidatedData.map((item) => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-800", children: item.date }), _jsx("td", { className: "px-4 py-3 whitespace-nowrap text-sm text-gray-600", children: item.total_questions }), _jsx("td", { className: "px-4 py-3 whitespace-nowrap text-sm text-gray-600", children: item.correct_count }), _jsxs("td", { className: "px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-medium", children: [(item.accuracy * 100).toFixed(1), "%"] })] }, item.date))) })] })) }), _jsx("div", { className: "flex justify-end p-4 border-t", children: _jsx("button", { onClick: () => setIsModalOpen(false), className: "px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-300", children: "\u9589\u3058\u308B" }) })] }) })), _jsxs("div", { className: "flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("h2", { className: "text-3xl font-bold text-dark", children: "\u5206\u6790\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("button", { onClick: openConsolidatedModal, className: "px-4 py-2 bg-white border border-gray-300 text-primary-new text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50", children: "\u7D71\u5408\u30DC\u30FC\u30C9" })] }), _jsx("div", { className: "w-full sm:w-64", children: _jsx("select", { id: "subject", value: selectedSubjectName, onChange: e => setSelectedSubjectName(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new", children: subjects.map(s => _jsx("option", { value: s.name, children: s.name }, s.name)) }) })] }), _jsx("div", { className: "bg-white rounded-xl shadow p-4 mb-8", children: _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4 items-end", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u65E5\u4ED8\u7BC4\u56F2" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "date", value: startDate, onChange: (e) => setStartDate(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" }), _jsx("span", { className: "text-gray-500", children: "~" }), _jsx("input", { type: "date", value: endDate, onChange: (e) => setEndDate(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "category-filter", className: "block text-sm font-medium text-gray-700 mb-1", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsxs("select", { id: "category-filter", value: selectedCategory, onChange: (e) => setSelectedCategory(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new", children: [_jsx("option", { value: "", children: "\u3059\u3079\u3066\u306E\u30AB\u30C6\u30B4\u30EA" }), categories.map(cat => (_jsx("option", { value: cat, children: cat }, cat)))] })] }), _jsx("div", { className: "md:justify-self-end", children: _jsx("button", { onClick: onApplyFilters, className: "w-full md:w-auto px-6 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700", children: "\u9069\u7528" }) })] }) }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-8", children: [_jsx("div", { className: "lg:col-span-2", children: isLoading ? (_jsx("div", { className: "text-center text-gray-500 p-12", children: _jsx(LoadingSpinner, {}) })) : error ? (_jsx("div", { className: "text-center text-danger bg-danger/10 rounded-xl p-12", children: _jsx("p", { children: error }) })) : !analytics || analytics.total_runs === 0 ? (_jsxs("div", { className: "text-center text-gray-500 bg-white rounded-xl p-12", children: [_jsxs("p", { children: ["\u300C", selectedSubjectName, "\u300D\u306E\u7DF4\u7FD2\u5C65\u6B74\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002"] }), _jsx("p", { className: "mt-2", children: "\u30AF\u30A4\u30BA\u3092\u5B8C\u4E86\u3059\u308B\u3068\u3001\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002" })] })) : (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700 mb-4", children: "\u7DCF\u5408\u30D1\u30D5\u30A9\u30FC\u30DE\u30F3\u30B9" }), _jsxs("div", { className: "grid grid-cols-4 gap-4 text-center", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-3xl font-bold text-primary-new", children: [analytics.overall_correct_rate.toFixed(1), "%"] }), _jsx("p", { className: "text-sm text-gray-500", children: "\u5168\u4F53\u6B63\u7B54\u7387" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-primary-new", children: analytics.total_problems_in_subject }), _jsx("p", { className: "text-sm text-gray-500", children: "\u554F\u984C\u7DCF\u6570" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-primary-new", children: analytics.total_runs }), _jsx("p", { className: "text-sm text-gray-500", children: "\u7DCF\u89E3\u7B54\u6570" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-green-600", children: analytics.unanswered_problems_count }), _jsx("p", { className: "text-sm text-gray-500", children: "\u672A\u89E3\u7B54\u554F\u984C" })] })] })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700", children: "\u4E3B\u306A\u82E6\u624B\u5206\u91CE (\u30A8\u30E9\u30FC\u6570\u9806)" }), missedCategories.length > 0 && (_jsx("button", { onClick: handleExportMissedProblems, disabled: isExporting, className: "px-3 py-1 bg-primary-new text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed", children: isExporting ? 'エクスポート中...' : 'エクスポート' }))] }), missedCategories.length > 0 ? (_jsx("ul", { className: "space-y-3", children: missedCategories.map(area => (_jsx("li", { children: _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: area.category }), _jsxs("p", { className: "text-sm font-bold text-danger", children: [area.errors, " \u56DE"] })] }) }, area.category))) })) : (_jsx("p", { className: "text-sm text-gray-500", children: "\u30DF\u30B9\u3057\u305F\u554F\u984C\u306F\u3042\u308A\u307E\u305B\u3093\u3067\u3057\u305F\uFF01" }))] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700", children: "\u6B63\u7B54\u7387\u306E\u63A8\u79FB" }), _jsxs("select", { onChange: (e) => setThreshold(Number(e.target.value)), value: threshold, className: "text-xs border border-gray-300 rounded-md py-1 px-2", children: [_jsx("option", { value: 0, children: "\u95BE\u5024\u306A\u3057" }), _jsx("option", { value: 60, children: "60%" }), _jsx("option", { value: 70, children: "70%" }), _jsx("option", { value: 80, children: "80%" }), _jsx("option", { value: 90, children: "90%" })] })] }), _jsxs("div", { className: "h-64 flex items-stretch", children: [_jsxs("div", { className: "flex-shrink-0 flex flex-col justify-between text-xs text-gray-500 pr-2", children: [_jsx("span", { children: "100%" }), _jsx("span", { children: "90%" }), _jsx("span", { children: "80%" }), _jsx("span", { children: "70%" }), _jsx("span", { children: "60%" }), _jsx("span", { children: "50%" })] }), _jsx("div", { className: "relative flex-grow overflow-x-auto", children: _jsxs("div", { className: "relative h-full", style: { minWidth: trendData.length > 21 ? `${trendData.length * 25}px` : '100%' }, children: [_jsx("div", { className: "absolute inset-0", children: [100, 90, 80, 70, 60, 50].map(p => {
                                                                    const topPosition = 100 - p;
                                                                    return _jsx("div", { className: "absolute w-full border-t border-gray-200 border-dashed", style: { top: `${topPosition}%` } }, p);
                                                                }) }), trendData.length > 1 ? (_jsx("div", { className: "relative w-full h-full flex justify-around gap-2 items-end px-1", children: trendData.map((d, i) => {
                                                                    const isAboveThreshold = threshold > 0 && d.rate >= threshold;
                                                                    const barColor = isAboveThreshold ? 'bg-orange-300 hover:bg-orange-400' : 'bg-blue-200 hover:bg-blue-300';
                                                                    return (_jsxs("div", { className: "flex-1 h-full flex flex-col justify-end items-center group", children: [_jsxs("div", { className: "text-xs font-bold text-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-200", children: [d.rate.toFixed(0), "%"] }), _jsx("div", { className: `w-full ${barColor} transition-colors duration-200 rounded-t min-h-[2px]`, style: { height: `${d.rate}%` } }), _jsx("div", { className: "text-xs text-gray-500 mt-1", children: d.date.substring(5) })] }, i));
                                                                }) })) : _jsx("p", { className: "absolute inset-0 flex items-center justify-center text-sm text-gray-500", children: "\u30B0\u30E9\u30D5\u3092\u8868\u793A\u3059\u308B\u306B\u306F2\u65E5\u4EE5\u4E0A\u306E\u5C65\u6B74\u304C\u5FC5\u8981\u3067\u3059\u3002" })] }) })] })] })] })) }), _jsx("div", { className: "lg:col-span-1", children: _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700 mb-4", children: "\u65E5\u5225\u5B9F\u65BD\u5C65\u6B74" }), isDailySummaryLoading ? (_jsx(LoadingSpinner, {})) : dailySummaryError ? (_jsx("p", { className: "text-danger text-sm text-center", children: "\u5C65\u6B74\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" })) : dailySummary.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500", children: "\u65E5\u5225\u5B9F\u65BD\u5C65\u6B74\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-100", children: _jsxs("tr", { children: [_jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u65E5\u4ED8" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u5B9F\u65BD\u6570" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u6B63\u7B54\u6570" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u6B63\u7B54\u7387" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: dailySummary.map((item) => (_jsxs("tr", { className: "hover:bg-gray-100", children: [_jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-700", children: item.date }), _jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: item.total_questions }), _jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: item.correct_count }), _jsxs("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: [(item.accuracy * 100).toFixed(1), "%"] })] }, item.date))) })] }) }))] }) })] })] }));
}
//# sourceMappingURL=AnalysisDashboard.js.map