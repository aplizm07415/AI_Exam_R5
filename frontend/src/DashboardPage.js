import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import AnalysisDashboard from './AnalysisDashboard';
import PlanManagementDashboard from './PlanManagementDashboard';
const API_BASE_URL = "/api";
export default function DashboardPage({ subjects }) {
    const [selectedSubjectName, setSelectedSubjectName] = useState('');
    const [analytics, setAnalytics] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [dailySummary, setDailySummary] = useState([]);
    const [isDailySummaryLoading, setIsDailySummaryLoading] = useState(false);
    const [dailySummaryError, setDailySummaryError] = useState('');
    useEffect(() => {
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
    }, [subjects]);
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
    }, [selectedSubjectName]);
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
    if (subjects.length === 0) {
        return (_jsxs("div", { className: "text-center text-gray-400", children: [_jsx("h2", { className: "text-2xl font-bold mb-4", children: "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("p", { children: "\u79D1\u76EE\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u5148\u306B\u300C\u30C7\u30FC\u30BF\u7BA1\u7406\u300D\u30DA\u30FC\u30B8\u3067\u30C7\u30FC\u30BF\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })] }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto space-y-8", children: [_jsx(PlanManagementDashboard, { subjects: subjects }), _jsx(AnalysisDashboard, { subjects: subjects, selectedSubjectName: selectedSubjectName, setSelectedSubjectName: setSelectedSubjectName, analytics: analytics, isLoading: isLoading, error: error, dailySummary: dailySummary, isDailySummaryLoading: isDailySummaryLoading, dailySummaryError: dailySummaryError })] }));
}
//# sourceMappingURL=DashboardPage.js.map