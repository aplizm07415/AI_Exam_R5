import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import SectionHeading from './components/SectionHeading';
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
    const [hasMoreDailySummary, setHasMoreDailySummary] = useState(false);
    const [nextDailySummaryOffset, setNextDailySummaryOffset] = useState(0);
    const [totalDailySummaryDays, setTotalDailySummaryDays] = useState(0);
    const [isLoadingMoreDailySummary, setIsLoadingMoreDailySummary] = useState(false);
    const [isLoadingAllDailySummary, setIsLoadingAllDailySummary] = useState(false);
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
    const fetchDailySummaryPage = useCallback(async (options) => {
        if (!fetchParams)
            return;
        const { reset = false, loadAll = false } = options ?? {};
        const offset = reset ? 0 : (nextDailySummaryOffset ?? dailySummary.length);
        const limit = loadAll ? 366 : 30;
        if (reset) {
            setIsDailySummaryLoading(true);
        }
        else if (loadAll) {
            setIsLoadingAllDailySummary(true);
        }
        else {
            setIsLoadingMoreDailySummary(true);
        }
        setDailySummaryError('');
        try {
            const query = new URLSearchParams();
            selectedSubjectNames.forEach((s) => query.append('subjects', s));
            if (fetchParams.startDate)
                query.append('start_date', fetchParams.startDate);
            if (fetchParams.endDate)
                query.append('end_date', fetchParams.endDate);
            if (fetchParams.category)
                query.append('category', fetchParams.category);
            query.append('offset', String(offset));
            query.append('limit', String(limit));
            query.append('include_mode_breakdown', 'true');
            const response = await fetch(`${API_BASE_URL}/history/daily-summary/all/paged?${query.toString()}`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || '日別集計データの取得に失敗しました。');
            }
            const data = await response.json();
            setDailySummary((prev) => (reset ? data.items : [...prev, ...data.items]));
            setHasMoreDailySummary(data.has_more);
            setNextDailySummaryOffset(data.next_offset);
            setTotalDailySummaryDays(data.total_days);
        }
        catch (e) {
            setDailySummaryError(e.message);
            if (reset) {
                setDailySummary([]);
                setHasMoreDailySummary(false);
                setNextDailySummaryOffset(null);
                setTotalDailySummaryDays(0);
            }
        }
        finally {
            setIsDailySummaryLoading(false);
            setIsLoadingMoreDailySummary(false);
            setIsLoadingAllDailySummary(false);
        }
    }, [dailySummary.length, fetchParams, nextDailySummaryOffset, selectedSubjectNames]);
    useEffect(() => {
        if (!fetchParams)
            return;
        fetchDailySummaryPage({ reset: true });
    }, [fetchDailySummaryPage, fetchParams]);
    if (subjects.length === 0) {
        return (_jsxs("div", { className: "motion-page text-center text-gray-400", children: [_jsx("h2", { className: "text-2xl font-bold mb-4", children: "\u30C0\u30C3\u30B7\u30E5\u30DC\u30FC\u30C9" }), _jsx("p", { children: "\u79D1\u76EE\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u5148\u306B\u300C\u30C7\u30FC\u30BF\u7BA1\u7406\u300D\u30DA\u30FC\u30B8\u3067\u30C7\u30FC\u30BF\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })] }));
    }
    return (_jsxs("div", { className: "motion-page max-w-7xl mx-auto space-y-8", children: [_jsx("section", { className: "motion-rise motion-delay-1 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-8", children: _jsxs("div", { className: "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", children: [_jsx(SectionHeading, { eyebrow: "Dashboard", title: "\u5B66\u7FD2\u306E\u5168\u4F53\u50CF", description: "\u9032\u6357\u3001\u5206\u6790\u3001\u30E1\u30E2\u5C0E\u7DDA\u3092\u3072\u3068\u3064\u306E\u8996\u7DDA\u3067\u305F\u3069\u308C\u308B\u3088\u3046\u306B\u3001\u9759\u304B\u306A\u7ACB\u3061\u4E0A\u304C\u308A\u3068\u8EFD\u3044\u30DB\u30D0\u30FC\u53CD\u5FDC\u3060\u3051\u3092\u52A0\u3048\u3066\u3044\u307E\u3059\u3002", titleClassName: "text-3xl md:text-4xl text-slate-900", className: "max-w-3xl", toneClassName: "text-[#3d7cce]" }), _jsxs("div", { className: "motion-rise motion-delay-3 grid grid-cols-2 gap-3 sm:min-w-[280px]", children: [_jsxs("div", { className: "rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Subjects" }), _jsx("div", { className: "mt-2 text-3xl font-bold text-slate-900", children: subjects.length })] }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-[#eef5fc] px-4 py-4", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-[#3d7cce]", children: "Selected" }), _jsx("div", { className: "mt-2 text-3xl font-bold text-slate-900", children: selectedSubjectNames.length })] })] })] }) }), _jsx("section", { className: "motion-rise motion-delay-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm", children: _jsxs("div", { className: "flex flex-col gap-6", children: [_jsx(SectionHeading, { eyebrow: "Library", title: "mymemo / \u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF", description: "\u4E00\u89A7\u30C8\u30C3\u30D7\u304B\u3089\u3001mymemo \u3068\u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF\u3092\u5225\u30DA\u30FC\u30B8\u3067\u958B\u3051\u308B\u3088\u3046\u306B\u3057\u3066\u3044\u307E\u3059\u3002", titleClassName: "text-xl text-slate-900" }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Link, { to: "/dashboard/custom-explanations", className: "motion-button inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800", children: _jsx("span", { className: "motion-button-text", children: "\u4E00\u89A7\u30C8\u30C3\u30D7" }) }), _jsx(Link, { to: "/dashboard/custom-explanations/memos", className: "motion-button inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50", children: _jsx("span", { className: "motion-button-text", children: "mymemo\u4E00\u89A7" }) }), _jsx(Link, { to: "/dashboard/custom-explanations/images", className: "motion-button inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-500", children: _jsx("span", { className: "motion-button-text", children: "\u88DC\u8DB3\u753B\u50CF\u4E00\u89A7" }) })] }), _jsxs("div", { className: "grid gap-4 lg:grid-cols-3", children: [_jsxs("div", { className: "rounded-[1.75rem] border border-slate-200 bg-slate-50 px-5 py-5", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Flow" }), _jsx("div", { className: "mt-3", children: _jsx("div", { className: "heading-2 text-lg font-semibold", children: "\u4E00\u89A7\u30C8\u30C3\u30D7" }) }), _jsx("p", { className: "mt-2 text-sm leading-7 text-slate-600", children: "\u307E\u305A\u5165\u53E3\u30DA\u30FC\u30B8\u3067\u5185\u5BB9\u3092\u5206\u3051\u3001\u30B9\u30AF\u30ED\u30FC\u30EB\u91CF\u3092\u6291\u3048\u306A\u304C\u3089\u79FB\u52D5\u3067\u304D\u307E\u3059\u3002" })] }), _jsxs("div", { className: "rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: "Memo" }), _jsx("div", { className: "mt-3", children: _jsx("div", { className: "heading-2 text-lg font-semibold", children: "\u9577\u6587\u30E1\u30E2\u306B\u96C6\u4E2D" }) }), _jsx("p", { className: "mt-2 text-sm leading-7 text-slate-600", children: "\u6587\u7AE0\u4E2D\u5FC3\u306E\u78BA\u8A8D\u3068 Markdown \u51FA\u529B\u306B\u5411\u3044\u305F\u30DA\u30FC\u30B8\u3067\u3059\u3002" })] }), _jsxs("div", { className: "rounded-[1.75rem] border border-sky-100 bg-sky-50 px-5 py-5", children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-sky-700", children: "Images" }), _jsx("div", { className: "mt-3", children: _jsx("div", { className: "heading-2 text-lg font-semibold", children: "\u753B\u50CF\u3060\u3051\u3092\u6574\u7406" }) }), _jsx("p", { className: "mt-2 text-sm leading-7 text-slate-600", children: "\u88DC\u8DB3\u753B\u50CF\u306E\u95B2\u89A7\u3068 PDF \u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3092\u5225\u7DDA\u306B\u3057\u3066\u3001\u78BA\u8A8D\u3092\u8EFD\u304F\u3057\u3066\u3044\u307E\u3059\u3002" })] })] })] }) }), _jsx("div", { className: "motion-rise motion-delay-3", children: _jsx(PlanManagementDashboard, { subjects: subjects }) }), _jsx("div", { className: "motion-rise motion-delay-4", children: _jsx(AnalysisDashboard, { subjects: subjects, selectedSubjectNames: selectedSubjectNames, setSelectedSubjectNames: setSelectedSubjectNames, analytics: analytics, isLoading: isLoading, error: error, dailySummary: dailySummary, isDailySummaryLoading: isDailySummaryLoading, dailySummaryError: dailySummaryError, hasMoreDailySummary: hasMoreDailySummary, totalDailySummaryDays: totalDailySummaryDays, isLoadingMoreDailySummary: isLoadingMoreDailySummary, isLoadingAllDailySummary: isLoadingAllDailySummary, onLoadMoreDailySummary: () => void fetchDailySummaryPage(), onLoadAllDailySummary: () => void fetchDailySummaryPage({ loadAll: true }), 
                    // Filters
                    startDate: startDate, setStartDate: setStartDate, endDate: endDate, setEndDate: setEndDate, categories: categories, selectedCategory: selectedCategory, setSelectedCategory: setSelectedCategory, onApplyFilters: handleApplyFilters }) })] }));
}
//# sourceMappingURL=DashboardPage.js.map