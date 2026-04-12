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

interface Subject {
  name: string;
}

const API_BASE_URL = "/api";

export default function App() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingError, setLoadingError] = useState<string>('');
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
      const subjectNames: string[] = await response.json();
      const subjectObjects = subjectNames
        .filter((name) =>
          name.endsWith('.json') &&
          !name.includes('/') &&
          name !== 'plans.json' &&
          !name.startsWith('history/') &&
          !name.startsWith('custom-explanations/') &&
          !name.startsWith('soragaki/') &&
          !name.startsWith('review-later/')
        )
        .map(name => ({ name }));
      setSubjects(subjectObjects.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Failed to fetch subjects:", error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setLoadingError('科目一覧の取得がタイムアウトしました。ローカル起動中なら `http://localhost:18000/api/health` が応答するか確認してください。');
      } else if (error instanceof Error) {
        setLoadingError(error.message);
      } else {
        setLoadingError('科目一覧の取得に失敗しました。');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  const navItems = useMemo(() => [
    { id: 'quiz', path: '/', label: 'Study', icon: <PencilIcon className="w-5 h-5" /> },
    { id: 'secondary-exam', path: '/secondary-exam', label: '二次試験', icon: <FileTextIcon className="w-5 h-5" /> },
    { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: <BarChartIcon className="w-5 h-5" /> },
    { id: 'soragaki', path: '/soragaki', label: '空描き', icon: <PencilIcon className="w-5 h-5" /> },
    { id: 'photo', path: '/photos', label: 'Photo', icon: <PhotoIcon className="w-5 h-5" /> },
    { id: 'countdown', path: '/countdown', label: '試験日', icon: <CalendarDaysIcon className="w-5 h-5" /> },
    { id: 'muscle', path: '/muscle', label: 'Muscle', icon: <DumbbellIcon className="w-5 h-5" /> },
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

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 flex flex-col">
      <header className="bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-12">
            <Link to="/" className="flex items-center space-x-3">
              <div className="bg-primary-new p-2 rounded-lg">
                <FileTextIcon className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-dark">R3</h1>
            </Link>
            <nav className="hidden md:flex space-x-2 bg-gray-200 p-1 rounded-lg">
              {navItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${activePath === item.path
                    ? 'bg-primary-new text-white'
                    : 'text-dark hover:bg-blue-100 hover:text-primary-new'
                    }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
            <div className="md:hidden">
              <button
                onClick={openMobileMenu}
                className="p-2 rounded-md text-gray-700 hover:bg-gray-100"
                aria-label="メインメニューを開く"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <LoadingSpinner />
        ) : (
          <div key={location.pathname} className="motion-route">
            {loadingError ? (
              <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                <div className="font-semibold">初期データの読み込みに失敗しました</div>
                <div className="mt-1 whitespace-pre-wrap">{loadingError}</div>
                <button
                  type="button"
                  onClick={() => { void fetchSubjects(); }}
                  className="mt-3 inline-flex items-center rounded-full bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500"
                >
                  再読み込み
                </button>
              </div>
            ) : null}
            <Routes>
              <Route path="/portal" element={<PortalPage />} />
              <Route path="/photos" element={<PhotoPage />} />
              <Route path="/countdown" element={<CountdownPage />} />
              <Route path="/muscle" element={<MusclePage />} />
              <Route path="/soragaki" element={<SoragakiPage />} />
              <Route path="/secondary-exam" element={<SecondaryExamPage />} />
              <Route path="/secondary-exam/results/:attemptId" element={<SecondaryExamResultPage />} />
              <Route path="/secondary-exam/results/:attemptId/explanations" element={<SecondaryExamExplanationPage />} />
              <Route path="/" element={<QuizPage subjects={subjects} />} />
              <Route path="/dashboard" element={<DashboardPage subjects={subjects} key={subjects.map(s => s.name).join(',')} />} />
              <Route path="/dashboard/custom-explanations" element={<CustomExplanationLibraryPage view="hub" />} />
              <Route path="/dashboard/custom-explanations/memos" element={<CustomExplanationLibraryPage view="memo" />} />
              <Route path="/dashboard/custom-explanations/images" element={<CustomExplanationLibraryPage view="images" />} />
              <Route path="/dashboard/review-later" element={<ReviewLaterPage />} />
            </Routes>
          </div>
        )}
      </main>

      {/* Mobile Menu Modal */}
      {isMobileMenuMounted && (
        <div
          className={`mobile-nav-overlay fixed inset-0 z-40 md:hidden ${isMobileMenuOpen ? 'is-open' : ''}`}
          onClick={closeMobileMenu}
          aria-hidden="true"
        >
          <div
            className={`mobile-nav-panel fixed top-0 right-0 h-full w-72 bg-white p-6 shadow-lg ${isMobileMenuOpen ? 'is-open' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Menu</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">学習メニュー</div>
              </div>
              <button
                type="button"
                onClick={closeMobileMenu}
                className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <nav className="flex flex-col space-y-2">
              {navItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  onClick={closeMobileMenu}
                  className={`mobile-nav-link flex items-center space-x-3 rounded-2xl px-4 py-3 text-base font-medium ${activePath === item.path
                    ? 'bg-primary-new text-white shadow-sm'
                    : 'text-dark hover:bg-gray-100'
                    }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
