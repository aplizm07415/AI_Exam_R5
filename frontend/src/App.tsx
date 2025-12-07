import React, { useState, useMemo, useEffect } from 'react';
import UploadPage from './UploadPage';
import QuizPage from './QuizPage';
import DashboardPage from './DashboardPage';
import { FileUpIcon, LayoutDashboardIcon, FileTextIcon } from './components/icons';

type Page = 'upload' | 'quiz' | 'dashboard';

interface Subject {
  name: string;
}

const API_BASE_URL = "/api";

export default function App() {
  const [activePage, setActivePage] = useState<Page>('upload');
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const fetchSubjects = async () => {
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
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  const handleUploadSuccess = () => {
    fetchSubjects();
  };

  const renderPage = () => {
    switch (activePage) {
      case 'upload':
        return <UploadPage onUploadSuccess={handleUploadSuccess} />;
      case 'quiz':
        return <QuizPage subjects={subjects} />;
      case 'dashboard':
        return <DashboardPage subjects={subjects} key={subjects.map(s => s.name).join(',')} />;
      default:
        return <UploadPage onUploadSuccess={handleUploadSuccess} />;
    }
  };

  const navItems = useMemo(() => [
    { id: 'upload', label: 'データ管理', icon: <FileUpIcon className="w-5 h-5" /> },
    { id: 'quiz', label: '練習問題', icon: <FileTextIcon className="w-5 h-5" /> },
    { id: 'dashboard', label: 'ダッシュボード', icon: <LayoutDashboardIcon className="w-5 h-5" /> },
  ], []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-700 sticky top-0 z-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="bg-indigo-500 p-2 rounded-lg">
                <FileTextIcon className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-white">試験対策キット</h1>
            </div>
            <nav className="hidden md:flex space-x-2 bg-gray-800 p-1 rounded-lg">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActivePage(item.id as Page)}
                  className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${
                    activePage === item.id
                      ? 'bg-indigo-500 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="fade-in">{renderPage()}</div>
      </main>
      
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 flex justify-around p-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id as Page)}
            className={`flex flex-col items-center w-full py-1 rounded-md transition-colors duration-200 ${
              activePage === item.id ? 'text-indigo-400' : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            {item.icon}
            <span className="text-xs mt-1">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="h-16 md:hidden"></div>
    </div>
  );
}