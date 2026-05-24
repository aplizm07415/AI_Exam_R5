import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
const API_BASE_URL = "/api";
function BarTrendChart({ points, maxValue, yAxisLabels, emptyMessage, }) {
    const safeMaxValue = Math.max(1, maxValue);
    const minWidth = points.length > 21 ? `${points.length * 28}px` : '100%';
    return (_jsxs("div", { className: "grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2", children: [_jsx("div", { className: "flex h-56 flex-col justify-between pr-1 text-right text-xs text-gray-500", children: yAxisLabels.map((axisLabel, index) => (_jsx("span", { children: axisLabel.label }, `${axisLabel.label}-${index}`))) }), _jsx("div", { className: "overflow-x-auto pb-1", children: _jsxs("div", { style: { minWidth }, children: [_jsxs("div", { className: "relative h-56", children: [_jsx("div", { className: "absolute inset-0", children: yAxisLabels.map((axisLabel, index) => (_jsx("div", { className: "absolute w-full border-t border-gray-200 border-dashed", style: { top: `${axisLabel.topPercent}%` } }, `${axisLabel.label}-${index}`))) }), points.length > 0 ? (_jsx("div", { className: "relative z-10 flex h-full items-end justify-around gap-2 px-1", children: points.map((point, index) => {
                                        const barHeight = Math.max(0, Math.min(100, (point.value / safeMaxValue) * 100));
                                        return (_jsx("div", { className: "group relative flex h-full flex-1 items-end justify-center", children: _jsx("div", { className: `relative w-full rounded-t min-h-[2px] transition-colors duration-200 print-keep-color ${point.barClassName}`, style: { height: `${barHeight}%` }, title: point.title, children: _jsx("div", { className: "absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-secondary opacity-0 transition-opacity duration-200 pointer-events-none group-hover:opacity-100", children: point.label }) }) }, `${point.date}-${index}`));
                                    }) })) : (_jsx("p", { className: "absolute inset-0 flex items-center justify-center text-sm text-gray-500", children: emptyMessage }))] }), points.length > 0 && (_jsx("div", { className: "mt-1 flex justify-around gap-2 px-1", children: points.map((point, index) => (_jsx("div", { className: "flex-1 text-center text-xs text-gray-500", children: point.date.substring(5) }, `${point.date}-label-${index}`))) }))] }) })] }));
}
export default function AnalysisDashboard({ subjects, selectedSubjectNames, setSelectedSubjectNames, analytics, isLoading, error, dailySummary, isDailySummaryLoading, dailySummaryError, hasMoreDailySummary, totalDailySummaryDays, isLoadingMoreDailySummary, isLoadingAllDailySummary, onLoadMoreDailySummary, onLoadAllDailySummary, 
// Filters
startDate, setStartDate, endDate, setEndDate, categories, selectedCategory, setSelectedCategory, onApplyFilters, }) {
    const [isExporting, setIsExporting] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [consolidatedData, setConsolidatedData] = useState([]);
    const [isConsolidatedLoading, setIsConsolidatedLoading] = useState(false);
    const [consolidatedError, setConsolidatedError] = useState('');
    const [threshold, setThreshold] = useState(0);
    const dailyHistoryContainerRef = useRef(null);
    const modeLabelMap = {
        random: 'ランダム',
        weak_area: '苦手',
        unanswered: '未解答',
        today_remaining: '今日の残り',
        specific_area: '特定領域',
        legacy: '旧履歴',
    };
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
    const countTrendData = useMemo(() => {
        return [...dailySummary]
            .map((item) => ({ date: item.date, count: item.total_questions }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [dailySummary]);
    const countScale = useMemo(() => {
        const maxCount = countTrendData.reduce((max, item) => Math.max(max, item.count), 0);
        const top = Math.max(5, Math.ceil(maxCount / 5) * 5);
        const step = Math.max(1, top / 5);
        return {
            top,
            labels: Array.from({ length: 6 }, (_, index) => ({
                label: String(Math.max(0, top - step * index)),
                topPercent: index * 20,
            })),
        };
    }, [countTrendData]);
    const correctRateAxisLabels = useMemo(() => {
        return Array.from({ length: 11 }, (_, index) => ({
            label: `${100 - index * 10}%`,
            topPercent: index * 10,
        }));
    }, []);
    const rateTrendPoints = useMemo(() => {
        return trendData.map((item) => {
            const isAboveThreshold = threshold > 0 && item.rate >= threshold;
            return {
                date: item.date,
                value: item.rate,
                label: `${item.rate.toFixed(0)}%`,
                title: `${item.rate.toFixed(1)}%`,
                barClassName: isAboveThreshold ? 'bg-danger/50 hover:bg-danger' : 'bg-blue-200 hover:bg-blue-300',
            };
        });
    }, [threshold, trendData]);
    const countTrendPoints = useMemo(() => {
        return countTrendData.map((item) => ({
            date: item.date,
            value: item.count,
            label: `${item.count}問`,
            title: `${item.count}問`,
            barClassName: 'bg-emerald-200 hover:bg-emerald-300',
        }));
    }, [countTrendData]);
    const todayAccuracy = useMemo(() => {
        if (!analytics || analytics.today_total_runs === 0)
            return 0;
        return (analytics.today_correct_answers / analytics.today_total_runs) * 100;
    }, [analytics]);
    useEffect(() => {
        const node = dailyHistoryContainerRef.current;
        if (!node)
            return;
        const handleScroll = () => {
            const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
            if (remaining < 120 && hasMoreDailySummary && !isLoadingMoreDailySummary && !isLoadingAllDailySummary) {
                onLoadMoreDailySummary();
            }
        };
        node.addEventListener('scroll', handleScroll);
        return () => node.removeEventListener('scroll', handleScroll);
    }, [hasMoreDailySummary, isLoadingAllDailySummary, isLoadingMoreDailySummary, onLoadMoreDailySummary]);
    const handleExportMissedProblems = async () => {
        if (selectedSubjectNames.length === 0) {
            alert("科目を選択してください。");
            return;
        }
        setIsExporting(true);
        try {
            const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
            const response = await fetch(`${API_BASE_URL}/analytics/export/first-missed-problems?${subjectParams}`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || '不正解問題リストの取得に失敗しました。');
            }
            const data = await response.json();
            const questionCount = Array.isArray(data?.questions) ? data.questions.length : 0;
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `初回間違い_${questionCount}.json`;
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
    const toggleSubject = (name) => {
        setSelectedSubjectNames(selectedSubjectNames.includes(name)
            ? selectedSubjectNames.filter((s) => s !== name)
            : [...selectedSubjectNames, name]);
    };
    return (_jsxs(_Fragment, { children: [isModalOpen && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col", children: [_jsxs("div", { className: "flex justify-between items-center p-4 border-b", children: [_jsx("h3", { className: "text-xl font-bold text-gray-800", children: "\u7D71\u5408\u65E5\u5225\u5C65\u6B74 (\u5168\u79D1\u76EE)" }), _jsx("button", { onClick: () => setIsModalOpen(false), className: "text-gray-400 hover:text-gray-600", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-6 w-6", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) }) })] }), _jsx("div", { className: "p-6 overflow-y-auto", children: isConsolidatedLoading ? (_jsx(LoadingSpinner, {})) : consolidatedError ? (_jsx("p", { className: "text-danger text-sm text-center", children: consolidatedError })) : consolidatedData.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500 text-center", children: "\u5C65\u6B74\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-100", children: _jsxs("tr", { children: [_jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u65E5\u4ED8" }), _jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u7DCF\u5B9F\u65BD\u6570" }), _jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u7DCF\u6B63\u7B54\u6570" }), _jsx("th", { scope: "col", className: "px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u5168\u4F53\u6B63\u7B54\u7387" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: consolidatedData.map((item) => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-800", children: item.date }), _jsx("td", { className: "px-4 py-3 whitespace-nowrap text-sm text-gray-600", children: item.total_questions }), _jsx("td", { className: "px-4 py-3 whitespace-nowrap text-sm text-gray-600", children: item.correct_count }), _jsxs("td", { className: "px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-medium", children: [(item.accuracy * 100).toFixed(1), "%"] })] }, item.date))) })] })) }), _jsx("div", { className: "flex justify-end p-4 border-t", children: _jsx("button", { onClick: () => setIsModalOpen(false), className: "px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-300", children: "\u9589\u3058\u308B" }) })] }) })), _jsxs("div", { className: "flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("h2", { className: "text-3xl font-bold text-dark", children: "\u5206\u6790\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("button", { onClick: openConsolidatedModal, className: "px-4 py-2 bg-white border border-gray-300 text-primary-new text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50", children: "\u7D71\u5408\u30DC\u30FC\u30C9" }), _jsx(Link, { to: "/dashboard/review-later", className: "px-4 py-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm font-semibold rounded-lg shadow-sm hover:bg-amber-100", children: "\u5F8C\u3067\u78BA\u8A8D" })] }), _jsxs("div", { className: "w-full sm:flex-1", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("label", { className: "heading-2 text-sm font-medium text-gray-700", children: "\u5BFE\u8C61\u79D1\u76EE\uFF08\u8907\u6570\u9078\u629E\u53EF\uFF09" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => setSelectedSubjectNames(subjects.map((s) => s.name)), className: "px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50", children: "\u3059\u3079\u3066\u9078\u629E" }), _jsx("button", { type: "button", onClick: () => setSelectedSubjectNames([]), className: "px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50", children: "\u89E3\u9664" })] })] }), _jsx("div", { className: "max-h-32 overflow-y-auto border border-gray-200 rounded-md p-2 bg-white", children: _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-2", children: subjects.map((s) => (_jsxs("label", { className: "flex items-center gap-2 text-sm text-gray-700", children: [_jsx("input", { type: "checkbox", checked: selectedSubjectNames.includes(s.name), onChange: () => toggleSubject(s.name), className: "h-4 w-4 text-primary-new border-gray-300 rounded focus:ring-primary-new" }), _jsx("span", { className: "truncate", title: s.name, children: s.name })] }, s.name))) }) })] })] }), _jsx("div", { className: "bg-white rounded-xl shadow p-4 mb-8", children: _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4 items-end", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "\u65E5\u4ED8\u7BC4\u56F2" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "date", value: startDate, onChange: (e) => setStartDate(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" }), _jsx("span", { className: "text-gray-500", children: "~" }), _jsx("input", { type: "date", value: endDate, onChange: (e) => setEndDate(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "category-filter", className: "heading-2 block text-sm font-medium text-gray-700 mb-1", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsxs("select", { id: "category-filter", value: selectedCategory, onChange: (e) => setSelectedCategory(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new", children: [_jsx("option", { value: "", children: "\u3059\u3079\u3066\u306E\u30AB\u30C6\u30B4\u30EA" }), categories.map(cat => (_jsx("option", { value: cat, children: cat }, cat)))] })] }), _jsx("div", { className: "md:justify-self-end", children: _jsx("button", { onClick: onApplyFilters, className: "w-full md:w-auto px-6 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700", children: "\u9069\u7528" }) })] }) }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-8", children: [_jsx("div", { className: "lg:col-span-2", children: isLoading ? (_jsx("div", { className: "text-center text-gray-500 p-12", children: _jsx(LoadingSpinner, {}) })) : error ? (_jsx("div", { className: "text-center text-danger bg-danger/10 rounded-xl p-12", children: _jsx("p", { children: error }) })) : !analytics || analytics.total_runs === 0 ? (_jsxs("div", { className: "text-center text-gray-500 bg-white rounded-xl p-12", children: [_jsx("p", { children: "\u9078\u629E\u3057\u305F\u79D1\u76EE\u306E\u7DF4\u7FD2\u5C65\u6B74\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002" }), _jsx("p", { className: "mt-2", children: "\u30AF\u30A4\u30BA\u3092\u5B8C\u4E86\u3059\u308B\u3068\u3001\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002" })] })) : (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-6 print-color-graph", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700 mb-4", children: "\u7DCF\u5408\u30D1\u30D5\u30A9\u30FC\u30DE\u30F3\u30B9" }), _jsxs("div", { className: "grid grid-cols-2 gap-4 text-center xl:grid-cols-5", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-3xl font-bold text-primary-new", children: [analytics.overall_correct_rate.toFixed(1), "%"] }), _jsx("p", { className: "text-sm text-gray-500", children: "\u5168\u4F53\u6B63\u7B54\u7387" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-primary-new", children: analytics.total_problems_in_subject }), _jsx("p", { className: "text-sm text-gray-500", children: "\u554F\u984C\u7DCF\u6570" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-primary-new", children: analytics.answered_problems_count }), _jsx("p", { className: "text-sm text-gray-500", children: "\u5B9F\u65BD\u6E08\u307F\u554F\u984C" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-green-600", children: analytics.unanswered_problems_count }), _jsx("p", { className: "text-sm text-gray-500", children: "\u672A\u89E3\u7B54\u554F\u984C" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-slate-700", children: analytics.total_runs }), _jsx("p", { className: "text-sm text-gray-500", children: "\u7DCF\u56DE\u7B54\u56DE\u6570" })] })] }), _jsxs("div", { className: "mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4", children: [_jsxs("div", { className: "flex flex-col gap-3 md:flex-row md:items-end md:justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold text-slate-700", children: "\u672C\u65E5\u306E\u30E2\u30FC\u30C9\u5225\u5B9F\u7E3E" }), _jsx("p", { className: "text-xs text-slate-500", children: "\u9078\u629E\u4E2D\u306E\u79D1\u76EE\u3092\u5BFE\u8C61\u306B\u3001\u4ECA\u65E5\u306E\u5B9F\u65BD\u6570\u3068\u6B63\u7B54\u6570\u3092\u5206\u3051\u3066\u8868\u793A\u3057\u307E\u3059\u3002" })] }), _jsxs("div", { className: "flex gap-4 text-sm text-slate-600", children: [_jsxs("span", { children: ["\u5408\u8A08 ", analytics.today_total_runs, "\u554F"] }), _jsxs("span", { children: ["\u6B63\u7B54 ", analytics.today_correct_answers, "\u554F"] }), _jsxs("span", { children: ["\u6B63\u7B54\u7387 ", todayAccuracy.toFixed(1), "%"] })] })] }), analytics.today_mode_breakdown.length === 0 ? (_jsx("p", { className: "mt-4 text-sm text-slate-500", children: "\u672C\u65E5\u306E\u5C65\u6B74\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsx("div", { className: "mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3", children: analytics.today_mode_breakdown.map((item) => (_jsxs("div", { className: "rounded-lg border border-slate-200 bg-white px-4 py-3", children: [_jsx("p", { className: "text-sm font-semibold text-slate-800", children: modeLabelMap[item.mode] ?? item.mode }), _jsxs("div", { className: "mt-2 flex items-center justify-between text-sm text-slate-600", children: [_jsxs("span", { children: ["\u5B9F\u65BD ", item.total_runs] }), _jsxs("span", { children: ["\u6B63\u7B54 ", item.correct_answers] }), _jsxs("span", { children: [(item.accuracy * 100).toFixed(1), "%"] })] })] }, item.mode))) }))] })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700", children: "\u4E3B\u306A\u82E6\u624B\u5206\u91CE (\u30A8\u30E9\u30FC\u6570\u9806)" }), missedCategories.length > 0 && (_jsx("button", { onClick: handleExportMissedProblems, disabled: isExporting || selectedSubjectNames.length === 0, className: "px-3 py-1 bg-primary-new text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed", children: isExporting ? 'エクスポート中...' : '初回間違いJSONエクスポート' }))] }), missedCategories.length > 0 ? (_jsx("ul", { className: "space-y-3", children: missedCategories.map(area => (_jsx("li", { children: _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: area.category }), _jsxs("p", { className: "text-sm font-bold text-danger", children: [area.errors, " \u56DE"] })] }) }, area.category))) })) : (_jsx("p", { className: "text-sm text-gray-500", children: "\u30DF\u30B9\u3057\u305F\u554F\u984C\u306F\u3042\u308A\u307E\u305B\u3093\u3067\u3057\u305F\uFF01" }))] }), _jsxs("div", { className: "grid gap-8 xl:grid-cols-2", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700", children: "\u6B63\u7B54\u7387\u306E\u63A8\u79FB" }), _jsxs("select", { onChange: (e) => setThreshold(Number(e.target.value)), value: threshold, className: "text-xs border border-gray-300 rounded-md py-1 px-2", children: [_jsx("option", { value: 0, children: "\u95BE\u5024\u306A\u3057" }), _jsx("option", { value: 60, children: "60%" }), _jsx("option", { value: 70, children: "70%" }), _jsx("option", { value: 80, children: "80%" }), _jsx("option", { value: 90, children: "90%" })] })] }), _jsx(BarTrendChart, { points: rateTrendPoints, maxValue: 100, yAxisLabels: correctRateAxisLabels, emptyMessage: "\u5C65\u6B74\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700", children: "\u5B9F\u65BD\u6570\u306E\u63A8\u79FB" }), _jsx("p", { className: "text-xs text-gray-500", children: "\u65E5\u5225\u306E\u5B9F\u65BD\u4EF6\u6570" })] }), _jsx(BarTrendChart, { points: countTrendPoints, maxValue: countScale.top, yAxisLabels: countScale.labels, emptyMessage: "\u5C65\u6B74\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })] })] })] })) }), _jsx("div", { className: "lg:col-span-1", children: _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700", children: "\u65E5\u5225\u5B9F\u65BD\u5C65\u6B74" }), _jsxs("p", { className: "text-xs text-gray-500", children: [dailySummary.length, " / ", totalDailySummaryDays, "\u65E5\u5206\u3092\u8868\u793A"] })] }), _jsx("button", { type: "button", onClick: onLoadAllDailySummary, disabled: !hasMoreDailySummary || isLoadingAllDailySummary, className: "rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60", children: isLoadingAllDailySummary ? '取得中...' : '全部表示' })] }), isDailySummaryLoading ? (_jsx(LoadingSpinner, {})) : dailySummaryError ? (_jsx("p", { className: "text-danger text-sm text-center", children: "\u5C65\u6B74\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" })) : dailySummary.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500", children: "\u65E5\u5225\u5B9F\u65BD\u5C65\u6B74\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsxs("div", { ref: dailyHistoryContainerRef, className: "max-h-[32rem] overflow-auto", children: [_jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-100", children: _jsxs("tr", { children: [_jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u65E5\u4ED8" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u5B9F\u65BD\u6570" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u6B63\u7B54\u6570" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u6B63\u7B54\u7387" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: dailySummary.map((item) => (_jsxs(React.Fragment, { children: [_jsxs("tr", { className: "hover:bg-gray-100", children: [_jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-700", children: item.date }), _jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: item.total_questions }), _jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: item.correct_count }), _jsxs("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: [(item.accuracy * 100).toFixed(1), "%"] })] }), (item.mode_breakdown ?? []).length > 0 && (_jsx("tr", { className: "bg-slate-50", children: _jsx("td", { colSpan: 4, className: "px-3 py-2 text-xs text-slate-600", children: _jsx("div", { className: "flex flex-wrap gap-2", children: (item.mode_breakdown ?? []).map((modeItem) => (_jsxs("span", { className: "rounded-full border border-slate-200 bg-white px-2 py-1", children: [modeLabelMap[modeItem.mode] ?? modeItem.mode, ": \u5B9F\u65BD", modeItem.total_questions, " / \u6B63\u7B54", modeItem.correct_count] }, `${item.date}-${modeItem.mode}`))) }) }) }))] }, item.date))) })] }), isLoadingMoreDailySummary && (_jsx("div", { className: "py-3 text-center text-xs text-gray-500", children: "\u904E\u53BB\u5C65\u6B74\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D..." }))] }))] }) })] })] }));
}
//# sourceMappingURL=AnalysisDashboard.js.map