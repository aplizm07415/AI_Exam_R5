import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import QuizPage from './QuizPage';
import DashboardPage from './DashboardPage';
import CustomExplanationLibraryPage from './CustomExplanationLibraryPage';
import ReviewLaterPage from './ReviewLaterPage';
import PortalPage from './PortalPage';
import CountdownPage from './CountdownPage';
import PhotoPage from './PhotoPage';
import MusclePage from './MusclePage';
import SoragakiPage from './SoragakiPage'; // Import SoragakiPage
import SecondaryExamPage from './SecondaryExamPage';
import SecondaryExamResultPage from './SecondaryExamResultPage';
import SecondaryExamExplanationPage from './SecondaryExamExplanationPage';
import { BarChartIcon, FileTextIcon, CalendarDaysIcon, PencilIcon, PhotoIcon, DumbbellIcon } from './components/icons';
import LoadingSpinner from './components/LoadingSpinner';
const API_BASE_URL = "/api";
export default function App() {
    const [subjects, setSubjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingError, setLoadingError] = useState('');
    const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isMobileMenuMounted, setIsMobileMenuMounted] = useState(false);
    const location = useLocation();
    const fetchSubjects = async () => {
        setLoading(true);
        setLoadingError('');
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(`${API_BASE_URL}/subjects`, {
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`/api/subjects の取得に失敗しました。status=${response.status}`);
            }
            const subjectNames = await response.json();
            const subjectObjects = subjectNames
                .filter((name) => name.endsWith('.json') &&
                !name.includes('/') &&
                name !== 'plans.json' &&
                !name.startsWith('history/') &&
                !name.startsWith('custom-explanations/') &&
                !name.startsWith('soragaki/') &&
                !name.startsWith('review-later/'))
                .map(name => ({ name }));
            setSubjects(subjectObjects.sort((a, b) => a.name.localeCompare(b.name)));
        }
        catch (error) {
            console.error("Failed to fetch subjects:", error);
            if (error instanceof DOMException && error.name === 'AbortError') {
                setLoadingError('科目一覧の取得がタイムアウトしました。ローカル起動中なら `http://localhost:18000/api/health` が応答するか確認してください。');
            }
            else if (error instanceof Error) {
                setLoadingError(error.message);
            }
            else {
                setLoadingError('科目一覧の取得に失敗しました。');
            }
        }
        finally {
            window.clearTimeout(timeoutId);
            setLoading(false);
        }
    };
    useEffect(() => {
        fetchSubjects();
    }, []);
    const navItems = useMemo(() => [
        { id: 'quiz', path: '/', label: 'Study', icon: _jsx(PencilIcon, { className: "w-5 h-5" }) },
        { id: 'secondary-exam', path: '/secondary-exam', label: '二次試験', icon: _jsx(FileTextIcon, { className: "w-5 h-5" }) },
        { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: _jsx(BarChartIcon, { className: "w-5 h-5" }) },
        { id: 'soragaki', path: '/soragaki', label: '空描き', icon: _jsx(PencilIcon, { className: "w-5 h-5" }) },
        { id: 'photo', path: '/photos', label: 'Photo', icon: _jsx(PhotoIcon, { className: "w-5 h-5" }) },
        { id: 'countdown', path: '/countdown', label: '試験日', icon: _jsx(CalendarDaysIcon, { className: "w-5 h-5" }) },
        { id: 'muscle', path: '/muscle', label: 'Muscle', icon: _jsx(DumbbellIcon, { className: "w-5 h-5" }) },
    ], []);
    const activePath = location.pathname;
    useEffect(() => {
        if (isMobileMenuOpen) {
            setIsMobileMenuMounted(true);
            return undefined;
        }
        if (!isMobileMenuMounted) {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => {
            setIsMobileMenuMounted(false);
        }, 240);
        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [isMobileMenuOpen, isMobileMenuMounted]);
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);
    const openMobileMenu = () => {
        setIsMobileMenuMounted(true);
        window.requestAnimationFrame(() => {
            setMobileMenuOpen(true);
        });
    };
    const closeMobileMenu = () => {
        setMobileMenuOpen(false);
    };
    return (_jsxs("div", { className: "min-h-screen bg-gray-100 text-gray-800 flex flex-col", children: [_jsx("header", { className: "bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20", children: _jsx("div", { className: "container mx-auto px-4 sm:px-6 lg:px-8", children: _jsxs("div", { className: "flex items-center justify-between h-12", children: [_jsxs(Link, { to: "/", className: "flex items-center space-x-3", children: [_jsx("div", { className: "bg-primary-new p-2 rounded-lg", children: _jsx(FileTextIcon, { className: "w-6 h-6 text-white" }) }), _jsx("h1", { className: "text-xl font-bold text-dark", children: "R3" })] }), _jsx("nav", { className: "hidden md:flex space-x-2 bg-gray-200 p-1 rounded-lg", children: navItems.map((item) => (_jsxs(Link, { to: item.path, className: `flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${activePath === item.path
                                        ? 'bg-primary-new text-white'
                                        : 'text-dark hover:bg-blue-100 hover:text-primary-new'}`, children: [item.icon, _jsx("span", { children: item.label })] }, item.id))) }), _jsx("div", { className: "md:hidden", children: _jsx("button", { onClick: openMobileMenu, className: "p-2 rounded-md text-gray-700 hover:bg-gray-100", "aria-label": "\u30E1\u30A4\u30F3\u30E1\u30CB\u30E5\u30FC\u3092\u958B\u304F", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-6 w-6", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M4 6h16M4 12h16M4 18h16" }) }) }) })] }) }) }), _jsx("main", { className: "flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8", children: loading ? (_jsx(LoadingSpinner, {})) : (_jsxs("div", { className: "motion-route", children: [loadingError ? (_jsxs("div", { className: "mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700", children: [_jsx("div", { className: "font-semibold", children: "\u521D\u671F\u30C7\u30FC\u30BF\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F" }), _jsx("div", { className: "mt-1 whitespace-pre-wrap", children: loadingError }), _jsx("button", { type: "button", onClick: () => { void fetchSubjects(); }, className: "mt-3 inline-flex items-center rounded-full bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500", children: "\u518D\u8AAD\u307F\u8FBC\u307F" })] })) : null, _jsxs(Routes, { children: [_jsx(Route, { path: "/portal", element: _jsx(PortalPage, {}) }), _jsx(Route, { path: "/photos", element: _jsx(PhotoPage, {}) }), _jsx(Route, { path: "/countdown", element: _jsx(CountdownPage, {}) }), _jsx(Route, { path: "/muscle", element: _jsx(MusclePage, {}) }), _jsx(Route, { path: "/soragaki", element: _jsx(SoragakiPage, {}) }), _jsx(Route, { path: "/secondary-exam", element: _jsx(SecondaryExamPage, {}) }), _jsx(Route, { path: "/secondary-exam/results/:attemptId", element: _jsx(SecondaryExamResultPage, {}) }), _jsx(Route, { path: "/secondary-exam/results/:attemptId/explanations", element: _jsx(SecondaryExamExplanationPage, {}) }), _jsx(Route, { path: "/", element: _jsx(QuizPage, { subjects: subjects }) }), _jsx(Route, { path: "/dashboard", element: _jsx(DashboardPage, { subjects: subjects }, subjects.map(s => s.name).join(',')) }), _jsx(Route, { path: "/dashboard/custom-explanations", element: _jsx(CustomExplanationLibraryPage, { view: "hub" }) }), _jsx(Route, { path: "/dashboard/custom-explanations/memos", element: _jsx(CustomExplanationLibraryPage, { view: "memo" }) }), _jsx(Route, { path: "/dashboard/custom-explanations/images", element: _jsx(CustomExplanationLibraryPage, { view: "images" }) }), _jsx(Route, { path: "/dashboard/review-later", element: _jsx(ReviewLaterPage, {}) })] })] }, location.pathname)) }), isMobileMenuMounted && (_jsx("div", { className: `mobile-nav-overlay fixed inset-0 z-40 md:hidden ${isMobileMenuOpen ? 'is-open' : ''}`, onClick: closeMobileMenu, "aria-hidden": "true", children: _jsxs("div", { className: `mobile-nav-panel fixed top-0 right-0 h-full w-72 bg-white p-6 shadow-lg ${isMobileMenuOpen ? 'is-open' : ''}`, onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "mb-5 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.22em] text-slate-400", children: "Menu" }), _jsx("div", { className: "mt-2 text-lg font-semibold text-slate-900", children: "\u5B66\u7FD2\u30E1\u30CB\u30E5\u30FC" })] }), _jsx("button", { type: "button", onClick: closeMobileMenu, className: "rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 hover:bg-slate-50", children: "Close" })] }), _jsx("nav", { className: "flex flex-col space-y-2", children: navItems.map((item) => (_jsxs(Link, { to: item.path, onClick: closeMobileMenu, className: `mobile-nav-link flex items-center space-x-3 rounded-2xl px-4 py-3 text-base font-medium ${activePath === item.path
                                    ? 'bg-primary-new text-white shadow-sm'
                                    : 'text-dark hover:bg-gray-100'}`, children: [item.icon, _jsx("span", { children: item.label })] }, item.id))) })] }) }))] }));
}
//# sourceMappingURL=App.js.map