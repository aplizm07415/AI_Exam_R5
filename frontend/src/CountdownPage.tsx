import React, { useState, useEffect, useMemo } from 'react';
import { getTodayYmdJst } from './utils/date';

const STORAGE_KEY_EXAMS = 'countdownExams';

interface Exam {
  id: number;
  name: string;
  date: string;
}

interface CountdownResult {
  totalDays: number;
  workdays: number;
  weekends: number;
}

const calculateCountdown = (targetDateStr: string): CountdownResult | null => {
  if (!targetDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(targetDateStr);
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  if (diffTime < 0) {
      return { totalDays: 0, workdays: 0, weekends: 0 };
  }
  const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  let workdays = 0;
  let weekends = 0;
  for (let i = 0; i < totalDays; i++) {
    const currentDate = new Date(today.getTime() + i * (1000 * 60 * 60 * 24));
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      weekends++;
    } else {
      workdays++;
    }
  }
  return { totalDays, workdays, weekends };
};


const CountdownItem: React.FC<{ exam: Exam; onDelete: (id: number) => void }> = ({ exam, onDelete }) => {
    const result = useMemo(() => calculateCountdown(exam.date), [exam.date]);

    if (!result) return null;
    
    const isToday = result.totalDays === 0 && new Date(exam.date).setHours(0,0,0,0) >= new Date().setHours(0,0,0,0);

    return (
        <div className="bg-gray-50 rounded-xl p-6 relative">
            <button 
                onClick={() => onDelete(exam.id)} 
                className="absolute top-3 right-3 text-gray-400 hover:text-danger transition-colors"
                title="削除"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
            <h3 className="text-lg font-semibold text-gray-800 pr-8">
                <span className="font-bold text-primary-new">{exam.name}</span> まで、あと...
            </h3>
            <div className="mt-4 text-center">
                <p className="text-6xl font-bold text-primary-new">{result.totalDays}</p>
                <p className="text-lg text-gray-600">日</p>
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                <div className="bg-info/30 p-4 rounded-lg">
                    <p className="text-3xl font-semibold text-primary">{result.workdays}</p>
                    <p className="text-sm text-secondary">平日</p>
                </div>
                <div className="bg-success/20 p-4 rounded-lg">
                    <p className="text-3xl font-semibold text-success">{result.weekends}</p>
                    <p className="text-sm text-success">休日</p>
                </div>
            </div>
            {isToday && (
                <p className="text-center mt-4 font-semibold text-lg text-danger">
                    本番当日です！頑張ってください！
                </p>
            )}
        </div>
    );
};

export default function CountdownPage() {
  const [exams, setExams] = useState<Exam[]>(() => {
    try {
      const savedExams = localStorage.getItem(STORAGE_KEY_EXAMS);
      return savedExams ? JSON.parse(savedExams) : [];
    } catch (e) {
      console.error("Failed to parse exams from localStorage", e);
      return [];
    }
  });

  const [newExamName, setNewExamName] = useState<string>('');
  const [newExamDate, setNewExamDate] = useState<string>(() => getTodayYmdJst());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_EXAMS, JSON.stringify(exams));
  }, [exams]);

  const handleAddExam = () => {
    if (!newExamName.trim() || !newExamDate) {
      alert('試験名と試験日を入力してください。');
      return;
    }
    const newExam: Exam = {
      id: Date.now(),
      name: newExamName.trim(),
      date: newExamDate,
    };
    setExams(prevExams => [...prevExams, newExam]);
    // Reset form
    setNewExamName('');
    setNewExamDate(getTodayYmdJst());
  };

  const handleDeleteExam = (id: number) => {
    if (window.confirm('この試験を削除しますか？')) {
        setExams(prevExams => prevExams.filter(exam => exam.id !== id));
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="bg-white rounded-xl shadow p-8">
        <h2 className="text-2xl font-bold text-dark mb-6">新しい試験を登録</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="new-exam-name" className="block text-sm font-medium text-gray-700 mb-1">
              試験名
            </label>
            <input
              type="text"
              id="new-exam-name"
              value={newExamName}
              onChange={(e) => setNewExamName(e.target.value)}
              className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new"
              placeholder="例: 〇〇技術者試験"
            />
          </div>
          <div>
            <label htmlFor="new-exam-date" className="block text-sm font-medium text-gray-700 mb-1">
              試験日
            </label>
            <input
              type="date"
              id="new-exam-date"
              value={newExamDate}
              onChange={(e) => setNewExamDate(e.target.value)}
              className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new"
            />
          </div>
          <div className="text-right">
            <button
              onClick={handleAddExam}
              className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-new hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-new"
            >
              登録する
            </button>
          </div>
        </div>
      </div>

      {exams.length > 0 && (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-dark">登録済み試験リスト</h2>
            {exams
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(exam => (
                    <CountdownItem key={exam.id} exam={exam} onDelete={handleDeleteExam} />
            ))}
        </div>
      )}
    </div>
  );
}
