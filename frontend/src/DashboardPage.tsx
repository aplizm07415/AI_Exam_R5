import React, { useState, useEffect } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import AnalysisDashboard from './AnalysisDashboard';
import PlanManagementDashboard from './PlanManagementDashboard';

const API_BASE_URL = "/api";

interface Subject {
  name: string;
}

interface DashboardPageProps {
  subjects: Subject[];
}

interface AnalyticsData {
  overall_correct_rate: number;
  total_runs: number;
  daily_correct_rate_trend: Record<string, number>;
  frequently_missed_categories: Record<string, number>;
  total_problems_in_subject: number;
  unanswered_problems_count: number;
}

interface DailySummaryItem {
  date: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
}

export default function DashboardPage({ subjects }: DashboardPageProps) {
  const [selectedSubjectName, setSelectedSubjectName] = useState<string>('');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [dailySummary, setDailySummary] = useState<DailySummaryItem[]>([]);
  const [isDailySummaryLoading, setIsDailySummaryLoading] = useState(false);
  const [dailySummaryError, setDailySummaryError] = useState('');
  
  const [consolidatedData, setConsolidatedData] = useState<DailySummaryItem[]>([]);

  useEffect(() => {
    const fetchConsolidatedData = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/history/daily-summary/all`);
        if (!response.ok) {
          throw new Error('統合履歴の取得に失敗しました。');
        }
        const data: DailySummaryItem[] = await response.json();
        setConsolidatedData(data);
      } catch (e: any) {
        setConsolidatedData([]);
      }
    };
    fetchConsolidatedData();
  }, [subjects]);

  useEffect(() => {
    if (subjects.length > 0 && !selectedSubjectName) {
      const firstSubject = subjects[0];
      if (firstSubject) {
        setSelectedSubjectName(firstSubject.name);
      }
    } else if (subjects.length === 0) {
      setSelectedSubjectName('');
      setAnalytics(null);
    }
  }, [subjects]);

  useEffect(() => {
    if (!selectedSubjectName) {
      setAnalytics(null);
      return;
    }
    const fetchAnalytics = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE_URL}/analytics/${selectedSubjectName}`);
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.detail || '分析データの取得に失敗しました。');
        }
        const data: AnalyticsData = await response.json();
        setAnalytics(data);
      } catch (e: any) {
        setError(e.message);
        setAnalytics(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAnalytics();
  }, [selectedSubjectName]);

  useEffect(() => {
    if (!selectedSubjectName) {
      setDailySummary([]);
      return;
    }
    const fetchDailySummary = async () => {
      setIsDailySummaryLoading(true);
      setDailySummaryError('');
      try {
        const response = await fetch(`${API_BASE_URL}/history/daily-summary/${selectedSubjectName}`);
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.detail || '日別集計データの取得に失敗しました。');
        }
        const data: DailySummaryItem[] = await response.json();
        setDailySummary(data);
      } catch (e: any) {
        setDailySummaryError(e.message);
        setDailySummary([]);
      } finally {
        setIsDailySummaryLoading(false);
      }
    };
    fetchDailySummary();
  }, [selectedSubjectName]);

  if (subjects.length === 0) {
    return (
      <div className="text-center text-gray-400">
        <h2 className="text-2xl font-bold mb-4">ダッシュボード</h2>
        <p>科目がありません。先に「データ管理」ページでデータをアップロードしてください。</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <PlanManagementDashboard subjects={subjects} dailySummaryAll={consolidatedData} />
      <AnalysisDashboard
        subjects={subjects}
        selectedSubjectName={selectedSubjectName}
        setSelectedSubjectName={setSelectedSubjectName}
        analytics={analytics}
        isLoading={isLoading}
        error={error}
        dailySummary={dailySummary}
        isDailySummaryLoading={isDailySummaryLoading}
        dailySummaryError={dailySummaryError}
      />
    </div>
  );
}