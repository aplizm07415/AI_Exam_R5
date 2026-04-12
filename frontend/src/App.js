import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useMemo, useEffect, useRef } from 'react';
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
function createParticleBurst(particleHost, originX, originY, options) {
    if (!document.body.animate) {
        return () => { };
    }
    const { count = 30, scale = 1, hueBase = 205, hueJitter = 12, saturation = 76, lightness = 56, } = options ?? {};
    const particles = [];
    const animations = [];
    for (let index = 0; index < count; index += 1) {
        const particle = document.createElement('span');
        particle.className = 'first-view-intro__particle';
        const size = (Math.floor(Math.random() * 22) + 8) * scale;
        const hue = hueBase + (Math.random() - 0.5) * 2 * hueJitter;
        const distance = (56 + Math.random() * 110) * scale;
        const angle = Math.random() * Math.PI * 2;
        const destinationX = originX + Math.cos(angle) * distance;
        const destinationY = originY + Math.sin(angle) * distance;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.background = `hsl(${hue} ${saturation}% ${lightness}%)`;
        particleHost.appendChild(particle);
        particles.push(particle);
        const animation = particle.animate([
            {
                transform: `translate(-50%, -50%) translate(${originX}px, ${originY}px) scale(0.75)`,
                opacity: 0.98,
            },
            {
                transform: `translate(-50%, -50%) translate(${destinationX}px, ${destinationY}px) scale(0.28)`,
                opacity: 0,
            },
        ], {
            duration: 540 + Math.random() * 760,
            easing: 'cubic-bezier(0, .9, .57, 1)',
            delay: Math.random() * 180,
            fill: 'forwards',
        });
        animation.onfinish = () => {
            particle.remove();
        };
        animations.push(animation);
    }
    return () => {
        animations.forEach((animation) => animation.cancel());
        particles.forEach((particle) => particle.remove());
    };
}
export default function App() {
    const [subjects, setSubjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingError, setLoadingError] = useState('');
    const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isMobileMenuMounted, setIsMobileMenuMounted] = useState(false);
    const [isFirstViewIntroMounted, setIsFirstViewIntroMounted] = useState(false);
    const [isFirstViewIntroOpen, setIsFirstViewIntroOpen] = useState(false);
    const introCardRef = useRef(null);
    const particleHostRef = useRef(null);
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
        { id: 'secondary-exam', path: '/secondary-exam', label: '二次', icon: _jsx(FileTextIcon, { className: "w-5 h-5" }) },
        { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: _jsx(BarChartIcon, { className: "w-5 h-5" }) },
        { id: 'soragaki', path: '/soragaki', label: '空描き', icon: _jsx(PencilIcon, { className: "w-5 h-5" }) },
        { id: 'photo', path: '/photos', label: 'Photo', icon: _jsx(PhotoIcon, { className: "w-5 h-5" }) },
        { id: 'countdown', path: '/countdown', label: '試験日', icon: _jsx(CalendarDaysIcon, { className: "w-5 h-5" }) },
        { id: 'muscle', path: '/muscle', label: 'Muscle', icon: _jsx(DumbbellIcon, { className: "w-5 h-5" }) },
    ], []);
    const activePath = location.pathname;
    const breadcrumbItems = useMemo(() => {
        if (activePath === '/') {
            return [];
        }
        if (activePath === '/portal') {
            return [{ label: 'ホーム', path: '/' }, { label: 'ポータル' }];
        }
        if (activePath === '/photos') {
            return [{ label: 'ホーム', path: '/' }, { label: '写真管理' }];
        }
        if (activePath === '/countdown') {
            return [{ label: 'ホーム', path: '/' }, { label: '試験日カウントダウン' }];
        }
        if (activePath === '/muscle') {
            return [{ label: 'ホーム', path: '/' }, { label: 'Muscle' }];
        }
        if (activePath === '/soragaki') {
            return [{ label: 'ホーム', path: '/' }, { label: '空描き' }];
        }
        if (activePath === '/secondary-exam') {
            return [{ label: 'ホーム', path: '/' }, { label: '二次試験' }];
        }
        if (activePath.startsWith('/secondary-exam/results/') && activePath.endsWith('/explanations')) {
            return [
                { label: 'ホーム', path: '/' },
                { label: '二次試験', path: '/secondary-exam' },
                { label: '採点結果' },
                { label: '解説' },
            ];
        }
        if (activePath.startsWith('/secondary-exam/results/')) {
            return [
                { label: 'ホーム', path: '/' },
                { label: '二次試験', path: '/secondary-exam' },
                { label: '採点結果' },
            ];
        }
        if (activePath === '/dashboard') {
            return [{ label: 'ホーム', path: '/' }, { label: 'ダッシュボード' }];
        }
        if (activePath === '/dashboard/custom-explanations') {
            return [
                { label: 'ホーム', path: '/' },
                { label: 'ダッシュボード', path: '/dashboard' },
                { label: 'mymemo / 解説補足画像' },
            ];
        }
        if (activePath === '/dashboard/custom-explanations/memos') {
            return [
                { label: 'ホーム', path: '/' },
                { label: 'ダッシュボード', path: '/dashboard' },
                { label: 'mymemo / 解説補足画像', path: '/dashboard/custom-explanations' },
                { label: 'mymemo一覧' },
            ];
        }
        if (activePath === '/dashboard/custom-explanations/images') {
            return [
                { label: 'ホーム', path: '/' },
                { label: 'ダッシュボード', path: '/dashboard' },
                { label: 'mymemo / 解説補足画像', path: '/dashboard/custom-explanations' },
                { label: '解説補足画像一覧' },
            ];
        }
        if (activePath === '/dashboard/review-later') {
            return [
                { label: 'ホーム', path: '/' },
                { label: 'ダッシュボード', path: '/dashboard' },
                { label: '後で確認' },
            ];
        }
        return [{ label: 'ホーム', path: '/' }];
    }, [activePath]);
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
    useEffect(() => {
        if (loading || loadingError || location.pathname !== '/') {
            return undefined;
        }
        if (typeof window === 'undefined') {
            return undefined;
        }
        const introStorageKey = 'quiz-first-view-intro-shown';
        if (window.sessionStorage.getItem(introStorageKey) === 'done') {
            return undefined;
        }
        window.sessionStorage.setItem(introStorageKey, 'done');
        setIsFirstViewIntroMounted(true);
        let openFrame = 0;
        const closeTimer = window.setTimeout(() => {
            setIsFirstViewIntroOpen(true);
        }, 920);
        const unmountTimer = window.setTimeout(() => {
            setIsFirstViewIntroMounted(false);
        }, 1820);
        openFrame = window.requestAnimationFrame(() => {
            setIsFirstViewIntroOpen(false);
        });
        return () => {
            window.cancelAnimationFrame(openFrame);
            window.clearTimeout(closeTimer);
            window.clearTimeout(unmountTimer);
        };
    }, [loading, loadingError, location.pathname]);
    useEffect(() => {
        if (!isFirstViewIntroMounted || !isFirstViewIntroOpen) {
            return undefined;
        }
        if (!document.body.animate) {
            return undefined;
        }
        const card = introCardRef.current;
        const particleHost = particleHostRef.current;
        if (!card || !particleHost) {
            return undefined;
        }
        const cardRect = card.getBoundingClientRect();
        const originX = cardRect.left + cardRect.width / 2;
        const originY = cardRect.top + cardRect.height / 2;
        return createParticleBurst(particleHost, originX, originY, {
            count: 34,
            scale: 2,
            hueBase: 205,
            hueJitter: 10,
            saturation: 78,
            lightness: 56,
        });
    }, [isFirstViewIntroMounted, isFirstViewIntroOpen]);
    const openMobileMenu = () => {
        setIsMobileMenuMounted(true);
        window.requestAnimationFrame(() => {
            setMobileMenuOpen(true);
        });
    };
    const closeMobileMenu = () => {
        setMobileMenuOpen(false);
    };
    const navParticleHues = {
        quiz: 148,
        'secondary-exam': 18,
        dashboard: 278,
        soragaki: 332,
        photo: 48,
        countdown: 96,
        muscle: 214,
    };
    const triggerNavBurst = (event, itemId) => {
        const particleHost = particleHostRef.current;
        if (!particleHost) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const originX = rect.left + rect.width / 2;
        const originY = rect.top + rect.height / 2;
        createParticleBurst(particleHost, originX, originY, {
            count: 26,
            scale: 1,
            hueBase: navParticleHues[itemId] ?? 205,
            hueJitter: 10,
            saturation: 76,
            lightness: 56,
        });
    };
    const shouldDelayQuizFirstView = location.pathname === '/' && isFirstViewIntroMounted;
    return (_jsxs("div", { className: "min-h-screen bg-gray-100 text-gray-800 flex flex-col", children: [_jsx("header", { className: "bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20", children: _jsx("div", { className: "container mx-auto px-4 sm:px-6 lg:px-8", children: _jsxs("div", { className: "flex items-center justify-between h-12", children: [_jsxs(Link, { to: "/", className: "flex items-center space-x-3", children: [_jsx("div", { className: "bg-primary-new p-2 rounded-lg", children: _jsx(FileTextIcon, { className: "w-6 h-6 text-white" }) }), _jsx("h1", { className: "text-xl font-bold text-dark", children: "R3" })] }), _jsx("nav", { className: "tab-3 hidden md:flex", children: navItems.map((item) => (_jsxs(Link, { to: item.path, onClick: (event) => triggerNavBurst(event, item.id), className: `tab-3__tab ${activePath === item.path ? 'is-active' : ''}`, "aria-current": activePath === item.path ? 'page' : undefined, children: [item.icon, _jsx("span", { children: item.label })] }, item.id))) }), _jsx("div", { className: "md:hidden", children: _jsx("button", { onClick: openMobileMenu, className: "p-2 rounded-md text-gray-700 hover:bg-gray-100", "aria-label": "\u30E1\u30A4\u30F3\u30E1\u30CB\u30E5\u30FC\u3092\u958B\u304F", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-6 w-6", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M4 6h16M4 12h16M4 18h16" }) }) }) })] }) }) }), _jsx("main", { className: `flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-opacity duration-300 ${shouldDelayQuizFirstView ? 'opacity-0' : 'opacity-100'}`, "aria-hidden": shouldDelayQuizFirstView ? 'true' : undefined, children: loading ? (_jsx(LoadingSpinner, {})) : (_jsxs("div", { className: "motion-route", children: [breadcrumbItems.length > 0 ? (_jsx("nav", { "aria-label": "\u30D1\u30F3\u304F\u305A\u30EA\u30B9\u30C8", className: "mb-6", children: _jsx("ol", { className: "breadcrumb-001", children: breadcrumbItems.map((item, index) => (_jsx("li", { children: item.path && index < breadcrumbItems.length - 1 ? (_jsx(Link, { to: item.path, children: item.label })) : (_jsx("span", { "aria-current": index === breadcrumbItems.length - 1 ? 'page' : undefined, children: item.label })) }, `${item.label}:${index}`))) }) })) : null, loadingError ? (_jsxs("div", { className: "mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700", children: [_jsx("div", { className: "font-semibold", children: "\u521D\u671F\u30C7\u30FC\u30BF\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F" }), _jsx("div", { className: "mt-1 whitespace-pre-wrap", children: loadingError }), _jsx("button", { type: "button", onClick: () => { void fetchSubjects(); }, className: "mt-3 inline-flex items-center rounded-full bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500", children: "\u518D\u8AAD\u307F\u8FBC\u307F" })] })) : null, _jsxs(Routes, { children: [_jsx(Route, { path: "/portal", element: _jsx(PortalPage, {}) }), _jsx(Route, { path: "/photos", element: _jsx(PhotoPage, {}) }), _jsx(Route, { path: "/countdown", element: _jsx(CountdownPage, {}) }), _jsx(Route, { path: "/muscle", element: _jsx(MusclePage, {}) }), _jsx(Route, { path: "/soragaki", element: _jsx(SoragakiPage, {}) }), _jsx(Route, { path: "/secondary-exam", element: _jsx(SecondaryExamPage, {}) }), _jsx(Route, { path: "/secondary-exam/results/:attemptId", element: _jsx(SecondaryExamResultPage, {}) }), _jsx(Route, { path: "/secondary-exam/results/:attemptId/explanations", element: _jsx(SecondaryExamExplanationPage, {}) }), _jsx(Route, { path: "/", element: _jsx(QuizPage, { subjects: subjects }) }), _jsx(Route, { path: "/dashboard", element: _jsx(DashboardPage, { subjects: subjects }, subjects.map(s => s.name).join(',')) }), _jsx(Route, { path: "/dashboard/custom-explanations", element: _jsx(CustomExplanationLibraryPage, { view: "hub" }) }), _jsx(Route, { path: "/dashboard/custom-explanations/memos", element: _jsx(CustomExplanationLibraryPage, { view: "memo" }) }), _jsx(Route, { path: "/dashboard/custom-explanations/images", element: _jsx(CustomExplanationLibraryPage, { view: "images" }) }), _jsx(Route, { path: "/dashboard/review-later", element: _jsx(ReviewLaterPage, {}) })] })] }, location.pathname)) }), isMobileMenuMounted && (_jsx("div", { className: `mobile-nav-overlay fixed inset-0 z-40 md:hidden ${isMobileMenuOpen ? 'is-open' : ''}`, onClick: closeMobileMenu, "aria-hidden": "true", children: _jsxs("div", { className: `mobile-nav-panel fixed top-0 right-0 h-full w-72 bg-white p-6 shadow-lg ${isMobileMenuOpen ? 'is-open' : ''}`, onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "mb-5 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.22em] text-slate-400", children: "Menu" }), _jsx("div", { className: "mt-2 text-lg font-semibold text-slate-900", children: "\u5B66\u7FD2\u30E1\u30CB\u30E5\u30FC" })] }), _jsx("button", { type: "button", onClick: closeMobileMenu, className: "rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 hover:bg-slate-50", children: "Close" })] }), _jsx("nav", { className: "flex flex-col space-y-2", children: navItems.map((item) => (_jsxs(Link, { to: item.path, onClick: (event) => {
                                    triggerNavBurst(event, item.id);
                                    closeMobileMenu();
                                }, className: `mobile-nav-link flex items-center space-x-3 rounded-2xl px-4 py-3 text-base font-medium ${activePath === item.path
                                    ? 'bg-primary-new text-white shadow-sm'
                                    : 'text-dark hover:bg-gray-100'}`, children: [item.icon, _jsx("span", { children: item.label })] }, item.id))) })] }) })), isFirstViewIntroMounted ? (_jsxs("div", { className: `first-view-intro fixed inset-0 z-50 ${isFirstViewIntroOpen ? 'is-open' : ''}`, "aria-hidden": "true", children: [_jsx("div", { className: "first-view-intro__backdrop" }), _jsx("div", { className: "first-view-intro__stage", children: _jsxs("div", { ref: introCardRef, className: "first-view-intro__card", children: [_jsx("div", { className: "first-view-intro__eyebrow", children: "Study Session" }), _jsx("div", { className: "first-view-intro__title", children: "AI Exam R3" }), _jsx("div", { className: "first-view-intro__line" })] }) })] })) : null, _jsx("div", { ref: particleHostRef, className: "first-view-intro__particle-host", "aria-hidden": "true" })] }));
}
//# sourceMappingURL=App.js.map