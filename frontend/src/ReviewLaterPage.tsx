import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  custom_explanation_image_data_url?: string | undefined;
  custom_question_image_data_url?: string | undefined;
}

interface ReviewLaterEntry {
  subject: string;
  problem_id: string;
  created_at: string;
  updated_at: string;
  question: QuizQuestion | null;
  error?: string | null;
}

type OralVivaStep = 'root' | 'refute' | 'apply' | 'summary';
interface OralVivaMessage {
  role: 'assistant' | 'user';
  content: string;
}
interface OralVivaScores {
  logicality: number;
  specificity: number;
  reproducibility: number;
}
interface OralVivaResponse {
  step: OralVivaStep;
  assistant_message: string;
  scores: OralVivaScores;
  is_final_step: boolean;
  improvement_points: string[];
  mini_quiz_question?: string | null;
  mini_quiz_answer?: string | null;
  memo_summary?: string | null;
}

export default function ReviewLaterPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ReviewLaterEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [editingProblem, setEditingProblem] = useState<QuizQuestion | null>(null);
  const [customExplanationText, setCustomExplanationText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProblem, setIsSavingProblem] = useState(false);
  const [isSavingMemo, setIsSavingMemo] = useState(false);
  const [isFindingSimilar, setIsFindingSimilar] = useState(false);
  const [similarTopics, setSimilarTopics] = useState<string[]>([]);
  const [isOralVivaActive, setIsOralVivaActive] = useState(false);
  const [oralVivaStepIndex, setOralVivaStepIndex] = useState(0);
  const [oralVivaMessages, setOralVivaMessages] = useState<OralVivaMessage[]>([]);
  const [oralVivaInput, setOralVivaInput] = useState('');
  const [oralVivaScores, setOralVivaScores] = useState<OralVivaScores>({ logicality: 0, specificity: 0, reproducibility: 0 });
  const [oralVivaResult, setOralVivaResult] = useState<{
    improvementPoints: string[];
    miniQuizQuestion: string;
    miniQuizAnswer: string;
  } | null>(null);
  const [isOralVivaLoading, setIsOralVivaLoading] = useState(false);
  const [error, setError] = useState('');
  const oralVivaSteps: OralVivaStep[] = ['root', 'refute', 'apply', 'summary'];
  const oralVivaStepLabels: Record<OralVivaStep, string> = { root: '根拠', refute: '反証', apply: '応用', summary: '要約' };

  const fetchItems = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/review-later`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '後で確認一覧の取得に失敗しました。');
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
      setError(fetchError instanceof Error ? fetchError.message : '後で確認一覧の取得に失敗しました。');
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
    setIsOralVivaActive(false);
    setOralVivaStepIndex(0);
    setOralVivaMessages([]);
    setOralVivaInput('');
    setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
    setOralVivaResult(null);
    setIsOralVivaLoading(false);
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
            ? {
                ...item,
                question: {
                  ...item.question,
                  custom_explanation: customExplanationText,
                  custom_explanation_image_data_url: editingProblem.custom_explanation_image_data_url,
                  custom_question_image_data_url: editingProblem.custom_question_image_data_url,
                },
              }
            : item
        )
      );
      setEditingProblem((prev) =>
        prev
          ? {
              ...prev,
              custom_explanation: customExplanationText,
              custom_explanation_image_data_url: prev.custom_explanation_image_data_url,
              custom_question_image_data_url: prev.custom_question_image_data_url,
            }
          : prev
      );
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : 'My Memo の保存に失敗しました。');
    } finally {
      setIsSavingMemo(false);
    }
  };

  const saveMemoText = async (text: string) => {
    if (!editingProblem) return;
    const response = await fetch(`${API_BASE_URL}/problems/${encodeURIComponent(editingProblem.id)}/custom-explanation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        explanation_image_data_url: editingProblem.custom_explanation_image_data_url ?? null,
        question_image_data_url: editingProblem.custom_question_image_data_url ?? null,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail || 'My Memo の保存に失敗しました。');
    }
  };

  const startOralViva = async () => {
    if (!editingProblem || isOralVivaLoading) return;
    setIsOralVivaLoading(true);
    setError('');
    setIsOralVivaActive(true);
    setOralVivaStepIndex(0);
    setOralVivaMessages([]);
    setOralVivaResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'root',
          question: {
            problem_id: editingProblem.id,
            question_text: editingProblem.question_text,
            explanation_text: editingProblem.explanation.text || '',
            correct_answer: editingProblem.answer,
            selected_answer: null,
            was_correct: null,
          },
          conversation: [],
          user_message: '',
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || '口頭試問の開始に失敗しました。');
      }
      const payload: OralVivaResponse = await res.json();
      setOralVivaMessages([{ role: 'assistant', content: payload.assistant_message }]);
      setOralVivaScores(payload.scores);
    } catch (e) {
      setError(e instanceof Error ? e.message : '口頭試問の開始に失敗しました。');
      setIsOralVivaActive(false);
    } finally {
      setIsOralVivaLoading(false);
    }
  };

  const submitOralViva = async () => {
    if (!editingProblem || !isOralVivaActive || isOralVivaLoading) return;
    const message = oralVivaInput.trim();
    if (!message) return;
    const step = oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)] as OralVivaStep;
    const userTurn: OralVivaMessage = { role: 'user', content: message };
    setOralVivaInput('');
    setOralVivaMessages((prev) => [...prev, userTurn]);
    setIsOralVivaLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          question: {
            problem_id: editingProblem.id,
            question_text: editingProblem.question_text,
            explanation_text: editingProblem.explanation.text || '',
            correct_answer: editingProblem.answer,
            selected_answer: null,
            was_correct: null,
          },
          conversation: [...oralVivaMessages, userTurn],
          user_message: message,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || '口頭試問の送信に失敗しました。');
      }
      const payload: OralVivaResponse = await res.json();
      setOralVivaMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
      setOralVivaScores(payload.scores);
      if (payload.is_final_step) {
        setOralVivaResult({
          improvementPoints: payload.improvement_points ?? [],
          miniQuizQuestion: payload.mini_quiz_question ?? '',
          miniQuizAnswer: payload.mini_quiz_answer ?? '',
        });
        if (payload.memo_summary && payload.memo_summary.trim()) {
          const appended = customExplanationText.trim()
            ? `${customExplanationText.trim()}\n\n---\n\n【口頭試問まとめ】\n${payload.memo_summary.trim()}`
            : `【口頭試問まとめ】\n${payload.memo_summary.trim()}`;
          setCustomExplanationText(appended);
          await saveMemoText(appended);
        }
      } else {
        setOralVivaStepIndex((prev) => Math.min(prev + 1, oralVivaSteps.length - 1));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '口頭試問の送信に失敗しました。');
    } finally {
      setIsOralVivaLoading(false);
    }
  };

  const skipToSummary = async () => {
    if (!editingProblem || !isOralVivaActive || isOralVivaLoading) return;
    const userTurn: OralVivaMessage = { role: 'user', content: 'ここまでの内容を要約して終了してください。' };
    setOralVivaStepIndex(oralVivaSteps.length - 1);
    setOralVivaMessages((prev) => [...prev, userTurn]);
    setIsOralVivaLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'summary',
          question: {
            problem_id: editingProblem.id,
            question_text: editingProblem.question_text,
            explanation_text: editingProblem.explanation.text || '',
            correct_answer: editingProblem.answer,
            selected_answer: null,
            was_correct: null,
          },
          conversation: [...oralVivaMessages, userTurn],
          user_message: userTurn.content,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || '要約生成に失敗しました。');
      }
      const payload: OralVivaResponse = await res.json();
      setOralVivaMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
      setOralVivaScores(payload.scores);
      setOralVivaResult({
        improvementPoints: payload.improvement_points ?? [],
        miniQuizQuestion: payload.mini_quiz_question ?? '',
        miniQuizAnswer: payload.mini_quiz_answer ?? '',
      });
      if (payload.memo_summary && payload.memo_summary.trim()) {
        const appended = customExplanationText.trim()
          ? `${customExplanationText.trim()}\n\n---\n\n【口頭試問まとめ】\n${payload.memo_summary.trim()}`
          : `【口頭試問まとめ】\n${payload.memo_summary.trim()}`;
        setCustomExplanationText(appended);
        await saveMemoText(appended);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '要約生成に失敗しました。');
    } finally {
      setIsOralVivaLoading(false);
    }
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
          return;
        }
        reject(new Error('画像の読み込みに失敗しました。'));
      };
      reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
      reader.readAsDataURL(file);
    });

  const handleCustomImageUpload = async (kind: 'question' | 'explanation', file?: File) => {
    if (!editingProblem || !file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (kind === 'question') {
        setEditingProblem((prev) => (prev ? { ...prev, custom_question_image_data_url: dataUrl } : prev));
      } else {
        setEditingProblem((prev) => (prev ? { ...prev, custom_explanation_image_data_url: dataUrl } : prev));
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '画像の読み込みに失敗しました。');
    }
  };

  const handleRemove = async (targetItem?: ReviewLaterEntry) => {
    const itemToRemove = targetItem ?? selectedItem;
    if (!itemToRemove) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/review-later/${encodeURIComponent(itemToRemove.problem_id)}?subject=${encodeURIComponent(itemToRemove.subject)}`,
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

  const handleStartSimilarPractice = async () => {
    if (!selectedItem || !selectedItem.question) return;
    setIsFindingSimilar(true);
    setError('');
    setSimilarTopics([]);
    try {
      const response = await fetch(
        `${API_BASE_URL}/review-later/${encodeURIComponent(selectedItem.subject)}/${encodeURIComponent(selectedItem.problem_id)}/similar?count=5`
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || '類題の取得に失敗しました。');
      }
      const payload: { topic_keywords?: string[]; quiz_set?: QuizQuestion[] } = await response.json();
      const quizSet = Array.isArray(payload.quiz_set) ? payload.quiz_set : [];
      const topics = Array.isArray(payload.topic_keywords) ? payload.topic_keywords : [];
      setSimilarTopics(topics);

      if (quizSet.length === 0) {
        setError('類題が見つかりませんでした。');
        return;
      }
      sessionStorage.setItem('adhocQuizSet', JSON.stringify(quizSet));
      sessionStorage.setItem('adhocQuizLabel', `類題演習: ${selectedItem.problem_id}`);
      navigate('/?adhoc=1');
    } catch (similarError) {
      setError(similarError instanceof Error ? similarError.message : '類題の取得に失敗しました。');
    } finally {
      setIsFindingSimilar(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-dark">後で確認</h2>
          <p className="text-sm text-gray-500 mt-1">演習中に登録した問題をまとめて確認します。</p>
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
                <div
                  key={itemKey}
                  className={`rounded-lg border px-4 py-3 transition-colors ${
                    active ? 'border-primary-new bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedKey(itemKey)}
                    className="w-full text-left"
                  >
                    <div className="text-xs text-gray-500 truncate">{item.subject}</div>
                    <div className="mt-1 text-sm font-semibold text-gray-800 line-clamp-2">
                      {item.question?.question_text || item.error || '問題を読み込めませんでした。'}
                    </div>
                    <div className="mt-2 text-[11px] text-gray-400">更新: {new Date(item.updated_at).toLocaleString()}</div>
                  </button>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleRemove(item)}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      一覧で登録解除
                    </button>
                  </div>
                </div>
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
                      onClick={() => void handleStartSimilarPractice()}
                      disabled={isFindingSimilar}
                      className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-gray-300"
                    >
                      {isFindingSimilar ? '類題検索中...' : '類題出題'}
                    </button>
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
                {similarTopics.length > 0 && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    AI抽出トピック: {similarTopics.join(', ')}
                  </div>
                )}

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
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">問題文補足画像アップロード</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => void handleCustomImageUpload('question', event.target.files?.[0])}
                        className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                      />
                      {editingProblem.custom_question_image_data_url && (
                        <button
                          type="button"
                          onClick={() => setEditingProblem((prev) => (prev ? { ...prev, custom_question_image_data_url: undefined } : prev))}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          問題文補足画像を削除
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">解説補足画像アップロード</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => void handleCustomImageUpload('explanation', event.target.files?.[0])}
                        className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                      />
                      {editingProblem.custom_explanation_image_data_url && (
                        <button
                          type="button"
                          onClick={() => setEditingProblem((prev) => (prev ? { ...prev, custom_explanation_image_data_url: undefined } : prev))}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          解説補足画像を削除
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveMemo()}
                    disabled={isSavingMemo}
                    className="px-5 py-2 rounded-md bg-primary-new text-white text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    {isSavingMemo ? '保存中...' : 'My Memoを保存'}
                  </button>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-sky-900">口頭試問モード</h4>
                      {!isOralVivaActive ? (
                        <button
                          type="button"
                          onClick={() => void startOralViva()}
                          disabled={isOralVivaLoading}
                          className="px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300"
                        >
                          {isOralVivaLoading ? '開始中...' : '口頭試問を開始'}
                        </button>
                      ) : (
                        <div className="text-right">
                          <p className="text-xs font-semibold text-sky-900">
                            ステップ: {oralVivaStepLabels[oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)] as OralVivaStep]} ({Math.min(oralVivaStepIndex + 1, oralVivaSteps.length)}/{oralVivaSteps.length})
                          </p>
                          <p className="text-[11px] text-sky-700">終了条件: 4ステップ完了 or 要約へスキップ</p>
                        </div>
                      )}
                    </div>

                    {isOralVivaActive && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          {([
                            ['論理性', oralVivaScores.logicality],
                            ['具体性', oralVivaScores.specificity],
                            ['再現性', oralVivaScores.reproducibility],
                          ] as Array<[string, number]>).map(([label, value]) => (
                            <div key={label} className="rounded-md border border-sky-200 bg-white px-2 py-2">
                              <div className="flex justify-between text-xs text-sky-900 mb-1">
                                <span>{label}</span>
                                <span>{value}</span>
                              </div>
                              <div className="h-2 rounded bg-sky-100 overflow-hidden">
                                <div className="h-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="max-h-64 overflow-y-auto rounded-md border border-sky-200 bg-white p-2 space-y-2">
                          {oralVivaMessages.map((msg, idx) => (
                            <div key={`${msg.role}-${idx}`} className={`rounded-md px-2 py-1 text-sm ${msg.role === 'assistant' ? 'bg-sky-100 text-sky-900' : 'bg-gray-100 text-gray-800'}`}>
                              <p className="text-[11px] font-semibold">{msg.role === 'assistant' ? 'AI面接官' : 'あなた'}</p>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          ))}
                        </div>

                        {!oralVivaResult && (
                          <div className="space-y-2">
                            <textarea
                              value={oralVivaInput}
                              onChange={(event) => setOralVivaInput(event.target.value)}
                              rows={3}
                              className="w-full rounded-md border border-sky-300 px-3 py-2 text-sm bg-white"
                              placeholder="回答を入力してください"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void submitOralViva()}
                                disabled={isOralVivaLoading || !oralVivaInput.trim()}
                                className="px-3 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-800 disabled:bg-gray-300"
                              >
                                {isOralVivaLoading ? '送信中...' : '送信'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void skipToSummary()}
                                disabled={isOralVivaLoading}
                                className="px-3 py-1.5 rounded-md border border-sky-300 bg-white text-sky-900 text-xs font-medium hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400"
                              >
                                要約へスキップ
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsOralVivaActive(false)}
                                disabled={isOralVivaLoading}
                                className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-xs font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                              >
                                口頭試問を閉じる
                              </button>
                            </div>
                          </div>
                        )}

                        {oralVivaResult && (
                          <div className="rounded-md border border-sky-200 bg-white p-3 space-y-2">
                            <h5 className="text-sm font-semibold text-sky-900">最終フィードバック</h5>
                            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
                              {oralVivaResult.improvementPoints.map((point, idx) => (
                                <li key={`${point}-${idx}`}>{point}</li>
                              ))}
                            </ul>
                            {oralVivaResult.miniQuizQuestion && (
                              <p className="text-sm text-gray-800 whitespace-pre-wrap">次回確認ミニ問題: {oralVivaResult.miniQuizQuestion}</p>
                            )}
                            {oralVivaResult.miniQuizAnswer && (
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">想定解答: {oralVivaResult.miniQuizAnswer}</p>
                            )}
                            <p className="text-xs text-gray-500">最終要約は My Memo に自動追記・保存されます。</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
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
