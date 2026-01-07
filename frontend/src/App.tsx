import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import QuizPage from './QuizPage';
import DashboardPage from './DashboardPage';
import PortalPage from './PortalPage';
import CountdownPage from './CountdownPage';
import { LayoutDashboardIcon, FileTextIcon, HomeIcon, CalendarDaysIcon } from './components/icons';
import LoadingSpinner from './components/LoadingSpinner';

interface Subject {
  name: string;
}

const API_BASE_URL = "/api";

export default function App() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const location = useLocation();

  const fetchSubjects = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/subjects`);
      if (!response.ok) {
        throw new Error("Failed to fetch subject names.");
      }
      const subjectNames: string[] = await response.json();
      const subjectObjects = subjectNames.map(name => ({ name }));
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
    { id: 'quiz', path: '/', label: '問題演習', icon: <FileTextIcon className="w-5 h-5" /> },
    { id: 'dashboard', path: '/dashboard', label: 'ダッシュボード', icon: <LayoutDashboardIcon className="w-5 h-5" /> },
    { id: 'countdown', path: '/countdown', label: '試験日', icon: <CalendarDaysIcon className="w-5 h-5" /> },
    { id: 'portal', path: '/portal', label: 'ポータル', icon: <HomeIcon className="w-5 h-5" /> },
  ], []);

  const activePath = location.pathname;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 flex flex-col">
      <header className="bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center space-x-3">
              <div className="bg-primary-new p-2 rounded-lg">
                <FileTextIcon className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-dark">R2</h1>
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
              <Route path="/countdown" element={<CountdownPage />} />
              <Route path="/" element={<QuizPage subjects={subjects} />} />
              <Route path="/dashboard" element={<DashboardPage subjects={subjects} key={subjects.map(s => s.name).join(',')} />} />
            </Routes>
          </div>
        )}
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around p-2">
        {navItems.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className={`flex flex-col items-center w-full py-1 rounded-md transition-colors duration-200 ${activePath === item.path ? 'text-primary-new' : 'text-dark hover:bg-gray-100'
              }`}
          >
            {item.icon}
            <span className="text-xs mt-1">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="h-16 md:hidden"></div>
    </div>
  );
}