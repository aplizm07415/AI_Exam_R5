import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import SectionHeading from './components/SectionHeading';
import AnalysisDashboard from './AnalysisDashboard';
import PlanManagementDashboard from './PlanManagementDashboard';

const API_BASE_URL = "/api";
const DASHBOARD_SELECTED_SUBJECTS_KEY = 'dashboard:selectedSubjectNames';

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

interface FetchParams {
  subject: string;
  startDate?: string;
  endDate?: string;
  category?: string;
}

export default function DashboardPage({ subjects }: DashboardPageProps) {
  const [selectedSubjectNames, setSelectedSubjectNames] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_SELECTED_SUBJECTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [dailySummary, setDailySummary] = useState<DailySummaryItem[]>([]);
  const [isDailySummaryLoading, setIsDailySummaryLoading] = useState(false);
  const [dailySummaryError, setDailySummaryError] = useState('');
  
  // Filter states
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  // State to trigger data fetching
  const [fetchParams, setFetchParams] = useState<FetchParams | null>(null);

  const handleApplyFilters = useCallback(() => {
    if (selectedSubjectNames.length > 0) {
      setFetchParams({
        subject: selectedSubjectNames.join(','),
        startDate,
        endDate,
        category: selectedCategory,
      });
    }
  }, [selectedSubjectNames, startDate, endDate, selectedCategory]);

  useEffect(() => {
    if (subjects.length === 0) {
      setSelectedSubjectNames([]);
      setAnalytics(null);
      return;
    }

    const subjectNameSet = new Set(subjects.map((s) => s.name));
    const validSelected = selectedSubjectNames.filter((name) => subjectNameSet.has(name));

    if (validSelected.length !== selectedSubjectNames.length) {
      setSelectedSubjectNames(validSelected);
      return;
    }

    if (validSelected.length === 0) {
      const firstSubject = subjects[0];
      if (firstSubject) {
        setSelectedSubjectNames([firstSubject.name]);
      }
    }
  }, [subjects, selectedSubjectNames]);

  useEffect(() => {
    try {
      localStorage.setItem(DASHBOARD_SELECTED_SUBJECTS_KEY, JSON.stringify(selectedSubjectNames));
    } catch {
      // no-op
    }
  }, [selectedSubjectNames]);

  // Set initial fetch params when subject changes
  useEffect(() => {
    if (selectedSubjectNames.length > 0) {
      handleApplyFilters();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubjectNames]);

  // Fetch categories when subject changes
  useEffect(() => {
    if (selectedSubjectNames.length > 0) {
      const fetchCategories = async () => {
        try {
          const results = await Promise.all(
            selectedSubjectNames.map(async (subjectName) => {
              const response = await fetch(`${API_BASE_URL}/subjects/${subjectName}/categories`);
              if (!response.ok) {
                throw new Error('カテゴリの取得に失敗しました。');
              }
              const data: string[] = await response.json();
              return data;
            })
          );
          const merged = Array.from(new Set(results.flat())).sort((a, b) => a.localeCompare(b));
          setCategories(merged);
        } catch (e) {
          console.error(e);
          setCategories([]);
        }
      };
      fetchCategories();
      setSelectedCategory(''); // Reset category on subject change
    }
  }, [selectedSubjectNames]);

  // Fetch analytics data when fetchParams change
  useEffect(() => {
    if (!fetchParams) return;

    const fetchAnalytics = async () => {
      setIsLoading(true);
      setError('');
      try {
        const query = new URLSearchParams();
        if (fetchParams.startDate) query.append('start_date', fetchParams.startDate);
        if (fetchParams.endDate) query.append('end_date', fetchParams.endDate);
        if (fetchParams.category) query.append('category', fetchParams.category);
        
        const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
        const suffix = query.toString();
        const response = await fetch(`${API_BASE_URL}/analytics?${subjectParams}${suffix ? `&${suffix}` : ''}`);
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
  }, [fetchParams, selectedSubjectNames]);

  // Fetch daily summary data when fetchParams change
  useEffect(() => {
    if (!fetchParams) return;

    const fetchDailySummary = async () => {
      setIsDailySummaryLoading(true);
      setDailySummaryError('');
      try {
        const query = new URLSearchParams();
        if (fetchParams.startDate) query.append('start_date', fetchParams.startDate);
        if (fetchParams.endDate) query.append('end_date', fetchParams.endDate);
        if (fetchParams.category) query.append('category', fetchParams.category);

        const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
        const suffix = query.toString();
        const response = await fetch(`${API_BASE_URL}/history/daily-summary/all?${subjectParams}${suffix ? `&${suffix}` : ''}`);
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
  }, [fetchParams, selectedSubjectNames]);

  if (subjects.length === 0) {
    return (
      <div className="motion-page text-center text-gray-400">
        <h2 className="text-2xl font-bold mb-4">ダッシュボード</h2>
        <p>科目がありません。先に「データ管理」ページでデータをアップロードしてください。</p>
      </div>
    );
  }

  return (
    <div className="motion-page max-w-7xl mx-auto space-y-8">
      <section className="motion-rise motion-delay-1 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="Dashboard"
            title="学習の全体像"
            description="進捗、分析、メモ導線をひとつの視線でたどれるように、静かな立ち上がりと軽いホバー反応だけを加えています。"
            titleClassName="text-3xl md:text-4xl text-slate-900"
            className="max-w-3xl"
            toneClassName="text-[#3d7cce]"
          />
          <div className="motion-rise motion-delay-3 grid grid-cols-2 gap-3 sm:min-w-[280px]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Subjects</div>
              <div className="mt-2 text-3xl font-bold text-slate-900">{subjects.length}</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-[#eef5fc] px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#3d7cce]">Selected</div>
              <div className="mt-2 text-3xl font-bold text-slate-900">{selectedSubjectNames.length}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="motion-rise motion-delay-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6">
          <SectionHeading
            eyebrow="Library"
            title="mymemo / 解説補足画像"
            description="一覧トップから、mymemo と解説補足画像を別ページで開けるようにしています。"
            titleClassName="text-xl text-slate-900"
          />
          <div className="flex flex-wrap gap-3">
            <Link
              to="/dashboard/custom-explanations"
              className="motion-button inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <span className="motion-button-text">一覧トップ</span>
            </Link>
            <Link
              to="/dashboard/custom-explanations/memos"
              className="motion-button inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              <span className="motion-button-text">mymemo一覧</span>
            </Link>
            <Link
              to="/dashboard/custom-explanations/images"
              className="motion-button inline-flex items-center justify-center rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-500"
            >
              <span className="motion-button-text">補足画像一覧</span>
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 px-5 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Flow</div>
              <div className="mt-3">
                <div className="heading-2 text-lg font-semibold">一覧トップ</div>
              </div>
              <p className="mt-2 text-sm leading-7 text-slate-600">まず入口ページで内容を分け、スクロール量を抑えながら移動できます。</p>
            </div>
            <div className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Memo</div>
              <div className="mt-3">
                <div className="heading-2 text-lg font-semibold">長文メモに集中</div>
              </div>
              <p className="mt-2 text-sm leading-7 text-slate-600">文章中心の確認と Markdown 出力に向いたページです。</p>
            </div>
            <div className="rounded-[1.75rem] border border-sky-100 bg-sky-50 px-5 py-5">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Images</div>
              <div className="mt-3">
                <div className="heading-2 text-lg font-semibold">画像だけを整理</div>
              </div>
              <p className="mt-2 text-sm leading-7 text-slate-600">補足画像の閲覧と PDF ダウンロードを別線にして、確認を軽くしています。</p>
            </div>
          </div>
        </div>
      </section>
      <div className="motion-rise motion-delay-3">
        <PlanManagementDashboard subjects={subjects} />
      </div>
      <div className="motion-rise motion-delay-4">
        <AnalysisDashboard
          subjects={subjects}
          selectedSubjectNames={selectedSubjectNames}
          setSelectedSubjectNames={setSelectedSubjectNames}
          analytics={analytics}
          isLoading={isLoading}
          error={error}
          dailySummary={dailySummary}
          isDailySummaryLoading={isDailySummaryLoading}
          dailySummaryError={dailySummaryError}
          // Filters
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          categories={categories}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          onApplyFilters={handleApplyFilters}
        />
      </div>
    </div>
  );
}
