import React, { useState, useEffect, useMemo } from 'react';

const API_BASE_URL = "http://127.0.0.1:8000/api";

type SubjectPersistentStatus = 'pending' | 'in_progress' | 'complete' | 'error';
interface SubjectWithStatus {
  name: string;
  analysisStatus: SubjectPersistentStatus;
}

interface DashboardPageProps {
  subjects: SubjectWithStatus[];
}

interface AnalyticsData {
  overall_correct_rate: number;
  total_runs: number;
  daily_correct_rate_trend: Record<string, number>;
  frequently_missed_categories: Record<string, number>;
  ai_top_keywords: string[];
  total_problems_in_subject: number;
  unanswered_problems_count: number;
}

interface Keyword {
  term: string;
  likelihood: string;
  description: string;
}

export default function DashboardPage({ subjects }: DashboardPageProps) {
  const [selectedSubjectName, setSelectedSubjectName] = useState<string>('');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedSubject = useMemo(() => {
    return subjects.find(s => s.name === selectedSubjectName);
  }, [subjects, selectedSubjectName]);

  useEffect(() => {
    if (subjects.length > 0 && !selectedSubjectName) {
      setSelectedSubjectName(subjects[0].name);
    } else if (subjects.length === 0) {
      setSelectedSubjectName('');
    }
  }, [subjects, selectedSubjectName]);

  useEffect(() => {
    if (!selectedSubjectName) {
      setAnalytics(null);
      setKeywords([]);
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

        if (data.ai_top_keywords) {
          const parsedKeywords = data.ai_top_keywords.map(kw_str => {
            const parts = kw_str.split(' | ');
            return {
              term: parts[0] || '',
              likelihood: parts[1] || '情報なし',
              description: parts[2] || '',
            };
          });
          setKeywords(parsedKeywords);
        } else {
          setKeywords([]);
        }

      } catch (e: any) {
        setError(e.message);
        setAnalytics(null);
        setKeywords([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
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

  const isAnalysisCompleteForSelectedSubject = selectedSubject?.analysisStatus === 'complete';

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
        <h2 className="text-3xl font-bold text-white">分析ダッシュボード</h2>
        <div className="w-full sm:w-64">
          <select
            id="subject"
            value={selectedSubjectName}
            onChange={e => setSelectedSubjectName(e.target.value)}
            className="block w-full bg-gray-800 border border-gray-700 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          >
            {subjects.map(s => <option key={s.name} value={s.name}>
              {s.name} {s.analysisStatus === 'complete' && ' (分析済)'}
                       {s.analysisStatus === 'in_progress' && ' (分析中)'}
                       {s.analysisStatus === 'error' && ' (分析エラー)'}
            </option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
         <div className="text-center text-gray-400 p-12"><p>分析データを読み込み中...</p></div>
      ) : error ? (
        <div className="text-center text-red-400 bg-red-900/20 rounded-xl p-12"><p>{error}</p></div>
      ) : !analytics || analytics.total_runs === 0 ? (
        <div className="text-center text-gray-400 bg-gray-800 rounded-xl p-12">
          <p>「{selectedSubjectName}」の練習履歴が見つかりません。</p>
          <p className="mt-2">クイズを完了すると、ダッシュボードが表示されます。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-1 space-y-8">
            <div className="bg-gray-800 rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-200 mb-4">総合パフォーマンス</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-3xl font-bold text-indigo-400">{analytics.overall_correct_rate.toFixed(1)}%</p>
                  <p className="text-sm text-gray-400">全体正答率</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-indigo-400">{analytics.total_runs}</p>
                  <p className="text-sm text-gray-400">総解答数</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-400">{analytics.unanswered_problems_count}</p>
                  <p className="text-sm text-gray-400">未回答問題</p>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-200 mb-4">正答率の推移</h3>
                <div className="h-40 pr-4 pt-2">
                    {trendData.length > 1 ? (
                        <div className="w-full h-full flex justify-around gap-2">
                            {trendData.map((d, i) => (
                                <div key={i} className="flex-1 h-full flex flex-col justify-end items-center group">
                                    <div className="text-xs font-bold text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">{d.rate.toFixed(0)}%</div>
                                    <div className="w-full bg-indigo-500/50 hover:bg-indigo-400 transition-colors duration-200 rounded-t min-h-[2px]" style={{ height: `${d.rate}%` }}></div>
                                    <div className="text-xs text-gray-500 -rotate-45">{d.date.substring(5)}</div>
                                </div>
                            ))}
                        </div>
                    ) : <p className="text-sm text-gray-500 text-center pt-8">グラフを表示するには2日以上の履歴が必要です。</p>}
                </div>
            </div>

            <div className="bg-gray-800 rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-200 mb-4">主な苦手分野 (エラー数順)</h3>
              {missedCategories.length > 0 ? (
                <ul className="space-y-3">
                  {missedCategories.map(area => (
                    <li key={area.category}>
                      <div className="flex justify-between items-center">
                        <p className="text-sm font-medium text-gray-300">{area.category}</p>
                        <p className="text-sm font-bold text-red-400">{area.errors} 回</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">ミスした問題はありませんでした！</p>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-xl shadow-lg">
              <div className="p-6 border-b border-gray-700">
                <h3 className="text-lg font-semibold text-gray-200">AIによるキーワード抽出</h3>
                <p className="text-sm text-gray-400 mt-1">AIが抽出した重要トピック（出題可能性順）</p>
              </div>
              {isAnalysisCompleteForSelectedSubject && keywords.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-gray-300">
                    <thead className="text-xs text-gray-400 uppercase bg-gray-700/50">
                      <tr>
                        <th scope="col" className="px-6 py-3">キーワード</th>
                        <th scope="col" className="px-6 py-3">説明</th>
                        <th scope="col" className="px-6 py-3 text-right">出題可能性</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keywords.map((kw, index) => (
                        <tr key={index} className="border-b border-gray-700 hover:bg-gray-700/50">
                          <th scope="row" className="px-6 py-4 font-medium text-white whitespace-nowrap">{kw.term}</th>
                          <td className="px-6 py-4">{kw.description}</td>
                          <td className="px-6 py-4 text-right">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                kw.likelihood.includes('高') ? 'bg-green-800 text-green-300' :
                                kw.likelihood.includes('中') ? 'bg-yellow-800 text-yellow-300' :
                                'bg-gray-600 text-gray-300'
                            }`}>{kw.likelihood}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500 p-6">AI分析が見つかりません。「データ管理」ページで分析を実行してください。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}