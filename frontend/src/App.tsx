import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import QuizPage from './QuizPage';
import DashboardPage from './DashboardPage';
import PortalPage from './PortalPage';
import CountdownPage from './CountdownPage';
import PhotoPage from './PhotoPage';
import MusclePage from './MusclePage';
import SoragakiPage from './SoragakiPage'; // Import SoragakiPage
import { BarChartIcon, FileTextIcon, CalendarDaysIcon, PencilIcon, PhotoIcon, DumbbellIcon } from './components/icons';
import LoadingSpinner from './components/LoadingSpinner';

interface Subject {
  name: string;
}

const API_BASE_URL = "/api";

export default function App() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const fetchSubjects = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/subjects`);
      if (!response.ok) {
        throw new Error("Failed to fetch subject names.");
      }
      const subjectNames: string[] = await response.json();
      const subjectObjects = subjectNames
        .filter((name) =>
          name.endsWith('.json') &&
          name !== 'plans.json' &&
          !name.startsWith('history/') &&
          !name.startsWith('custom-explanations/') &&
          !name.startsWith('soragaki/')
        )
        .map(name => ({ name }));
      setSubjects(subjectObjects.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Failed to fetch subjects:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  const navItems = useMemo(() => [
    { id: 'quiz', path: '/', label: 'Study', icon: <PencilIcon className="w-5 h-5" /> },
    { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: <BarChartIcon className="w-5 h-5" /> },
    { id: 'soragaki', path: '/soragaki', label: '空描き', icon: <PencilIcon className="w-5 h-5" /> },
    { id: 'photo', path: '/photos', label: 'Photo', icon: <PhotoIcon className="w-5 h-5" /> },
    { id: 'countdown', path: '/countdown', label: '試験日', icon: <CalendarDaysIcon className="w-5 h-5" /> },
    { id: 'muscle', path: '/muscle', label: 'Muscle', icon: <DumbbellIcon className="w-5 h-5" /> },
  ], []);

  const activePath = location.pathname;

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
                onClick={() => setMobileMenuOpen(true)}
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
          <div className="fade-in">
            <Routes>
              <Route path="/portal" element={<PortalPage />} />
              <Route path="/photos" element={<PhotoPage />} />
              <Route path="/countdown" element={<CountdownPage />} />
              <Route path="/muscle" element={<MusclePage />} />
              <Route path="/soragaki" element={<SoragakiPage />} />
              <Route path="/" element={<QuizPage subjects={subjects} />} />
              <Route path="/dashboard" element={<DashboardPage subjects={subjects} key={subjects.map(s => s.name).join(',')} />} />
            </Routes>
          </div>
        )}
      </main>

      {/* Mobile Menu Modal */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        >
          <div
            className="fixed top-0 right-0 h-full bg-white w-64 shadow-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="flex flex-col space-y-2">
              {navItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)} // リンククリックで閉じる
                  className={`flex items-center space-x-3 px-3 py-3 text-base font-medium rounded-md ${activePath === item.path
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
