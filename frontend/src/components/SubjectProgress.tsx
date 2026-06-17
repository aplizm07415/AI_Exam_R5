import React, { useState, useEffect } from 'react';
import LoadingSpinner from './LoadingSpinner';

const API_BASE_URL = "/api";

type QuizMode = 'random' | 'weak_area' | 'unanswered' | 'today_remaining' | 'specific_area' | 'worry_practice';

interface SubjectProgressProps {
  selectedSubjectNames: string[];
  quizMode: QuizMode;
}

interface ProgressData {
  total_problems: number;
  answered_problems: number;
  correctly_answered_once: number;
  unanswered_problems: number;
}

const SubjectProgress: React.FC<SubjectProgressProps> = ({ selectedSubjectNames, quizMode }) => {
  const [progressData, setProgressData] = useState<Record<string, ProgressData> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProgressData = async () => {
      if (quizMode === 'today_remaining' || selectedSubjectNames.length === 0) {
        setProgressData(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        selectedSubjectNames.forEach(name => params.append('subject_names', name));
        const response = await fetch(`${API_BASE_URL}/progress/subjects?${params.toString()}`);

        if (!response.ok) {
          throw new Error('Failed to fetch progress data.');
        }

        const data: Record<string, ProgressData> = await response.json();
        setProgressData(data);
      } catch (e: any) {
        setError(e.message);
        setProgressData(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProgressData();
  }, [selectedSubjectNames, quizMode]);

  if (isLoading) {
    return <div className="my-4"><LoadingSpinner /></div>;
  }

  if (error) {
    return <div className="my-4 text-center text-red-500">{error}</div>;
  }

  if (!progressData || selectedSubjectNames.length === 0 || quizMode === 'today_remaining') {
    return null;
  }

  return (
    <div className="my-6 p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-medium text-gray-900 mb-4">科目別進捗</h3>
      <div className="space-y-4">
        {selectedSubjectNames.map(subjectName => {
          const data = progressData[subjectName];
          if (!data || data.total_problems === 0) {
            return (
                <div key={subjectName}>
                    <p className="text-sm font-medium text-gray-600">{subjectName.replace('.json', '')}</p>
                    <p className="text-sm text-gray-400">進捗データがありません。</p>
                </div>
            );
          }

          const correctlyAnsweredPct = (data.correctly_answered_once / data.total_problems) * 100;
          const incorrectlyAnsweredOnly = data.answered_problems - data.correctly_answered_once;
          const incorrectlyAnsweredPct = (incorrectlyAnsweredOnly / data.total_problems) * 100;
          const unansweredPct = (data.unanswered_problems / data.total_problems) * 100;

          return (
            <div key={subjectName}>
              <p className="text-sm font-medium text-gray-800 mb-1">{subjectName.replace('.json', '')} ({data.total_problems}問)</p>
              <div className="w-full bg-gray-200 rounded-full h-4 flex overflow-hidden">
                <div
                  className="bg-green-500 h-4"
                  style={{ width: `${correctlyAnsweredPct}%` }}
                  title={`正解済み: ${data.correctly_answered_once}問 (${correctlyAnsweredPct.toFixed(1)}%)`}
                />
                <div
                  className="bg-yellow-400 h-4"
                  style={{ width: `${incorrectlyAnsweredPct}%` }}
                  title={`不正解のみ: ${incorrectlyAnsweredOnly}問 (${incorrectlyAnsweredPct.toFixed(1)}%)`}
                />
                <div
                  className="bg-gray-300 h-4"
                  style={{ width: `${unansweredPct}%` }}
                  title={`未解答: ${data.unanswered_problems}問 (${unansweredPct.toFixed(1)}%)`}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1 flex justify-between">
                <span>正解: {data.correctly_answered_once}</span>
                <span>不正解のみ: {incorrectlyAnsweredOnly}</span>
                <span>未解答: {data.unanswered_problems}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SubjectProgress;
