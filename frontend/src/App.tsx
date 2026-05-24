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

interface Subject {
  name: string;
}

interface BreadcrumbItem {
  label: string;
  path?: string;
}

const API_BASE_URL = "/api";

function createParticleBurst(
  particleHost: HTMLDivElement,
  originX: number,
  originY: number,
  options?: {
    count?: number;
    scale?: number;
    hueBase?: number;
    hueJitter?: number;
    saturation?: number;
    lightness?: number;
  },
) {
  if (!document.body.animate) {
    return () => {};
  }

  const {
    count = 30,
    scale = 1,
    hueBase = 205,
    hueJitter = 12,
    saturation = 76,
    lightness = 56,
  } = options ?? {};

  const particles: HTMLElement[] = [];
  const animations: Animation[] = [];

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

    const animation = particle.animate(
      [
        {
          transform: `translate(-50%, -50%) translate(${originX}px, ${originY}px) scale(0.75)`,
          opacity: 0.98,
        },
        {
          transform: `translate(-50%, -50%) translate(${destinationX}px, ${destinationY}px) scale(0.28)`,
          opacity: 0,
        },
      ],
      {
        duration: 540 + Math.random() * 760,
        easing: 'cubic-bezier(0, .9, .57, 1)',
        delay: Math.random() * 180,
        fill: 'forwards',
      },
    );

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
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingError, setLoadingError] = useState<string>('');
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobileMenuMounted, setIsMobileMenuMounted] = useState(false);
  const [isFirstViewIntroMounted, setIsFirstViewIntroMounted] = useState(false);
  const [isFirstViewIntroOpen, setIsFirstViewIntroOpen] = useState(false);
  const introCardRef = useRef<HTMLDivElement | null>(null);
  const particleHostRef = useRef<HTMLDivElement | null>(null);
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
    { id: 'secondary-exam', path: '/secondary-exam', label: '二次', icon: <FileTextIcon className="w-5 h-5" /> },
    { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: <BarChartIcon className="w-5 h-5" /> },
    { id: 'soragaki', path: '/soragaki', label: '空描き', icon: <PencilIcon className="w-5 h-5" /> },
    { id: 'photo', path: '/photos', label: 'Photo', icon: <PhotoIcon className="w-5 h-5" /> },
    { id: 'countdown', path: '/countdown', label: '試験日', icon: <CalendarDaysIcon className="w-5 h-5" /> },
    { id: 'muscle', path: '/muscle', label: 'Muscle', icon: <DumbbellIcon className="w-5 h-5" /> },
  ], []);

  const activePath = location.pathname;
  const isNavPathActive = (path: string) => (
    path === '/'
      ? activePath === '/'
      : activePath === path || activePath.startsWith(`${path}/`)
  );
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
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

  const navParticleHues: Record<string, number> = {
    quiz: 148,
    'secondary-exam': 18,
    dashboard: 278,
    soragaki: 332,
    photo: 48,
    countdown: 96,
    muscle: 214,
  };

  const triggerNavBurst = (event: React.MouseEvent<HTMLElement>, itemId: string) => {
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

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 flex flex-col">
      <header className="bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-11 items-center justify-between gap-2 py-1.5 sm:min-h-12 sm:gap-3 sm:py-2">
            <Link to="/" className="flex min-w-0 shrink-0 items-center space-x-2 sm:space-x-3">
              <div className="rounded-lg bg-primary-new p-1.5 sm:p-2">
                <FileTextIcon className="h-5 w-5 text-white sm:h-6 sm:w-6" />
              </div>
              <h1 className="text-lg font-bold text-dark sm:text-xl">R3</h1>
            </Link>
            <nav className="priority-nav flex min-w-0 flex-1 items-center justify-end" aria-label="主要ナビゲーション">
              <button
                onClick={openMobileMenu}
                className="priority-nav__more"
                aria-label="メインメニューを開く"
                aria-expanded={isMobileMenuOpen}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main
        className={`flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-opacity duration-300 ${
          shouldDelayQuizFirstView ? 'opacity-0' : 'opacity-100'
        }`}
        aria-hidden={shouldDelayQuizFirstView ? 'true' : undefined}
      >
        {loading ? (
          <LoadingSpinner />
        ) : (
          <div key={location.pathname} className="motion-route">
            {breadcrumbItems.length > 0 ? (
              <nav aria-label="パンくずリスト" className="mb-6">
                <ol className="breadcrumb-001">
                  {breadcrumbItems.map((item, index) => (
                    <li key={`${item.label}:${index}`}>
                      {item.path && index < breadcrumbItems.length - 1 ? (
                        <Link to={item.path}>{item.label}</Link>
                      ) : (
                        <span aria-current={index === breadcrumbItems.length - 1 ? 'page' : undefined}>{item.label}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}
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
          className={`mobile-nav-overlay fixed inset-0 z-40 ${isMobileMenuOpen ? 'is-open' : ''}`}
          onClick={closeMobileMenu}
          aria-hidden="true"
        >
          <div
            className={`mobile-nav-panel fixed top-0 right-0 h-full w-full max-w-[22rem] bg-white p-6 shadow-lg ${isMobileMenuOpen ? 'is-open' : ''}`}
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
            <nav className="flex max-h-[calc(100vh-7rem)] flex-col space-y-2 overflow-y-auto pr-1">
              {navItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  onClick={(event) => {
                    triggerNavBurst(event, item.id);
                    closeMobileMenu();
                  }}
                  className={`mobile-nav-link flex items-center space-x-3 rounded-2xl px-4 py-3 text-base font-medium ${isNavPathActive(item.path)
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

      {isFirstViewIntroMounted ? (
        <div
          className={`first-view-intro fixed inset-0 z-50 ${isFirstViewIntroOpen ? 'is-open' : ''}`}
          aria-hidden="true"
        >
          <div className="first-view-intro__backdrop" />
          <div className="first-view-intro__stage">
            <div ref={introCardRef} className="first-view-intro__card">
              <div className="first-view-intro__eyebrow">Study Session</div>
              <div className="first-view-intro__title">AI Exam R3</div>
              <div className="first-view-intro__line" />
            </div>
          </div>
        </div>
      ) : null}

      <div ref={particleHostRef} className="first-view-intro__particle-host" aria-hidden="true" />
    </div>
  );
}
