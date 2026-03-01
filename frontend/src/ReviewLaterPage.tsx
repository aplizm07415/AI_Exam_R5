import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';

const API_BASE_URL = '/api';

interface Choice {
  label: string;
  text: string;
}

interface Explanation {
  text: string;
}

interface QuizQuestion {
  id: string;
  question_text: string;
  choices: Choice[];
  answer: string;
  subject: string;
  explanation: Explanation;
  category?: string;
  image_urls?: string[];
  explanation_image_urls?: string[];
  custom_explanation?: string;
  custom_explanation_image_data_url?: string;
  custom_question_image_data_url?: string;
}

interface ReviewLaterEntry {
  subject: string;
  problem_id: string;
  created_at: string;
  updated_at: string;
  question: QuizQuestion | null;
  error?: string | null;
}

export default function ReviewLaterPage() {
  const [items, setItems] = useState<ReviewLaterEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [editingProblem, setEditingProblem] = useState<QuizQuestion | null>(null);
  const [customExplanationText, setCustomExplanationText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProblem, setIsSavingProblem] = useState(false);
  const [isSavingMemo, setIsSavingMemo] = useState(false);
  const [error, setError] = useState('');

  const fetchItems = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/review-later`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '後で振り返り一覧の取得に失敗しました。');
      }
      const data: ReviewLaterEntry[] = await response.json();
      setItems(data);
      setSelectedKey((prev) => {
        if (prev && data.some((item) => `${item.subject}::${item.problem_id}` === prev)) {
          return prev;
        }
        const first = data[0];
        return first ? `${first.subject}::${first.problem_id}` : '';
      });
    } catch (fetchError) {
      console.error(fetchError);
      setError(fetchError instanceof Error ? fetchError.message : '後で振り返り一覧の取得に失敗しました。');
      setItems([]);
      setSelectedKey('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
  }, []);

  const selectedItem = useMemo(
    () => items.find((item) => `${item.subject}::${item.problem_id}` === selectedKey) ?? null,
    [items, selectedKey]
  );

  useEffect(() => {
    if (selectedItem?.question) {
      setEditingProblem({ ...selectedItem.question });
      setCustomExplanationText(selectedItem.question.custom_explanation || '');
    } else {
      setEditingProblem(null);
      setCustomExplanationText('');
    }
  }, [selectedItem]);

  const handleProblemChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (!editingProblem) return;
    const { name, value } = event.target;
    if (name.startsWith('explanation.')) {
      const key = name.split('.')[1] as keyof Explanation;
      setEditingProblem({
        ...editingProblem,
        explanation: {
          ...editingProblem.explanation,
          [key]: value,
        },
      });
      return;
    }
    setEditingProblem({ ...editingProblem, [name]: value });
  };

  const handleChoiceChange = (index: number, field: 'label' | 'text', value: string) => {
    if (!editingProblem) return;
    const nextChoices = [...editingProblem.choices];
    const currentChoice = nextChoices[index];
    if (!currentChoice) return;
    nextChoices[index] = {
      label: field === 'label' ? value : currentChoice.label,
      text: field === 'text' ? value : currentChoice.text,
    };
    setEditingProblem({ ...editingProblem, choices: nextChoices });
  };

  const handleSaveProblem = async () => {
    if (!editingProblem) return;
    try {
      setIsSavingProblem(true);
      const {
        image_urls,
        explanation_image_urls,
        custom_explanation,
        custom_explanation_image_data_url,
        custom_question_image_data_url,
        ...payload
      } = editingProblem;
      const response = await fetch(
        `${API_BASE_URL}/subjects/${encodeURIComponent(editingProblem.subject)}/problems/${encodeURIComponent(editingProblem.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '問題の更新に失敗しました。');
      }
      const updatedProblem: QuizQuestion = await response.json();
      setItems((prev) =>
        prev.map((item) =>
          item.subject === updatedProblem.subject && item.problem_id === updatedProblem.id
            ? { ...item, question: { ...item.question, ...updatedProblem } as QuizQuestion }
            : item
        )
      );
      setEditingProblem((prev) => (prev ? { ...prev, ...updatedProblem } : prev));
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : '問題の更新に失敗しました。');
    } finally {
      setIsSavingProblem(false);
    }
  };

  const handleSaveMemo = async () => {
    if (!editingProblem) return;
    try {
      setIsSavingMemo(true);
      const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: customExplanationText,
          explanation_image_data_url: editingProblem.custom_explanation_image_data_url ?? null,
          question_image_data_url: editingProblem.custom_question_image_data_url ?? null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
      }
      setItems((prev) =>
        prev.map((item) =>
          item.subject === editingProblem.subject && item.problem_id === editingProblem.id && item.question
            ? { ...item, question: { ...item.question, custom_explanation: customExplanationText } }
            : item
        )
      );
      setEditingProblem((prev) => (prev ? { ...prev, custom_explanation: customExplanationText } : prev));
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : 'My Memo の保存に失敗しました。');
    } finally {
      setIsSavingMemo(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedItem) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/review-later/${encodeURIComponent(selectedItem.problem_id)}?subject=${encodeURIComponent(selectedItem.subject)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '登録解除に失敗しました。');
      }
      await fetchItems();
    } catch (removeError) {
      console.error(removeError);
      setError(removeError instanceof Error ? removeError.message : '登録解除に失敗しました。');
    }
  };

  const openIpadReview = () => {
    if (!selectedItem) return;
    const deepLink =
      `quizapp://quiz-review?base=${encodeURIComponent(window.location.origin)}` +
      `&subject=${encodeURIComponent(selectedItem.subject)}` +
      `&problem=${encodeURIComponent(selectedItem.problem_id)}`;
    window.location.href = deepLink;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-dark">後で振り返り</h2>
          <p className="text-sm text-gray-500 mt-1">演習中に登録した問題をまとめて見直します。</p>
        </div>
        <Link to="/dashboard" className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg shadow-sm hover:bg-gray-50">
          分析ダッシュボードへ戻る
        </Link>
      </div>

      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

      {isLoading ? (
        <LoadingSpinner />
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-sm text-gray-500">登録された問題はありません。</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="bg-white rounded-xl shadow p-4 space-y-3">
            {items.map((item) => {
              const itemKey = `${item.subject}::${item.problem_id}`;
              const active = itemKey === selectedKey;
              return (
                <button
                  key={itemKey}
                  type="button"
                  onClick={() => setSelectedKey(itemKey)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                    active ? 'border-primary-new bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="text-xs text-gray-500 truncate">{item.subject}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-800 line-clamp-2">
                    {item.question?.question_text || item.error || '問題を読み込めませんでした。'}
                  </div>
                  <div className="mt-2 text-[11px] text-gray-400">更新: {new Date(item.updated_at).toLocaleString()}</div>
                </button>
              );
            })}
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            {!selectedItem || !editingProblem ? (
              <div className="text-sm text-gray-500">表示できる問題がありません。</div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs text-gray-500">{editingProblem.subject}</div>
                    <div className="text-sm text-gray-500">問題ID: {editingProblem.id}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openIpadReview}
                      className="px-4 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700"
                    >
                      iPadアプリで開く
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove()}
                      className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
                    >
                      登録解除
                    </button>
                  </div>
                </div>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">問題データ</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">問題文</label>
                    <textarea
                      name="question_text"
                      value={editingProblem.question_text}
                      onChange={handleProblemChange}
                      rows={5}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="space-y-3">
                    {editingProblem.choices.map((choice, index) => (
                      <div key={`${choice.label}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-[100px_minmax(0,1fr)]">
                        <input
                          value={choice.label}
                          onChange={(event) => handleChoiceChange(index, 'label', event.target.value)}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={choice.text}
                          onChange={(event) => handleChoiceChange(index, 'text', event.target.value)}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">正解</label>
                      <input
                        name="answer"
                        value={editingProblem.answer}
                        onChange={handleProblemChange}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
                      <input
                        name="category"
                        value={editingProblem.category || ''}
                        onChange={handleProblemChange}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">解説</label>
                    <textarea
                      name="explanation.text"
                      value={editingProblem.explanation.text}
                      onChange={handleProblemChange}
                      rows={6}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveProblem()}
                    disabled={isSavingProblem}
                    className="px-5 py-2 rounded-md bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:bg-gray-300"
                  >
                    {isSavingProblem ? '保存中...' : '問題データを保存'}
                  </button>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">My Memo</h3>
                  <textarea
                    value={customExplanationText}
                    onChange={(event) => setCustomExplanationText(event.target.value)}
                    rows={5}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveMemo()}
                    disabled={isSavingMemo}
                    className="px-5 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    {isSavingMemo ? '保存中...' : 'My Memoを保存'}
                  </button>
                  {editingProblem.custom_question_image_data_url && (
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">問題文補足画像</div>
                      <img src={editingProblem.custom_question_image_data_url} alt="Question supplement" className="max-h-56 rounded-lg border border-gray-200 bg-gray-50" />
                    </div>
                  )}
                  {editingProblem.custom_explanation_image_data_url && (
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">解説補足画像</div>
                      <img src={editingProblem.custom_explanation_image_data_url} alt="Explanation supplement" className="max-h-56 rounded-lg border border-gray-200 bg-gray-50" />
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
