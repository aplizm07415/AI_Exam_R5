import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useCallback } from 'react';
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
    // Filter states
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    // State to trigger data fetching
    const [fetchParams, setFetchParams] = useState(null);
    const handleApplyFilters = useCallback(() => {
        if (selectedSubjectName) {
            setFetchParams({
                subject: selectedSubjectName,
                startDate,
                endDate,
                category: selectedCategory,
            });
        }
    }, [selectedSubjectName, startDate, endDate, selectedCategory]);
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
    }, [subjects, selectedSubjectName]);
    // Set initial fetch params when subject changes
    useEffect(() => {
        if (selectedSubjectName) {
            handleApplyFilters();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSubjectName]);
    // Fetch categories when subject changes
    useEffect(() => {
        if (selectedSubjectName) {
            const fetchCategories = async () => {
                try {
                    const response = await fetch(`${API_BASE_URL}/subjects/${selectedSubjectName}/categories`);
                    if (!response.ok) {
                        throw new Error('カテゴリの取得に失敗しました。');
                    }
                    const data = await response.json();
                    setCategories(data);
                }
                catch (e) {
                    console.error(e);
                    setCategories([]);
                }
            };
            fetchCategories();
            setSelectedCategory(''); // Reset category on subject change
        }
    }, [selectedSubjectName]);
    // Fetch analytics data when fetchParams change
    useEffect(() => {
        if (!fetchParams)
            return;
        const fetchAnalytics = async () => {
            setIsLoading(true);
            setError('');
            try {
                const query = new URLSearchParams();
                if (fetchParams.startDate)
                    query.append('start_date', fetchParams.startDate);
                if (fetchParams.endDate)
                    query.append('end_date', fetchParams.endDate);
                if (fetchParams.category)
                    query.append('category', fetchParams.category);
                const response = await fetch(`${API_BASE_URL}/analytics/${fetchParams.subject}?${query.toString()}`);
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
    }, [fetchParams]);
    // Fetch daily summary data when fetchParams change
    useEffect(() => {
        if (!fetchParams)
            return;
        const fetchDailySummary = async () => {
            setIsDailySummaryLoading(true);
            setDailySummaryError('');
            try {
                const query = new URLSearchParams();
                if (fetchParams.startDate)
                    query.append('start_date', fetchParams.startDate);
                if (fetchParams.endDate)
                    query.append('end_date', fetchParams.endDate);
                if (fetchParams.category)
                    query.append('category', fetchParams.category);
                const response = await fetch(`${API_BASE_URL}/history/daily-summary/${fetchParams.subject}?${query.toString()}`);
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
    }, [fetchParams]);
    if (subjects.length === 0) {
        return (_jsxs("div", { className: "text-center text-gray-400", children: [_jsx("h2", { className: "text-2xl font-bold mb-4", children: "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("p", { children: "\u79D1\u76EE\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u5148\u306B\u300C\u30C7\u30FC\u30BF\u7BA1\u7406\u300D\u30DA\u30FC\u30B8\u3067\u30C7\u30FC\u30BF\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })] }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto space-y-8", children: [_jsx(PlanManagementDashboard, { subjects: subjects }), _jsx(AnalysisDashboard, { subjects: subjects, selectedSubjectName: selectedSubjectName, setSelectedSubjectName: setSelectedSubjectName, analytics: analytics, isLoading: isLoading, error: error, dailySummary: dailySummary, isDailySummaryLoading: isDailySummaryLoading, dailySummaryError: dailySummaryError, 
                // Filters
                startDate: startDate, setStartDate: setStartDate, endDate: endDate, setEndDate: setEndDate, categories: categories, selectedCategory: selectedCategory, setSelectedCategory: setSelectedCategory, onApplyFilters: handleApplyFilters })] }));
}
//# sourceMappingURL=DashboardPage.js.map