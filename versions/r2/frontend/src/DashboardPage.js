import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo } from 'react';
const API_BASE_URL = "/api";
export default function DashboardPage({ subjects }) {
    const [selectedSubjectName, setSelectedSubjectName] = useState('');
    const [analytics, setAnalytics] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    // 新規追加: 日別集計のステート
    const [dailySummary, setDailySummary] = useState([]);
    const [isDailySummaryLoading, setIsDailySummaryLoading] = useState(false);
    const [dailySummaryError, setDailySummaryError] = useState('');
    // エクスポート機能のための新規ステート
    const [isExporting, setIsExporting] = useState(false);
    useEffect(() => {
        // 最初の科目を自動選択するロジック
        // 依存配列から selectedSubjectName を削除し、ユーザーの選択が上書きされないように修正
        if (subjects.length > 0 && !selectedSubjectName) {
            const firstSubject = subjects[0];
            if (firstSubject) {
                setSelectedSubjectName(firstSubject.name);
            }
        }
        else if (subjects.length === 0) {
            setSelectedSubjectName('');
            setAnalytics(null);
        }
    }, [subjects]); // subjects のみに依存
    useEffect(() => {
        if (!selectedSubjectName) {
            setAnalytics(null);
            return;
        }
        const fetchAnalytics = async () => {
            setIsLoading(true);
            setError('');
            try {
                const response = await fetch(`${API_BASE_URL}/analytics/${selectedSubjectName}`);
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || '分析データの取得に失敗しました。');
                }
                const data = await response.json();
                setAnalytics(data);
            }
            catch (e) {
                setError(e.message);
                setAnalytics(null);
            }
            finally {
                setIsLoading(false);
            }
        };
        fetchAnalytics();
    }, [selectedSubjectName]); // selectedSubjectName が変わるたびに実行
    // 新規追加: 日別集計データの取得
    useEffect(() => {
        if (!selectedSubjectName) {
            setDailySummary([]);
            return;
        }
        const fetchDailySummary = async () => {
            setIsDailySummaryLoading(true);
            setDailySummaryError('');
            try {
                const response = await fetch(`${API_BASE_URL}/history/daily-summary/${selectedSubjectName}`);
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || '日別集計データの取得に失敗しました。');
                }
                const data = await response.json();
                setDailySummary(data);
            }
            catch (e) {
                setDailySummaryError(e.message);
                setDailySummary([]);
            }
            finally {
                setIsDailySummaryLoading(false);
            }
        };
        fetchDailySummary();
    }, [selectedSubjectName]);
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
    if (subjects.length === 0) {
        return (_jsxs("div", { className: "text-center text-gray-400", children: [_jsx("h2", { className: "text-2xl font-bold mb-4", children: "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("p", { children: "\u79D1\u76EE\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u5148\u306B\u300C\u30C7\u30FC\u30BF\u7BA1\u7406\u300D\u30DA\u30FC\u30B8\u3067\u30C7\u30FC\u30BF\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })] }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto", children: [_jsxs("div", { className: "flex flex-col sm:flex-row justify-between sm:items-center mb-8 gap-4", children: [_jsx("h2", { className: "text-3xl font-bold text-dark", children: "\u5206\u6790\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("div", { className: "w-full sm:w-64", children: _jsx("select", { id: "subject", value: selectedSubjectName, onChange: e => setSelectedSubjectName(e.target.value), className: "block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new", children: subjects.map(s => _jsx("option", { value: s.name, children: s.name }, s.name)) }) })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-8", children: [" ", _jsxs("div", { className: "lg:col-span-2", children: [" ", isLoading ? (_jsx("div", { className: "text-center text-gray-500 p-12", children: _jsx("p", { children: "\u5206\u6790\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D..." }) })) : error ? (_jsx("div", { className: "text-center text-danger bg-danger/10 rounded-xl p-12", children: _jsx("p", { children: error }) })) : !analytics || analytics.total_runs === 0 ? (_jsxs("div", { className: "text-center text-gray-500 bg-white rounded-xl p-12", children: [_jsxs("p", { children: ["\u300C", selectedSubjectName, "\u300D\u306E\u7DF4\u7FD2\u5C65\u6B74\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002"] }), _jsx("p", { className: "mt-2", children: "\u30AF\u30A4\u30BA\u3092\u5B8C\u4E86\u3059\u308B\u3068\u3001\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002" })] })) : (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700 mb-4", children: "\u7DCF\u5408\u30D1\u30D5\u30A9\u30FC\u30DE\u30F3\u30B9" }), _jsxs("div", { className: "grid grid-cols-4 gap-4 text-center", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-3xl font-bold text-primary-new", children: [analytics.overall_correct_rate.toFixed(1), "%"] }), _jsx("p", { className: "text-sm text-gray-500", children: "\u5168\u4F53\u6B63\u7B54\u7387" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-primary-new", children: analytics.total_problems_in_subject }), _jsx("p", { className: "text-sm text-gray-500", children: "\u554F\u984C\u7DCF\u6570" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-primary-new", children: analytics.total_runs }), _jsx("p", { className: "text-sm text-gray-500", children: "\u7DCF\u89E3\u7B54\u6570" })] }), _jsxs("div", { children: [_jsx("p", { className: "text-3xl font-bold text-green-600", children: analytics.unanswered_problems_count }), _jsx("p", { className: "text-sm text-gray-500", children: "\u672A\u56DE\u7B54\u554F\u984C" })] })] })] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700", children: "\u4E3B\u306A\u82E6\u624B\u5206\u91CE (\u30A8\u30E9\u30FC\u6570\u9806)" }), missedCategories.length > 0 && (_jsx("button", { onClick: handleExportMissedProblems, disabled: isExporting, className: "px-3 py-1 bg-primary-new text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed", children: isExporting ? 'エクスポート中...' : 'エクスポート' }))] }), missedCategories.length > 0 ? (_jsx("ul", { className: "space-y-3", children: missedCategories.map(area => (_jsx("li", { children: _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: area.category }), _jsxs("p", { className: "text-sm font-bold text-danger", children: [area.errors, " \u56DE"] })] }) }, area.category))) })) : (_jsx("p", { className: "text-sm text-gray-500", children: "\u30DF\u30B9\u3057\u305F\u554F\u984C\u306F\u3042\u308A\u307E\u305B\u3093\u3067\u3057\u305F\uFF01" }))] }), _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700 mb-4", children: "\u6B63\u7B54\u7387\u306E\u63A8\u79FB" }), _jsx("div", { className: "h-64 pr-4 pt-2", children: trendData.length > 1 ? (_jsx("div", { className: "w-full h-full flex justify-around gap-2 items-end", children: trendData.map((d, i) => (_jsxs("div", { className: "flex-1 h-full flex flex-col justify-end items-center group", children: [_jsxs("div", { className: "text-xs font-bold text-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-200", children: [d.rate.toFixed(0), "%"] }), _jsx("div", { className: "w-full bg-blue-200 hover:bg-blue-300 transition-colors duration-200 rounded-t min-h-[2px]", style: { height: `${d.rate}%` } }), _jsx("div", { className: "text-xs text-gray-500 mt-1", children: d.date.substring(5) })] }, i))) })) : _jsx("p", { className: "text-sm text-gray-500 text-center pt-8", children: "\u30B0\u30E9\u30D5\u3092\u8868\u793A\u3059\u308B\u306B\u306F2\u65E5\u4EE5\u4E0A\u306E\u5C65\u6B74\u304C\u5FC5\u8981\u3067\u3059\u3002" }) })] })] }))] }), _jsx("div", { className: "lg:col-span-1", children: _jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700 mb-4", children: "\u65E5\u5225\u5B9F\u65BD\u5C65\u6B74" }), isDailySummaryLoading ? (_jsx("p", { className: "text-center text-gray-500", children: "\u8AAD\u307F\u8FBC\u307F\u4E2D..." })) : dailySummaryError ? (_jsx("p", { className: "text-danger text-sm text-center", children: "\u5C65\u6B74\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" })) : dailySummary.length === 0 ? (_jsx("p", { className: "text-sm text-gray-500", children: "\u65E5\u5225\u5B9F\u65BD\u5C65\u6B74\u304C\u3042\u308A\u307E\u305B\u3093\u3002" })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-100", children: _jsxs("tr", { children: [_jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u65E5\u4ED8" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u5B9F\u65BD\u6570" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u6B63\u7B54\u6570" }), _jsx("th", { scope: "col", className: "px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider", children: "\u6B63\u7B54\u7387" })] }) }), _jsx("tbody", { className: "divide-y divide-gray-200", children: dailySummary.map((item) => (_jsxs("tr", { className: "hover:bg-gray-100", children: [_jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-700", children: item.date }), _jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: item.total_questions }), _jsx("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: item.correct_count }), _jsxs("td", { className: "px-3 py-2 whitespace-nowrap text-sm text-gray-500", children: [(item.accuracy * 100).toFixed(1), "%"] })] }, item.date))) })] }) }))] }) })] })] }));
}
//# sourceMappingURL=DashboardPage.js.map