import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';

const API_BASE_URL = "/api";
const SUBJECT_SELECTION_PATTERNS_STORAGE_KEY = 'subjectSelectionPatterns';

interface Subject {
  name: string;
}

interface AnalyticsData {
  overall_correct_rate: number;
  total_runs: number;
  answered_problems_count: number;
  daily_correct_rate_trend: Record<string, number>;
  frequently_missed_categories: Record<string, number>;
  total_problems_in_subject: number;
  unanswered_problems_count: number;
  today_total_runs: number;
  today_correct_answers: number;
  today_mode_breakdown: {
    mode: string;
    total_runs: number;
    correct_answers: number;
    accuracy: number;
  }[];
}

interface DailySummaryItem {
  date: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
  mode_breakdown?: {
    mode: string;
    total_questions: number;
    correct_count: number;
    accuracy: number;
  }[];
}

interface SubjectSelectionPattern {
  id: string;
  name: string;
  subjectNames: string[];
  createdAt: string;
}

interface AnalysisDashboardProps {
  subjects: Subject[];
  selectedSubjectNames: string[];
  setSelectedSubjectNames: (names: string[]) => void;
  analytics: AnalyticsData | null;
  isLoading: boolean;
  error: string;
  dailySummary: DailySummaryItem[];
  isDailySummaryLoading: boolean;
  dailySummaryError: string;
  hasMoreDailySummary: boolean;
  totalDailySummaryDays: number;
  isLoadingMoreDailySummary: boolean;
  isLoadingAllDailySummary: boolean;
  onLoadMoreDailySummary: () => void;
  onLoadAllDailySummary: () => void;
  // Filters
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  categories: string[];
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  onApplyFilters: () => void;
}

interface BarTrendPoint {
  date: string;
  value: number;
  label: string;
  title: string;
  barClassName: string;
}

interface BarTrendAxisLabel {
  label: string;
  topPercent: number;
}

function loadSubjectSelectionPatterns(): SubjectSelectionPattern[] {
  try {
    const saved = localStorage.getItem(SUBJECT_SELECTION_PATTERNS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SubjectSelectionPattern => (
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        Array.isArray(item.subjectNames) &&
        item.subjectNames.every((subject: unknown) => typeof subject === 'string') &&
        typeof item.createdAt === 'string'
      ))
      .map((item) => ({
        ...item,
        subjectNames: Array.from(new Set(item.subjectNames)),
      }));
  } catch (error) {
    console.error('Failed to parse subject selection patterns from localStorage', error);
    return [];
  }
}

function BarTrendChart({
  points,
  maxValue,
  yAxisLabels,
  emptyMessage,
}: {
  points: BarTrendPoint[];
  maxValue: number;
  yAxisLabels: BarTrendAxisLabel[];
  emptyMessage: string;
}) {
  const safeMaxValue = Math.max(1, maxValue);
  const minWidth = points.length > 21 ? `${points.length * 28}px` : '100%';

  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
      <div className="flex h-56 flex-col justify-between pr-1 text-right text-xs text-gray-500">
        {yAxisLabels.map((axisLabel, index) => (
          <span key={`${axisLabel.label}-${index}`}>{axisLabel.label}</span>
        ))}
      </div>

      <div className="overflow-x-auto pb-1">
        <div style={{ minWidth }}>
          <div className="relative h-56">
            <div className="absolute inset-0">
              {yAxisLabels.map((axisLabel, index) => (
                <div
                  key={`${axisLabel.label}-${index}`}
                  className="absolute w-full border-t border-gray-200 border-dashed"
                  style={{ top: `${axisLabel.topPercent}%` }}
                />
              ))}
            </div>

            {points.length > 0 ? (
              <div className="relative z-10 flex h-full items-end justify-around gap-2 px-1">
                {points.map((point, index) => {
                  const barHeight = Math.max(0, Math.min(100, (point.value / safeMaxValue) * 100));
                  return (
                    <div key={`${point.date}-${index}`} className="group relative flex h-full flex-1 items-end justify-center">
                      <div
                        className={`relative w-full rounded-t min-h-[2px] transition-colors duration-200 print-keep-color ${point.barClassName}`}
                        style={{ height: `${barHeight}%` }}
                        title={point.title}
                      >
                        <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-secondary opacity-0 transition-opacity duration-200 pointer-events-none group-hover:opacity-100">
                          {point.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">{emptyMessage}</p>
            )}
          </div>

          {points.length > 0 && (
            <div className="mt-1 flex justify-around gap-2 px-1">
              {points.map((point, index) => (
                <div key={`${point.date}-label-${index}`} className="flex-1 text-center text-xs text-gray-500">
                  {point.date.substring(5)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AnalysisDashboard({
  subjects,
  selectedSubjectNames,
  setSelectedSubjectNames,
  analytics,
  isLoading,
  error,
  dailySummary,
  isDailySummaryLoading,
  dailySummaryError,
  hasMoreDailySummary,
  totalDailySummaryDays,
  isLoadingMoreDailySummary,
  isLoadingAllDailySummary,
  onLoadMoreDailySummary,
  onLoadAllDailySummary,
  // Filters
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  categories,
  selectedCategory,
  setSelectedCategory,
  onApplyFilters,
}: AnalysisDashboardProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [consolidatedData, setConsolidatedData] = useState<DailySummaryItem[]>([]);
  const [isConsolidatedLoading, setIsConsolidatedLoading] = useState(false);
  const [consolidatedError, setConsolidatedError] = useState('');
  const [threshold, setThreshold] = useState<number>(0);
  const [subjectSelectionPatterns, setSubjectSelectionPatterns] = useState<SubjectSelectionPattern[]>(loadSubjectSelectionPatterns);
  const [selectedSubjectPatternId, setSelectedSubjectPatternId] = useState('');
  const dailyHistoryContainerRef = useRef<HTMLDivElement | null>(null);

  const modeLabelMap: Record<string, string> = {
    random: 'ランダム',
    weak_area: '苦手',
    unanswered: '未解答',
    today_remaining: '今日の残り',
    specific_area: '特定領域',
    legacy: '旧履歴',
  };

  const fetchConsolidatedData = async () => {
    setIsConsolidatedLoading(true);
    setConsolidatedError('');
    try {
      const response = await fetch(`${API_BASE_URL}/history/daily-summary/all`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || '統合履歴の取得に失敗しました。');
      }
      const data: DailySummaryItem[] = await response.json();
      setConsolidatedData(data);
    } catch (e: any) {
      setConsolidatedError(e.message);
      setConsolidatedData([]);
    } finally {
      setIsConsolidatedLoading(false);
    }
  };

  const openConsolidatedModal = () => {
    setIsModalOpen(true);
    fetchConsolidatedData();
  };

  const missedCategories = useMemo(() => {
    if (!analytics?.frequently_missed_categories) return [];
    return Object.entries(analytics.frequently_missed_categories)
      .map(([category, errors]) => ({ category, errors }))
      .sort((a, b) => b.errors - a.errors)
      .slice(0, 5);
  }, [analytics]);

  const trendData = useMemo(() => {
    if (!analytics?.daily_correct_rate_trend) return [];
    return Object.entries(analytics.daily_correct_rate_trend)
      .map(([date, rate]) => ({ date, rate: rate * 100 }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [analytics]);

  const countTrendData = useMemo(() => {
    return [...dailySummary]
      .map((item) => ({ date: item.date, count: item.total_questions }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [dailySummary]);

  const countScale = useMemo(() => {
    const maxCount = countTrendData.reduce((max, item) => Math.max(max, item.count), 0);
    const top = Math.max(5, Math.ceil(maxCount / 5) * 5);
    const step = Math.max(1, top / 5);
    return {
      top,
      labels: Array.from({ length: 6 }, (_, index) => ({
        label: String(Math.max(0, top - step * index)),
        topPercent: index * 20,
      })),
    };
  }, [countTrendData]);

  const correctRateAxisLabels = useMemo(() => {
    return Array.from({ length: 11 }, (_, index) => ({
      label: `${100 - index * 10}%`,
      topPercent: index * 10,
    }));
  }, []);

  const rateTrendPoints = useMemo(() => {
    return trendData.map((item) => {
      const isAboveThreshold = threshold > 0 && item.rate >= threshold;
      return {
        date: item.date,
        value: item.rate,
        label: `${item.rate.toFixed(0)}%`,
        title: `${item.rate.toFixed(1)}%`,
        barClassName: isAboveThreshold ? 'bg-danger/50 hover:bg-danger' : 'bg-blue-200 hover:bg-blue-300',
      };
    });
  }, [threshold, trendData]);

  const countTrendPoints = useMemo(() => {
    return countTrendData.map((item) => ({
      date: item.date,
      value: item.count,
      label: `${item.count}問`,
      title: `${item.count}問`,
      barClassName: 'bg-emerald-200 hover:bg-emerald-300',
    }));
  }, [countTrendData]);

  const todayAccuracy = useMemo(() => {
    if (!analytics || analytics.today_total_runs === 0) return 0;
    return (analytics.today_correct_answers / analytics.today_total_runs) * 100;
  }, [analytics]);

  const subjectNameSet = useMemo(() => new Set(subjects.map((subject) => subject.name)), [subjects]);

  const subjectSelectionPatternOptions = useMemo(() => {
    return subjectSelectionPatterns.map((pattern) => ({
      ...pattern,
      availableSubjectNames: pattern.subjectNames.filter((subjectName) => subjectNameSet.has(subjectName)),
    }));
  }, [subjectNameSet, subjectSelectionPatterns]);

  useEffect(() => {
    const refreshPatterns = () => {
      setSubjectSelectionPatterns(loadSubjectSelectionPatterns());
    };

    window.addEventListener('focus', refreshPatterns);
    window.addEventListener('storage', refreshPatterns);
    return () => {
      window.removeEventListener('focus', refreshPatterns);
      window.removeEventListener('storage', refreshPatterns);
    };
  }, []);

  useEffect(() => {
    const node = dailyHistoryContainerRef.current;
    if (!node) return;

    const handleScroll = () => {
      const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (remaining < 120 && hasMoreDailySummary && !isLoadingMoreDailySummary && !isLoadingAllDailySummary) {
        onLoadMoreDailySummary();
      }
    };

    node.addEventListener('scroll', handleScroll);
    return () => node.removeEventListener('scroll', handleScroll);
  }, [hasMoreDailySummary, isLoadingAllDailySummary, isLoadingMoreDailySummary, onLoadMoreDailySummary]);

  const handleExportMissedProblems = async () => {
    if (selectedSubjectNames.length === 0) {
      alert("科目を選択してください。");
      return;
    }
    setIsExporting(true);
    try {
      const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
      const response = await fetch(`${API_BASE_URL}/analytics/export/first-missed-problems?${subjectParams}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || '不正解問題リストの取得に失敗しました。');
      }
      const data = await response.json();
      const questionCount = Array.isArray(data?.questions) ? data.questions.length : 0;
      
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `初回間違い_${questionCount}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (e: any) {
      alert(`エクスポートに失敗しました: ${e.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSubject = (name: string) => {
    setSelectedSubjectPatternId('');
    setSelectedSubjectNames(
      selectedSubjectNames.includes(name)
        ? selectedSubjectNames.filter((s) => s !== name)
        : [...selectedSubjectNames, name]
    );
  };

  const applySubjectSelectionPattern = (patternId: string) => {
    if (!patternId) {
      setSelectedSubjectPatternId('');
      return;
    }

    const pattern = subjectSelectionPatternOptions.find((item) => item.id === patternId);
    if (!pattern) {
      setSelectedSubjectPatternId('');
      return;
    }

    if (pattern.availableSubjectNames.length === 0) {
      alert('このパターンで選択できる科目がありません。');
      setSelectedSubjectPatternId('');
      return;
    }

    setSelectedSubjectNames(pattern.availableSubjectNames);
    setSelectedSubjectPatternId(pattern.id);
  };

  return (
    <>
      {/* モーダルウィンドウ */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-xl font-bold text-gray-800">統合日別履歴 (全科目)</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {isConsolidatedLoading ? (
                <LoadingSpinner />
              ) : consolidatedError ? (
                <p className="text-danger text-sm text-center">{consolidatedError}</p>
              ) : consolidatedData.length === 0 ? (
                <p className="text-sm text-gray-500 text-center">履歴がありません。</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">日付</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">総実施数</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">総正答数</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">全体正答率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {consolidatedData.map((item) => (
                      <tr key={item.date} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-800">{item.date}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{item.total_questions}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{item.correct_count}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-medium">{(item.accuracy * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex justify-end p-4 border-t">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-300">
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-bold text-dark">分析ダッシュボード</h2>
          <button onClick={openConsolidatedModal} className="px-4 py-2 bg-white border border-gray-300 text-primary-new text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50">
            統合ボード
          </button>
          <Link
            to="/dashboard/review-later"
            className="px-4 py-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm font-semibold rounded-lg shadow-sm hover:bg-amber-100"
          >
            後で確認
          </Link>
        </div>
        <div className="w-full sm:flex-1">
          <div className="flex items-center justify-between mb-2">
            <label className="heading-2 text-sm font-medium text-gray-700">対象科目（複数選択可）</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedSubjectPatternId('');
                  setSelectedSubjectNames(subjects.map((s) => s.name));
                }}
                className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                すべて選択
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedSubjectPatternId('');
                  setSelectedSubjectNames([]);
                }}
                className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                解除
              </button>
            </div>
          </div>
          <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className="heading-2 block text-xs font-medium text-gray-600">登録パターン</label>
              <select
                value={selectedSubjectPatternId}
                onChange={(event) => applySubjectSelectionPattern(event.target.value)}
                disabled={subjectSelectionPatternOptions.length === 0}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">パターンを選択</option>
                {subjectSelectionPatternOptions.map((pattern) => (
                  <option key={pattern.id} value={pattern.id}>
                    {pattern.name} ({pattern.availableSubjectNames.length})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setSubjectSelectionPatterns(loadSubjectSelectionPatterns())}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              更新
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md p-2 bg-white">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {subjects.map((s) => (
                <label key={s.name} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedSubjectNames.includes(s.name)}
                    onChange={() => toggleSubject(s.name)}
                    className="h-4 w-4 text-primary-new border-gray-300 rounded focus:ring-primary-new"
                  />
                  <span className="truncate" title={s.name}>{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* --- Filter Bar --- */}
      <div className="bg-white rounded-xl shadow p-4 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Date Range Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日付範囲</label>
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" />
              <span className="text-gray-500">~</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new" />
            </div>
          </div>
          {/* Category Filter */}
          <div>
            <label htmlFor="category-filter" className="heading-2 block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
            <select
              id="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:outline-none focus:ring-primary-new focus:border-primary-new"
            >
              <option value="">すべてのカテゴリ</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          {/* Apply Button */}
          <div className="md:justify-self-end">
            <button
              onClick={onApplyFilters}
              className="w-full md:w-auto px-6 py-2 bg-primary-new text-white font-semibold rounded-md shadow-sm hover:bg-blue-700"
            >
              適用
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="text-center text-gray-500 p-12"><LoadingSpinner /></div>
          ) : error ? (
            <div className="text-center text-danger bg-danger/10 rounded-xl p-12"><p>{error}</p></div>
          ) : !analytics || analytics.total_runs === 0 ? (
            <div className="text-center text-gray-500 bg-white rounded-xl p-12">
              <p>選択した科目の練習履歴が見つかりません。</p>
              <p className="mt-2">クイズを完了すると、ダッシュボードが表示されます。</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow p-6 print-color-graph">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">総合パフォーマンス</h3>
                <div className="grid grid-cols-2 gap-4 text-center xl:grid-cols-5">
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.overall_correct_rate.toFixed(1)}%</p>
                    <p className="text-sm text-gray-500">全体正答率</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.total_problems_in_subject}</p>
                    <p className="text-sm text-gray-500">問題総数</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.answered_problems_count}</p>
                    <p className="text-sm text-gray-500">実施済み問題</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-green-600">{analytics.unanswered_problems_count}</p>
                    <p className="text-sm text-gray-500">未解答問題</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-slate-700">{analytics.total_runs}</p>
                    <p className="text-sm text-gray-500">総回答回数</p>
                  </div>
                </div>
                <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">本日のモード別実績</p>
                      <p className="text-xs text-slate-500">選択中の科目を対象に、今日の実施数と正答数を分けて表示します。</p>
                    </div>
                    <div className="flex gap-4 text-sm text-slate-600">
                      <span>合計 {analytics.today_total_runs}問</span>
                      <span>正答 {analytics.today_correct_answers}問</span>
                      <span>正答率 {todayAccuracy.toFixed(1)}%</span>
                    </div>
                  </div>
                  {analytics.today_mode_breakdown.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">本日の履歴はまだありません。</p>
                  ) : (
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {analytics.today_mode_breakdown.map((item) => (
                        <div key={item.mode} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                          <p className="text-sm font-semibold text-slate-800">{modeLabelMap[item.mode] ?? item.mode}</p>
                          <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                            <span>実施 {item.total_runs}</span>
                            <span>正答 {item.correct_answers}</span>
                            <span>{(item.accuracy * 100).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-700">主な苦手分野 (エラー数順)</h3>
                  {missedCategories.length > 0 && (
                    <button
                      onClick={handleExportMissedProblems}
                      disabled={isExporting || selectedSubjectNames.length === 0}
                      className="px-3 py-1 bg-primary-new text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isExporting ? 'エクスポート中...' : '初回間違いJSONエクスポート'}
                    </button>
                  )}
                </div>
                {missedCategories.length > 0 ? (
                  <ul className="space-y-3">
                    {missedCategories.map(area => (
                      <li key={area.category}>
                        <div className="flex justify-between items-center">
                          <p className="text-sm font-medium text-gray-700">{area.category}</p>
                          <p className="text-sm font-bold text-danger">{area.errors} 回</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">ミスした問題はありませんでした！</p>
                )}
              </div>

              <div className="grid gap-8 xl:grid-cols-2">
                <div className="bg-white rounded-xl shadow p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-700">正答率の推移</h3>
                    <select 
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      value={threshold}
                      className="text-xs border border-gray-300 rounded-md py-1 px-2"
                    >
                      <option value={0}>閾値なし</option>
                      <option value={60}>60%</option>
                      <option value={70}>70%</option>
                      <option value={80}>80%</option>
                      <option value={90}>90%</option>
                    </select>
                  </div>
                  <BarTrendChart
                    points={rateTrendPoints}
                    maxValue={100}
                    yAxisLabels={correctRateAxisLabels}
                    emptyMessage="履歴データがありません。"
                  />
                </div>

                <div className="bg-white rounded-xl shadow p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-700">実施数の推移</h3>
                    <p className="text-xs text-gray-500">日別の実施件数</p>
                  </div>
                  <BarTrendChart
                    points={countTrendPoints}
                    maxValue={countScale.top}
                    yAxisLabels={countScale.labels}
                    emptyMessage="履歴データがありません。"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-700">日別実施履歴</h3>
                <p className="text-xs text-gray-500">{dailySummary.length} / {totalDailySummaryDays}日分を表示</p>
              </div>
              <button
                type="button"
                onClick={onLoadAllDailySummary}
                disabled={!hasMoreDailySummary || isLoadingAllDailySummary}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingAllDailySummary ? '取得中...' : '全部表示'}
              </button>
            </div>
            {isDailySummaryLoading ? (
              <LoadingSpinner />
            ) : dailySummaryError ? (
              <p className="text-danger text-sm text-center">履歴が取得できませんでした。</p>
            ) : dailySummary.length === 0 ? (
              <p className="text-sm text-gray-500">日別実施履歴がありません。</p>
            ) : (
              <div ref={dailyHistoryContainerRef} className="max-h-[32rem] overflow-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">日付</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">実施数</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">正答数</th>
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">正答率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {dailySummary.map((item) => (
                      <React.Fragment key={item.date}>
                        <tr className="hover:bg-gray-100">
                          <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-700">{item.date}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{item.total_questions}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{item.correct_count}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{(item.accuracy * 100).toFixed(1)}%</td>
                        </tr>
                        {(item.mode_breakdown ?? []).length > 0 && (
                          <tr className="bg-slate-50">
                            <td colSpan={4} className="px-3 py-2 text-xs text-slate-600">
                              <div className="flex flex-wrap gap-2">
                                {(item.mode_breakdown ?? []).map((modeItem) => (
                                  <span key={`${item.date}-${modeItem.mode}`} className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                    {modeLabelMap[modeItem.mode] ?? modeItem.mode}: 実施{modeItem.total_questions} / 正答{modeItem.correct_count}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {isLoadingMoreDailySummary && (
                  <div className="py-3 text-center text-xs text-gray-500">過去履歴を読み込み中...</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
