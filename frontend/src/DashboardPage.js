import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useCallback } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import AnalysisDashboard from './AnalysisDashboard';
import PlanManagementDashboard from './PlanManagementDashboard';
const API_BASE_URL = "/api";
const DASHBOARD_SELECTED_SUBJECTS_KEY = 'dashboard:selectedSubjectNames';
export default function DashboardPage({ subjects }) {
    const [selectedSubjectNames, setSelectedSubjectNames] = useState(() => {
        try {
            const raw = localStorage.getItem(DASHBOARD_SELECTED_SUBJECTS_KEY);
            if (!raw)
                return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
        }
        catch {
            return [];
        }
    });
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
        if (selectedSubjectNames.length > 0) {
            setFetchParams({
                subject: selectedSubjectNames.join(','),
                startDate,
                endDate,
                category: selectedCategory,
            });
        }
    }, [selectedSubjectNames, startDate, endDate, selectedCategory]);
    useEffect(() => {
        if (subjects.length === 0) {
            setSelectedSubjectNames([]);
            setAnalytics(null);
            return;
        }
        const subjectNameSet = new Set(subjects.map((s) => s.name));
        const validSelected = selectedSubjectNames.filter((name) => subjectNameSet.has(name));
        if (validSelected.length !== selectedSubjectNames.length) {
            setSelectedSubjectNames(validSelected);
            return;
        }
        if (validSelected.length === 0) {
            const firstSubject = subjects[0];
            if (firstSubject) {
                setSelectedSubjectNames([firstSubject.name]);
            }
        }
    }, [subjects, selectedSubjectNames]);
    useEffect(() => {
        try {
            localStorage.setItem(DASHBOARD_SELECTED_SUBJECTS_KEY, JSON.stringify(selectedSubjectNames));
        }
        catch {
            // no-op
        }
    }, [selectedSubjectNames]);
    // Set initial fetch params when subject changes
    useEffect(() => {
        if (selectedSubjectNames.length > 0) {
            handleApplyFilters();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSubjectNames]);
    // Fetch categories when subject changes
    useEffect(() => {
        if (selectedSubjectNames.length > 0) {
            const fetchCategories = async () => {
                try {
                    const results = await Promise.all(selectedSubjectNames.map(async (subjectName) => {
                        const response = await fetch(`${API_BASE_URL}/subjects/${subjectName}/categories`);
                        if (!response.ok) {
                            throw new Error('カテゴリの取得に失敗しました。');
                        }
                        const data = await response.json();
                        return data;
                    }));
                    const merged = Array.from(new Set(results.flat())).sort((a, b) => a.localeCompare(b));
                    setCategories(merged);
                }
                catch (e) {
                    console.error(e);
                    setCategories([]);
                }
            };
            fetchCategories();
            setSelectedCategory(''); // Reset category on subject change
        }
    }, [selectedSubjectNames]);
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
                const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
                const suffix = query.toString();
                const response = await fetch(`${API_BASE_URL}/analytics?${subjectParams}${suffix ? `&${suffix}` : ''}`);
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
    }, [fetchParams, selectedSubjectNames]);
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
                const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
                const suffix = query.toString();
                const response = await fetch(`${API_BASE_URL}/history/daily-summary/all?${subjectParams}${suffix ? `&${suffix}` : ''}`);
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
    }, [fetchParams, selectedSubjectNames]);
    if (subjects.length === 0) {
        return (_jsxs("div", { className: "text-center text-gray-400", children: [_jsx("h2", { className: "text-2xl font-bold mb-4", children: "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("p", { children: "\u79D1\u76EE\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u5148\u306B\u300C\u30C7\u30FC\u30BF\u7BA1\u7406\u300D\u30DA\u30FC\u30B8\u3067\u30C7\u30FC\u30BF\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })] }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto space-y-8", children: [_jsx(PlanManagementDashboard, { subjects: subjects }), _jsx(AnalysisDashboard, { subjects: subjects, selectedSubjectNames: selectedSubjectNames, setSelectedSubjectNames: setSelectedSubjectNames, analytics: analytics, isLoading: isLoading, error: error, dailySummary: dailySummary, isDailySummaryLoading: isDailySummaryLoading, dailySummaryError: dailySummaryError, 
                // Filters
                startDate: startDate, setStartDate: setStartDate, endDate: endDate, setEndDate: setEndDate, categories: categories, selectedCategory: selectedCategory, setSelectedCategory: setSelectedCategory, onApplyFilters: handleApplyFilters })] }));
}
//# sourceMappingURL=DashboardPage.js.map