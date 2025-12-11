import React, { useState, useEffect, useMemo } from 'react';

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

// 新規追加: 日別集計の型定義
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

  // 新規追加: 日別集計のステート
  const [dailySummary, setDailySummary] = useState<DailySummaryItem[]>([]);
  const [isDailySummaryLoading, setIsDailySummaryLoading] = useState(false);
  const [dailySummaryError, setDailySummaryError] = useState('');
  
  // エクスポート機能のための新規ステート
  const [isExporting, setIsExporting] = useState(false);


  useEffect(() => {
    // 最初の科目を自動選択するロジック
    // 依存配列から selectedSubjectName を削除し、ユーザーの選択が上書きされないように修正
    if (subjects.length > 0 && !selectedSubjectName) {
      const firstSubject = subjects[0];
      if (firstSubject) {
        setSelectedSubjectName(firstSubject.name);
      }
    } else if (subjects.length === 0) {
      setSelectedSubjectName('');
      setAnalytics(null);
    }
  }, [subjects]); // subjects のみに依存

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
  }, [selectedSubjectName]); // selectedSubjectName が変わるたびに実行

  // 新規追加: 日別集計データの取得
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
  
  const missedCategories = useMemo(() => {
    if (!analytics?.frequently_missed_categories) return [];
    return Object.entries(analytics.frequently_missed_categories)
      .map(([category, errors]) => ({ category, errors }))
      .sort((a,b) => b.errors - a.errors)
      .slice(0, 5);
  }, [analytics]);

  const trendData = useMemo(() => {
    if (!analytics?.daily_correct_rate_trend) return [];
    return Object.entries(analytics.daily_correct_rate_trend)
        .map(([date, rate]) => ({ date, rate: rate * 100 }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [analytics]);

  const handleExportMissedProblems = async () => {
    if (!selectedSubjectName) {
      alert("科目を選択してください。");
      return;
    }
    setIsExporting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/${selectedSubjectName}/missed-problems`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || '不正解問題リストの取得に失敗しました。');
      }
      const data = await response.json();
      
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `missed_problems_${selectedSubjectName}.json`;
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

  if (subjects.length === 0) {
    return (
      <div className="text-center text-gray-400">
        <h2 className="text-2xl font-bold mb-4">ダッシュボード</h2>
        <p>科目がありません。先に「データ管理」ページでデータをアップロードしてください。</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-8 gap-4">
        <h2 className="text-3xl font-bold text-dark">分析ダッシュボード</h2>
        <div className="w-full sm:w-64">
          <select
            id="subject"
            value={selectedSubjectName}
            onChange={e => setSelectedSubjectName(e.target.value)}
            className="block w-full bg-white border border-gray-300 rounded-md shadow-sm py-2 px-3 text-dark focus:outline-none focus:ring-primary-new focus:border-primary-new"
          >
            {subjects.map(s => <option key={s.name} value={s.name}>
              {s.name}
            </option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8"> {/* グリッドレイアウト変更 */}
        <div className="lg:col-span-2"> {/* 既存の分析を広めに */}
          {isLoading ? (
            <div className="text-center text-gray-500 p-12"><p>分析データを読み込み中...</p></div>
          ) : error ? (
            <div className="text-center text-danger bg-danger/10 rounded-xl p-12"><p>{error}</p></div>
          ) : !analytics || analytics.total_runs === 0 ? (
            <div className="text-center text-gray-500 bg-white rounded-xl p-12">
              <p>「{selectedSubjectName}」の練習履歴が見つかりません。</p>
              <p className="mt-2">クイズを完了すると、ダッシュボードが表示されます。</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">総合パフォーマンス</h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.overall_correct_rate.toFixed(1)}%</p>
                    <p className="text-sm text-gray-500">全体正答率</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-primary-new">{analytics.total_runs}</p>
                    <p className="text-sm text-gray-500">総解答数</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-green-600">{analytics.unanswered_problems_count}</p>
                    <p className="text-sm text-gray-500">未回答問題</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-700">主な苦手分野 (エラー数順)</h3>
                  {missedCategories.length > 0 && (
                    <button
                      onClick={handleExportMissedProblems}
                      disabled={isExporting}
                      className="px-3 py-1 bg-primary-new text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isExporting ? 'エクスポート中...' : 'エクスポート'}
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

              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">正答率の推移</h3>
                <div className="h-64 pr-4 pt-2">
                    {trendData.length > 1 ? (
                        <div className="w-full h-full flex justify-around gap-2 items-end">
                            {trendData.map((d, i) => (
                                <div key={i} className="flex-1 h-full flex flex-col justify-end items-center group">
                                    <div className="text-xs font-bold text-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-200">{d.rate.toFixed(0)}%</div>
                                    <div className="w-full bg-blue-200 hover:bg-blue-300 transition-colors duration-200 rounded-t min-h-[2px]" style={{ height: `${d.rate}%` }}></div>
                                    <div className="text-xs text-gray-500 mt-1">{d.date.substring(5)}</div>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-sm text-gray-500 text-center pt-8">グラフを表示するには2日以上の履歴が必要です。</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 新規追加: 日別実施履歴セクション */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">日別実施履歴</h3>
            {isDailySummaryLoading ? (
              <p className="text-center text-gray-500">読み込み中...</p>
            ) : dailySummaryError ? (
              <p className="text-danger text-sm text-center">履歴が取得できませんでした。</p>
            ) : dailySummary.length === 0 ? (
              <p className="text-sm text-gray-500">日別実施履歴がありません。</p>
            ) : (
              <div className="overflow-x-auto">
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
                      <tr key={item.date} className="hover:bg-gray-100">
                        <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-700">{item.date}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{item.total_questions}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{item.correct_count}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{(item.accuracy * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}