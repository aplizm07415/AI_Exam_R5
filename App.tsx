
import React, { useState, useMemo, useEffect, useRef } from 'react';
import UploadPage from './pages/UploadPage.tsx';
import QuizPage from './pages/QuizPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import { BrainCircuitIcon, FileUpIcon, LayoutDashboardIcon, LoaderIcon } from './components/icons.tsx';

type Page = 'upload' | 'quiz' | 'dashboard';
type AnalysisStatus = 'idle' | 'polling' | 'complete' | 'error'; // For currently active analysis
type SubjectPersistentStatus = 'pending' | 'in_progress' | 'complete' | 'error'; // For a subject's stored status

interface SubjectWithStatus {
  name: string;
  analysisStatus: SubjectPersistentStatus;
}

const API_BASE_URL = "http://127.0.0.1:8000/api";

export default function App() {
  const [activePage, setActivePage] = useState<Page>('upload');
  const [subjects, setSubjects] = useState<SubjectWithStatus[]>([]);
  const [currentAnalysisStatus, setCurrentAnalysisStatus] = useState<{ subject: string; status: AnalysisStatus }>({ subject: '', status: 'idle' });

  const pollingIntervalRef = useRef<number | null>(null);

  const fetchSubjects = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/subjects`);
      if (!response.ok) {
        throw new Error("Failed to fetch subject names.");
      }
      const subjectNames: string[] = await response.json();
      
      const subjectsWithStatus: SubjectWithStatus[] = await Promise.all(
        subjectNames.map(async (name) => {
          try {
            const statusResponse = await fetch(`${API_BASE_URL}/analyze/status/${name}`);
            const statusData = await statusResponse.json();
            return { name, analysisStatus: statusData.status };
          } catch (error) {
            console.error(`Failed to fetch analysis status for ${name}:`, error);
            return { name, analysisStatus: 'pending' }; // Default to pending if status fetch fails
          }
        })
      );
      setSubjects(subjectsWithStatus.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Failed to fetch subjects:", error);
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);
  
  // Analysis Polling Effect
  useEffect(() => {
    const poll = async () => {
      if (currentAnalysisStatus.status !== 'polling' || !currentAnalysisStatus.subject) return;

      try {
        const response = await fetch(`${API_BASE_URL}/analyze/status/${currentAnalysisStatus.subject}`);
        const data = await response.json();
        if (data.status === 'complete') {
          setCurrentAnalysisStatus({ subject: currentAnalysisStatus.subject, status: 'complete' });
          fetchSubjects(); //分析が完了したので科目リストを更新
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        }
      } catch (err) {
        setCurrentAnalysisStatus({ subject: currentAnalysisStatus.subject, status: 'error' });
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      }
    };

    if (currentAnalysisStatus.status === 'polling') {
      pollingIntervalRef.current = window.setInterval(poll, 5000);
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [currentAnalysisStatus]);

  const handleUploadSuccess = (newSubject: string) => {
    fetchSubjects(); // データが更新されたので、科目リストを再取得して同期する
  };

  const handleStartAnalysis = async (subject: string) => {
    setCurrentAnalysisStatus({ subject, status: 'polling' });
    try {
      const response = await fetch(`${API_BASE_URL}/analyze/${subject}`, { method: 'POST' });
      if (response.status !== 202) {
        const err = await response.json();
        throw new Error(err.detail || 'AI分析の開始に失敗しました。');
      }
    } catch (error) {
      console.error(error);
      setCurrentAnalysisStatus({ subject, status: 'error' });
    }
  };

  const renderPage = () => {
    switch (activePage) {
      case 'upload':
        return <UploadPage 
                  onUploadSuccess={handleUploadSuccess} 
                  startAnalysis={handleStartAnalysis}
                  analysisState={currentAnalysisStatus}
                />;
      case 'quiz':
        return <QuizPage subjects={subjects} />;
      case 'dashboard':
        return <DashboardPage subjects={subjects} key={subjects.map(s => s.name).join(',')} />; // keyを渡して再レンダリングを促す
      default:
        return <UploadPage 
                  onUploadSuccess={handleUploadSuccess} 
                  startAnalysis={handleStartAnalysis}
                  analysisState={currentAnalysisStatus}
                />;
    }
  };

  const navItems = useMemo(() => [
    { id: 'upload', label: 'データ管理', icon: <FileUpIcon className="w-5 h-5" /> },
    { id: 'quiz', label: '練習問題', icon: <BrainCircuitIcon className="w-5 h-5" /> },
    { id: 'dashboard', label: 'ダッシュボード', icon: <LayoutDashboardIcon className="w-5 h-5" /> },
  ], []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-700 sticky top-0 z-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="bg-indigo-500 p-2 rounded-lg">
                <BrainCircuitIcon className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-white">AI試験対策キット</h1>
              {currentAnalysisStatus.status === 'polling' && (
                <div className="flex items-center space-x-2 text-sm text-yellow-400">
                  <LoaderIcon className="w-5 h-5" />
                  <span>AI分析中: {currentAnalysisStatus.subject}...</span>
                </div>
              )}
               {currentAnalysisStatus.status === 'complete' && (
                <div className="flex items-center space-x-2 text-sm text-green-400">
                  <span>「{currentAnalysisStatus.subject}」の分析が完了しました。</span>
                </div>
              )}
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

