import React, { useState, useEffect, useMemo } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';
import SubjectVisibilityModal from './components/SubjectVisibilityModal';
import SubjectProgress from './components/SubjectProgress';
import { usePlans } from './hooks/usePlans';
import type { Plan } from './types/plan.d';
import { isHoliday } from './utils/date';

const API_BASE_URL = "/api";

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
}

interface Subject {
  name: string;
}

interface QuizPageProps {
  subjects: Subject[];
}

interface DailySummaryItem {
  date: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
}

interface HistoryStat {
  total: number;
  correct: number;
}

type QuizMode = 'random' | 'weak_area' | 'unanswered' | 'today_remaining';

export default function QuizPage({ subjects: allSubjects }: QuizPageProps) {
  const { plans, isLoading: isPlansLoading, error: plansError } = usePlans();
  const [dailySummaryAll, setDailySummaryAll] = useState<DailySummaryItem[]>([]);
  const [selectedSubjectNames, setSelectedSubjectNames] = useState<string[]>([]);
  const [quizMode, setQuizMode] = useState<QuizMode>('today_remaining');
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const [quizState, setQuizState] = useState<'setup' | 'active' | 'finished'>('setup');

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [historyStats, setHistoryStats] = useState<Record<string, HistoryStat>>({});

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: Explanation } | null>(null);
  const [score, setScore] = useState(0);
  const [scratchpadText, setScratchpadText] = useState('');
  const [customExplanationText, setCustomExplanationText] = useState('');

  const [editingMemo, setEditingMemo] = useState<{type: 'scratchpad' | 'customExplanation', content: string} | null>(null);
  const [editingProblem, setEditingProblem] = useState<QuizQuestion | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [effectStatus, setEffectStatus] = useState<'correct' | 'incorrect' | null>(null);

  const openMemoModal = (type: 'scratchpad' | 'customExplanation') => {
    const content = type === 'scratchpad' ? scratchpadText : customExplanationText;
    setEditingMemo({ type, content });
  };

  const handleSaveAndCloseModal = () => {
    if (!editingMemo) return;
    if (editingMemo.type === 'scratchpad') {
        setScratchpadText(editingMemo.content);
    } else {
        setCustomExplanationText(editingMemo.content);
    }
    setEditingMemo(null);
  };

  // --- Problem Editing Functions ---
  const openProblemEditor = () => {
    if (currentQuestion) {
      setEditingProblem({ ...currentQuestion });
    }
  };

  const handleProblemFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (!editingProblem) return;
    const { name, value } = e.target;

    if (name.startsWith('explanation.')) {
      const key = name.split('.')[1] as keyof Explanation;
      setEditingProblem({
        ...editingProblem,
        explanation: {
          ...editingProblem.explanation,
          [key]: value,
        },
      });
    } else {
      setEditingProblem({ ...editingProblem, [name]: value });
    }
  };

  const handleProblemChoiceChange = (index: number, field: 'label' | 'text', value: string) => {
    if (!editingProblem) return;
    const newChoices = [...editingProblem.choices];
    newChoices[index] = { ...newChoices[index], [field]: value } as Choice;
    setEditingProblem({ ...editingProblem, choices: newChoices });
  };

  const handleSaveChanges = async () => {
    if (!editingProblem) return;

    try {
      const { image_urls, explanation_image_urls, custom_explanation, ...payload } = editingProblem;
      
      const response = await fetch(`/api/subjects/${editingProblem.subject}/problems/${editingProblem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || '問題の更新に失敗しました。');
      }

      const updatedProblem = await response.json();
      
      // フロントエンドの状態を即時更新
      const updatedQuestions = questions.map(q => 
        q.id === editingProblem.id ? { ...q, ...updatedProblem } : q
      );
      setQuestions(updatedQuestions);
      
      setEditingProblem(null); // モーダルを閉じる

    } catch (error: any) {
      console.error("Failed to save problem changes:", error);
      alert(`保存に失敗しました: ${error.message}`);
    }
  };
  // --- End of Problem Editing Functions ---

  const [subjectWeights, setSubjectWeights] = useState<{ [key: string]: 'light' | 'normal' | 'heavy' }>(() => {
    try {
      const saved = localStorage.getItem('subjectWeights');
      return saved ? JSON.parse(saved) : {};
    } catch (error) {
      console.error('Failed to parse subjectWeights from localStorage', error);
      return {};
    }
  });

  const [unansweredCount, setUnansweredCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(false);
  const [weakAreaCount, setWeakAreaCount] = useState<number | null>(null);
  const [isWeakCountLoading, setIsWeakCountLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem('subjectWeights', JSON.stringify(subjectWeights));
  }, [subjectWeights]);

  useEffect(() => {
    const fetchDailySummaryAll = async () => {
      const planSubjects = Array.from(new Set(
        plans.filter(p => p.enabled).flatMap(p => p.subjectNames)
      ));

      if (planSubjects.length === 0) {
        setDailySummaryAll([]);
        return;
      }

      try {
        const subjectParams = planSubjects.map(s => `subjects=${encodeURIComponent(s)}`).join('&');
        const response = await fetch(`${API_BASE_URL}/history/daily-summary/all?${subjectParams}`);
        if (response.ok) {
          const data = await response.json();
          setDailySummaryAll(data);
        } else {
          // エラーレスポンスのテキストをログに出力
          const errorText = await response.text();
          console.error("Failed to fetch filtered daily summary:", response.status, errorText);
          setDailySummaryAll([]); // エラーの場合は空にする
        }
      } catch (error) {
        console.error("Failed to fetch all daily summary:", error);
        setDailySummaryAll([]); // エラーの場合は空にする
      }
    };
    if (!isPlansLoading) {
        fetchDailySummaryAll();
    }
  }, [plans, isPlansLoading]);
  
  const todayRemaining = useMemo(() => {
    if (isPlansLoading) return { count: 0, subjects: [], plan: 0, actual: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of today in local timezone

    const parseDateLocal = (dateString: string): Date => {
      const [year, month, day] = dateString.split('-').map(Number) as [number, number, number];
      const date = new Date(year, month - 1, day);
      date.setHours(0, 0, 0, 0);
      return date;
    };
    
    let cumulativePlannedTotal = 0; // Accumulates all planned questions up to today
    const targetSubjects = new Set<string>();
    
    console.log("--- Today Remaining Debug Start ---");
    console.log("Debug: Today (local start of day):", today.toISOString());
    console.log("Debug: Plans available:", plans.length);

    plans.filter((p: Plan) => p.enabled).forEach((plan: Plan, planIndex) => {
      const fromDateStr = plan.period?.from;
      const toDateStr = plan.period?.to;

      console.log(`Debug: Processing Plan ${planIndex + 1} - "${plan.title}" (Enabled: ${plan.enabled})`);
      console.log(`Debug: Plan Period: From ${fromDateStr} to ${toDateStr}`);

      if (fromDateStr && toDateStr && typeof fromDateStr === 'string' && typeof toDateStr === 'string') {
        const planStart = parseDateLocal(fromDateStr);
        const planEnd = parseDateLocal(toDateStr);
        console.log(`Debug: Parsed Plan Start: ${planStart.toISOString()}, Plan End: ${planEnd.toISOString()}`);

        let currentDate = new Date(planStart);
        let planDailyPlanned = 0;

        while (currentDate.getTime() <= today.getTime() && currentDate.getTime() <= planEnd.getTime()) {
            const dayStr = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${currentDate.getDate().toString().padStart(2, '0')}`;
            const holiday = isHoliday(currentDate);

            let dailyGoalForCurrentDate = 0;
            if (plan.applyDays === 'all' || (plan.applyDays === 'holiday' && holiday) || (plan.applyDays === 'weekday' && !holiday)) {
                dailyGoalForCurrentDate = holiday ? plan.dailyGoal.holiday : plan.dailyGoal.weekday;
            }
            
            cumulativePlannedTotal += dailyGoalForCurrentDate;
            planDailyPlanned += dailyGoalForCurrentDate;
            
            plan.subjectNames.forEach((name: string) => targetSubjects.add(name));

            currentDate.setDate(currentDate.getDate() + 1); // Move to next day
        }
        console.log(`Debug: Plan ${planIndex + 1} cumulative for loop: Planned=${planDailyPlanned}`);
      } else {
        console.log(`Debug: Plan ${planIndex + 1} - Invalid period data (from: ${fromDateStr}, to: ${toDateStr}).`);
      }
    });

    const cumulativeActualTotal = dailySummaryAll.reduce((total, summary) => {
        const summaryDate = parseDateLocal(summary.date);
        if (summaryDate.getTime() <= today.getTime()) {
            return total + summary.total_questions;
        }
        return total;
    }, 0);

    const remaining = Math.max(0, cumulativePlannedTotal - cumulativeActualTotal);

    console.log("Debug: Final Cumulative Planned Total:", cumulativePlannedTotal);
    console.log("Debug: Final Cumulative Actual Total:", cumulativeActualTotal);
    console.log("Debug: Final Remaining Count:", remaining);
    console.log("Debug: Target Subjects:", Array.from(targetSubjects));
    console.log("--- Today Remaining Debug End ---");

    return {
      count: remaining,
      subjects: Array.from(targetSubjects),
      plan: cumulativePlannedTotal,
      actual: cumulativeActualTotal
    };
  }, [plans, dailySummaryAll, isPlansLoading]);

  useEffect(() => {
    if (quizMode === 'today_remaining') {
      setSelectedSubjectNames(todayRemaining.subjects);
    }
  }, [quizMode, todayRemaining]);

  // 科目表示制御
  const [hiddenSubjects, setHiddenSubjects] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('hiddenSubjects');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Failed to parse hiddenSubjects from localStorage', error);
      return [];
    }
  });
  const [isVisibilityModalOpen, setIsVisibilityModalOpen] = useState(false);

  const visibleSubjects = useMemo(() => {
    return allSubjects.filter((s: Subject) => !hiddenSubjects.includes(s.name));
  }, [allSubjects, hiddenSubjects]);

  const handleHiddenSubjectsChange = (newHiddenSubjects: string[]) => {
    setHiddenSubjects(newHiddenSubjects);
    localStorage.setItem('hiddenSubjects', JSON.stringify(newHiddenSubjects));
    setSelectedSubjectNames((prev: string[]) => prev.filter((name: string) => !newHiddenSubjects.includes(name)));
  };

  useEffect(() => {
    const fetchUnansweredCount = async () => {
      if (quizMode === 'unanswered' && selectedSubjectNames.length > 0) {
        setIsCountLoading(true);
        setUnansweredCount(null);
        try {
          const subjectParams = selectedSubjectNames.map((s: string) => `subjects=${encodeURIComponent(s)}`).join('&');
          const response = await fetch(`${API_BASE_URL}/quiz/unanswered-count?${subjectParams}`);
          if (!response.ok) {
            throw new Error('Failed to fetch unanswered count.');
          }
          const data = await response.json();
          setUnansweredCount(data.unanswered_count);
        } catch (error) {
          console.error(error);
        } finally {
          setIsCountLoading(false);
        }
      } else {
        setUnansweredCount(null);
      }
    };

    fetchUnansweredCount();
  }, [quizMode, selectedSubjectNames]);

  useEffect(() => {
    const fetchWeakAreaCount = async () => {
      if (quizMode === 'weak_area' && selectedSubjectNames.length > 0) {
        setIsWeakCountLoading(true);
        setWeakAreaCount(null);
        try {
          const subjectParams = selectedSubjectNames.map((s: string) => `subjects=${encodeURIComponent(s)}`).join('&');
          const response = await fetch(`${API_BASE_URL}/quiz/missed-problems-count?${subjectParams}`);
          if (!response.ok) {
            throw new Error('Failed to fetch weak area count.');
          }
          const data = await response.json();
          setWeakAreaCount(data.missed_problems_count);
        } catch (error) {
          console.error(error);
        } finally {
          setIsWeakCountLoading(false);
        }
      } else {
        setWeakAreaCount(null);
      }
    };

    fetchWeakAreaCount();
  }, [quizMode, selectedSubjectNames]);

  useEffect(() => {
    const fetchHistoryStats = async () => {
      if (questions.length > 0) {
        try {
          const problemIds = questions.map((q) => q.id);
          const response = await fetch(`${API_BASE_URL}/quiz/bulk-history-stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              problem_ids: problemIds,
              subjects: selectedSubjectNames,
            }),
          });
          if (response.ok) {
            const data = await response.json();
            setHistoryStats(data);
          }
        } catch (error) {
          console.error("Failed to fetch history stats:", error);
        }
      }
    };

    fetchHistoryStats();
  }, [questions, selectedSubjectNames]);

  const handleSubjectSelection = (subjectName: string) => {
    setSelectedSubjectNames((prev: string[]) =>
      prev.includes(subjectName)
        ? prev.filter((s: string) => s !== subjectName)
        : [...prev, subjectName]
    );
  };

  const startQuiz = async () => {
    if (selectedSubjectNames.length === 0) {
      setError('科目を1つ以上選択してください。');
      return;
    }

    let questionsToFetch = numQuestions;
    if (quizMode === 'today_remaining') {
      if (todayRemaining.count === 0) {
        setError('今日の予定は完了しています！');
        return;
      }
      questionsToFetch = Math.min(numQuestions, todayRemaining.count);
    } else if (quizMode === 'unanswered') {
      if (unansweredCount === null || unansweredCount === 0) {
        setError('未解答の問題はありません。');
        return;
      }
      questionsToFetch = Math.min(numQuestions, unansweredCount);
    }
    
    if (questionsToFetch <= 0) {
      setError('出題する問題数が0以下です。');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const apiMode = quizMode === 'today_remaining' ? 'unanswered' : quizMode;
      
      const response = await fetch(`${API_BASE_URL}/quiz/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subjects: selectedSubjectNames,
          mode: apiMode,
          count: questionsToFetch,
          weights: quizMode === 'random' ? subjectWeights : undefined,
        }),
      });
      
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'クイズの開始に失敗しました。');
      }

      if (data.quiz_set.length === 0) {
        if (quizMode === 'unanswered') {
          setError('未解答の問題はありません。設定画面に戻ります。');
          setTimeout(() => {
            setQuizState('setup');
            setError('');
          }, 2000);
        } else {
          setError('出題できる問題がありません。');
        }
        setIsLoading(false);
        return;
      }

      setQuestions(data.quiz_set);
      setCurrentQuestionIndex(0);
      setScore(0);
      setQuizState('active');
      resetQuestionState();

    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const resetQuestionState = () => {
    setSelectedAnswer(null);
    setIsAnswered(false);
    setFeedback(null);
    setScratchpadText('');
    setCustomExplanationText('');
  };

  const handleAnswerSubmit = async () => {
    if (selectedAnswer === null) return;

    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;
    const isCorrect = selectedAnswer === currentQuestion.answer;
    
    setEffectStatus(isCorrect ? 'correct' : 'incorrect');
    setTimeout(() => setEffectStatus(null), 1000);

    if (isCorrect) {
      setScore(prev => prev + 1);
    }

    try {
      await fetch(`${API_BASE_URL}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem_id: currentQuestion.id,
          subject: currentQuestion.subject,
          selected_answer: selectedAnswer,
          is_correct: isCorrect,
          category: currentQuestion.category,
        }),
      });
    } catch (e) {
      console.error("Failed to submit history:", e);
    }
    
    const explanation = currentQuestion.explanation || { text: "この問題の解説はありません。" };
    setFeedback({ correct: isCorrect, explanation });
    setIsAnswered(true);
  };

  const handleNextQuestion = async () => {
    // メモが変更されていたら保存する
    const originalText = currentQuestion?.custom_explanation || '';
    if (customExplanationText.trim() !== originalText.trim()) {
      await handleSaveCustomExplanation();
    }

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      resetQuestionState();
    } else {
      setQuizState('finished');
    }
  };

  const handleTryAgain = () => {
    if (quizMode === 'unanswered') {
      setQuizState('setup');
    } else {
      startQuiz();
    }
  };

  const handleSaveCustomExplanation = async () => {
    if (!currentQuestion) return;
    try {
      const response = await fetch(`${API_BASE_URL}/problems/${currentQuestion.id}/custom-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: customExplanationText }),
      });

      if (!response.ok) {
        throw new Error('Failed to save custom explanation');
      }

      // Update the question in the main questions array to persist state during the session
      const updatedQuestions = questions.map((q) =>
        q.id === currentQuestion.id
          ? { ...q, custom_explanation: customExplanationText }
          : q
      );
      setQuestions(updatedQuestions);
    } catch (error) {
      console.error("Failed to save custom explanation:", error);
      // Optionally: show an error message to the user
    }
  };

    const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

  

    useEffect(() => {

      if (currentQuestion) {

        setCustomExplanationText(currentQuestion.custom_explanation || '');

      }

    }, [currentQuestion]);

  

    useEffect(() => {

      const handleKeyPress = (event: KeyboardEvent) => {

        if (quizState !== 'active' || (event.target instanceof HTMLTextAreaElement)) {

          return;

        }

  

        if (event.key >= '1' && event.key <= '9') {

          if (!isAnswered) {

            const choiceIndex = parseInt(event.key) - 1;

            if (currentQuestion && currentQuestion.choices && currentQuestion.choices[choiceIndex]) {

              setSelectedAnswer(currentQuestion.choices[choiceIndex].label);

            }

          }

        }

  

        if (event.key === 'Enter') {

          const submitButton = document.getElementById('submit-answer-button');

  

          if (!isAnswered && submitButton) {

            submitButton.click();

          } else if (isAnswered) {

            handleNextQuestion();

          }

        }

      };

  

      window.addEventListener('keydown', handleKeyPress);

  

      return () => {

        window.removeEventListener('keydown', handleKeyPress);

      };

    }, [quizState, isAnswered, currentQuestion, handleAnswerSubmit, handleNextQuestion]);

  

    // --- Render logic for active quiz ---

    const renderActiveQuiz = () => {
      if (!currentQuestion) return null;
  
      const hasImages = currentQuestion.image_urls && currentQuestion.image_urls.length > 0;
  
      // レイアウトの決定ロジック
      let layoutType: 'image' | 'answered' | 'default' = 'default';
      if (hasImages) {
        layoutType = 'image';
      } else if (isAnswered) {
        layoutType = 'answered';
      }
  
      const imagesComponent = hasImages ? (
        <div className="space-y-4">
          {currentQuestion.image_urls!.map((url: string, index: number) => (
            <img key={index} src={url} alt={`Question image ${index + 1}`} className="max-w-full w-full h-auto mx-auto rounded-lg shadow-md" />
          ))}
        </div>
      ) : null;
  
      const explanationComponent = isAnswered ? (
        <div className="bg-white rounded-xl shadow p-6 md:p-8 fade-in">
          <div className="flex items-center gap-3 mb-4">
            {feedback?.correct ? <CheckCircleIcon className="w-8 h-8 text-green-600" /> : <XCircleIcon className="w-8 h-8 text-red-600" />}
            <h3 className="text-2xl font-bold">{feedback?.correct ? '正解！' : '不正解'}</h3>
          </div>
          <h4 className="text-lg font-semibold text-primary-new mb-2">解説</h4>
          {(currentQuestion.explanation_image_urls && currentQuestion.explanation_image_urls.length > 0) && (
            <div className="my-4 grid grid-cols-1 gap-4">
              {currentQuestion.explanation_image_urls.map((url: string, index: number) => (
                <img key={index} src={url} alt={`Explanation image ${index + 1}`} className="max-w-full h-auto mx-auto rounded-lg shadow-md" />
              ))}
            </div>
          )}
          <div className="prose prose-sm md:prose-base max-w-none text-gray-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback?.explanation?.text || ''}</ReactMarkdown>
          </div>
          <div className="mt-6">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-lg font-semibold text-primary-new">My Memo</h4>
              <button onClick={() => openMemoModal('customExplanation')} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="拡大表示">
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4"/></svg>
              </button>
            </div>
            <textarea
              value={customExplanationText}
              onChange={(e) => setCustomExplanationText(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new"
              rows={4}
              placeholder="この問題に関する自分なりの解説やメモを書き込もう"
            />
          </div>
          <div className="mt-6 pt-4 border-t border-gray-200 flex justify-between items-center">
            <button
              onClick={openProblemEditor}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              この問題を編集する
            </button>
            <button id="next-question-button-bottom" type="button" onClick={handleNextQuestion} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-dark bg-gray-200 hover:bg-gray-300">
              {currentQuestionIndex < questions.length - 1 ? '次の問題へ' : 'クイズを終了'}
            </button>
          </div>
        </div>
      ) : null;
  
      // 左カラム（問題・選択肢）
      const QuestionColumn = () => (
        <div className="bg-white rounded-xl shadow p-6 md:p-8 h-full flex flex-col">
          <p className="text-lg font-semibold text-gray-700 mb-6">{currentQuestion.question_text}</p>
          
          {/* 画像がある場合、スマホでは問題文の下に表示 */}
          <div className="md:hidden my-4">
            {layoutType === 'image' && imagesComponent}
          </div>

          <div className="space-y-3">
            {currentQuestion.choices.map((option: Choice, index: number) => {
              const isCorrectAnswer = option.label === currentQuestion.answer;
              const isSelectedAnswer = option.label === selectedAnswer;
              let buttonClass = 'bg-gray-100 hover:bg-gray-200';
              if (isAnswered) {
                if (isCorrectAnswer) buttonClass = 'bg-success/50 border-success';
                else if (isSelectedAnswer) buttonClass = 'bg-danger/50 border-danger';
                else buttonClass = 'bg-gray-100 opacity-60';
              } else if (isSelectedAnswer) {
                buttonClass = 'bg-primary-new';
              }
              return (
                <button
                  type="button"
                  key={index}
                  onClick={() => !isAnswered && setSelectedAnswer(option.label)}
                  disabled={isAnswered}
                  className={`w-full text-left p-4 rounded-lg border border-transparent transition-all duration-200 ${buttonClass}`}
                >
                  <span className="font-bold mr-2">{option.label}.</span>
                  <span>{option.text}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            <div className="flex justify-between items-center mb-2">
              <label htmlFor="scratchpad" className="block text-sm font-medium text-gray-700">メモ帳</label>
              <button onClick={() => openMemoModal('scratchpad')} className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700" title="拡大表示">
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4"/></svg>
              </button>
            </div>
            <textarea
              id="scratchpad"
              value={scratchpadText}
              onChange={(e) => setScratchpadText(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new"
              rows={3}
              placeholder="計算やメモにご利用ください..."
            />
            {!isAnswered && ( // Moved "解答する" button here
              <div className="mt-6 text-center">
                <button id="submit-answer-button" type="button" onClick={handleAnswerSubmit} disabled={selectedAnswer === null} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                  解答する
                </button>
              </div>
            )}
          </div>

          {isAnswered && ( // This div now only contains "次の問題へ" button, and retains mt-auto
            <div className="mt-auto pt-6 text-center">
              <button id="next-question-button" type="button" onClick={handleNextQuestion} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-dark bg-gray-200 hover:bg-gray-300">
                {currentQuestionIndex < questions.length - 1 ? '次の問題へ' : 'クイズを終了'}
              </button>
            </div>
          )}
        </div>
      );
  
      // 右カラム（画像・解説）
      const RightColumn = () => (
        <div className="space-y-8">
          {layoutType === 'image' && (
             <div className="bg-white rounded-xl shadow p-6 md:p-8">
                {imagesComponent}
             </div>
          )}
          {explanationComponent}
        </div>
      );
      
      const progressPercentage = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0;

      return (
        <div className="md:h-screen md:overflow-hidden">
            <div className="p-4 md:p-6">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-xl font-bold text-dark truncate" title={selectedSubjectNames.join(', ')}>{selectedSubjectNames.join(', ')}</h2>
                    <div className="flex items-center gap-4">
                        {(() => {
                        const stats = historyStats[currentQuestion.id];
                        if (stats && stats.total > 0) {
                            return (
                            <div className="text-sm text-gray-500 whitespace-nowrap">
                                直近{stats.total}回 正答率: {Math.round((stats.correct / stats.total) * 100)}% ({stats.correct}/{stats.total})
                            </div>
                            );
                        }
                        if (Object.keys(historyStats).length > 0) {
                            return <div className="text-sm text-gray-500 whitespace-nowrap">初挑戦</div>;
                        }
                        return null;
                        })()}
                        <p className="text-gray-500">問題 {currentQuestionIndex + 1} / {questions.length}</p>
                    </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div className="bg-primary-new h-2.5 rounded-full transition-all duration-500" style={{ width: `${progressPercentage}%` }}></div>
                </div>
            </div>
            
            <div className={`
                md:grid md:gap-8 md:h-[calc(100vh-120px)] // Adjusted height for progress bar
                ${layoutType === 'image' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'answered' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'default' ? 'md:grid-cols-1' : ''}
            `}>
              {/* --- Left Column --- */}
              <div className={`
                px-4 md:px-0 md:pl-6
                ${layoutType === 'image' ? 'md:col-span-1' : ''}
                ${layoutType === 'answered' ? 'md:col-span-1' : ''}
                ${layoutType !== 'default' ? 'md:h-full md:overflow-y-auto' : ''}
              `}>
                <QuestionColumn />
              </div>

              {/* --- Right Column (PC only) --- */}
              {layoutType !== 'default' && (
                <div className={`
                  hidden md:block md:pr-6
                  ${layoutType === 'image' ? 'md:col-span-2' : ''}
                  ${layoutType === 'answered' ? 'md:col-span-2' : ''}
                  md:h-full md:overflow-y-auto
                `}>
                  <RightColumn />
                </div>
              )}
              
              {/* --- Mobile-only Explanation --- */}
              <div className="md:hidden mt-8 px-4">
                {explanationComponent}
              </div>
            </div>
        </div>
      );
    }

  

    return (

      <>

        <SubjectVisibilityModal

          isOpen={isVisibilityModalOpen}

          onClose={() => setIsVisibilityModalOpen(false)}

          subjects={allSubjects}

          hiddenSubjects={hiddenSubjects}

          onHiddenSubjectsChange={handleHiddenSubjectsChange}

          quizMode={quizMode}

          subjectWeights={subjectWeights}

          onSubjectWeightsChange={setSubjectWeights}

        />

        {effectStatus && (

          <div className="feedback-overlay">

            <div className={`feedback-icon ${effectStatus} feedback-effect-animation`}>

              {effectStatus === 'correct' ? '○' : '×'}

            </div>

          </div>

        )}

              <div className={quizState === 'active' ? "w-full" : "max-w-3xl mx-auto"}>

                {quizState === 'setup' && (

                  (isLoading || isPlansLoading) ? (

                    <LoadingSpinner />

                  ) : (

                    <div className="max-w-2xl mx-auto">

                      <div className="bg-white rounded-xl shadow p-8">

                        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">

                          <div>

                            <div className="flex items-center justify-between mb-2">

                              <label className="block text-sm font-medium text-gray-700">科目 (複数選択可)</label>

                              <button onClick={() => setIsVisibilityModalOpen(true)} className="p-1 rounded-md hover:bg-gray-200" title="表示科目の制御">

                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" />

                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />

                                </svg>

                              </button>

                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">

                              {visibleSubjects.map((s: Subject) => {

                                const isSelected = selectedSubjectNames.includes(s.name);

                                const isTodayMode = quizMode === 'today_remaining';

                                

                                let buttonClass = 'px-3 py-2 rounded-md text-sm font-medium text-left truncate transition-colors ';

        

                                if (isTodayMode) {

                                  if (isSelected) {

                                    // 予定に含まれる科目: 少し薄く

                                    buttonClass += 'bg-primary-new text-white shadow-sm opacity-75 cursor-not-allowed';

                                  } else {

                                    // 予定に含まれない科目: グレーアウト

                                    buttonClass += 'bg-gray-100 text-gray-400 cursor-not-allowed';

                                  }

                                } else {

                                  if (isSelected) {

                                    // 通常選択時のスタイル

                                    buttonClass += 'bg-primary-new text-white shadow-sm';

                                  } else {

                                    // 通常非選択時のスタイル

                                    buttonClass += 'bg-gray-200 text-gray-700 hover:bg-gray-300';

                                  }

                                }

        

                                return (

                                  <button

                                    key={s.name}

                                    type="button"

                                    onClick={() => handleSubjectSelection(s.name)}

                                    disabled={isTodayMode}

                                    className={buttonClass}

                                  >

                                    {s.name}

                                  </button>

                                );

                              })}

                            </div>

                          </div>

                          <div>

                            <label className="block text-sm font-medium text-gray-700">モード</label>

                            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">

                              <button type="button" onClick={() => setQuizMode('today_remaining')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'today_remaining' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>今日の残り</button>

                              <button type="button" onClick={() => setQuizMode('random')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>ランダム</button>

                              <button type="button" onClick={() => setQuizMode('weak_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>苦手克服</button>

                              <button type="button" onClick={() => setQuizMode('unanswered')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>未解答問題</button>

                            </div>

                          </div>

                          <div>

                            <label className="block text-sm font-medium text-gray-700">問題数</label>

                            <div className="mt-2 text-sm text-gray-500 mb-2">

                              {quizMode === 'today_remaining' && `(今日の残り: ${todayRemaining.count} 問 (予定:${todayRemaining.plan} / 実績:${todayRemaining.actual}))`}

                              {quizMode === 'unanswered' && unansweredCount !== null && `(未解答: ${unansweredCount} 問)`}

                              {quizMode === 'weak_area' && weakAreaCount !== null && `(苦手問題: ${weakAreaCount} 問)`}

                            </div>

                            <div className="mt-2 grid grid-cols-5 gap-3">

                              {[

                                { label: '1', value: 1 },

                                { label: '10', value: 10 },

                                { label: '20', value: 20 },

                                { label: 'MAX', value: 1000 }, // Default MAX is 1000

                              ].map((option) => {

                                let actualButtonValue = option.value;

                                let displayButtonLabel = option.label;

        

                                if (option.label === 'MAX') {

                                  if (quizMode === 'today_remaining') {

                                    actualButtonValue = todayRemaining.count;

                                    displayButtonLabel = `MAX (${todayRemaining.count})`;

                                  } else if (quizMode === 'unanswered' && unansweredCount !== null) {

                                    actualButtonValue = unansweredCount;

                                    displayButtonLabel = `MAX (${unansweredCount})`;

                                  } else if (quizMode === 'weak_area' && weakAreaCount !== null) {

                                    actualButtonValue = weakAreaCount;

                                    displayButtonLabel = `MAX (${weakAreaCount})`;

                                  }

                                }

        

                                const isDisabled = (quizMode === 'today_remaining' && actualButtonValue > todayRemaining.count) ||

                                                   (quizMode === 'unanswered' && unansweredCount !== null && actualButtonValue > unansweredCount) ||

                                                   (quizMode === 'weak_area' && weakAreaCount !== null && actualButtonValue > weakAreaCount) ||

                                                   actualButtonValue <= 0; // Disable if value is 0 or less

        

                                return (

                                  <button

                                    key={option.label}

                                    type="button"

                                    onClick={() => setNumQuestions(actualButtonValue)}

                                    disabled={isDisabled}

                                    className={`px-2 py-2 rounded-md text-sm font-medium transition-colors ${

                                      numQuestions === actualButtonValue && !isDisabled

                                        ? 'bg-primary-new text-white'

                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'

                                    }`}

                                  >

                                    {displayButtonLabel}

                                  </button>

                                );

                              })}

                            </div>

                          </div>

                        </form>

                        <div className="mt-6">

                          <button type="button" onClick={startQuiz} disabled={isLoading || selectedSubjectNames.length === 0} className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-primary-new">

                            {isLoading ? <LoaderIcon className="w-5 h-5" /> : null}

                            {isLoading ? 'クイズ準備中...' : 'Start'}

                          </button>

                        </div>

                        {(error || plansError) && <p className="text-danger text-sm mt-2 text-center">{error || plansError}</p>}

                      </div>

                      <SubjectProgress selectedSubjectNames={selectedSubjectNames} quizMode={quizMode} />

                    </div>

                  )

                )}

                

                {quizState === 'finished' && (

                  <div className="text-center max-w-lg mx-auto">

                    <h2 className="text-3xl font-bold text-dark mb-4">クイズ完了！</h2>

                    <div className="bg-white rounded-xl shadow p-8">

                      <p className="text-lg text-gray-700">あなたのスコア：</p>

                      <p className="text-6xl font-bold text-primary-new my-4">{questions.length > 0 ? Math.round((score / questions.length) * 100) : 0}%</p>

                      <p className="text-gray-500">{questions.length}問中{score}問正解しました。</p>

                      <div className="flex justify-center gap-4 mt-8">

                        <button type="button" onClick={() => setQuizState('setup')} className="px-6 py-3 border border-gray-300 rounded-md shadow-sm text-base font-medium text-gray-700 bg-white hover:bg-gray-50">

                          科目選択へ

                        </button>

                        <button type="button" onClick={handleTryAgain} className="px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700">

                          もう一度挑戦する

                        </button>

                      </div>

                    </div>

                  </div>

                )}

                

                {quizState === 'active' && renderActiveQuiz()}

              </div>

        {editingMemo && (

          <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex justify-center items-center p-4">

            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-3/4 flex flex-col">

              <h3 className="text-lg font-bold p-4 border-b">

                {editingMemo.type === 'scratchpad' ? 'メモ帳' : 'My Memo'}

              </h3>

              <textarea

                value={editingMemo.content}

                onChange={(e) => setEditingMemo({ ...editingMemo, content: e.target.value })}

                className="flex-grow w-full p-4 border-0 focus:ring-0 text-base"

                placeholder={editingMemo.type === 'scratchpad' ? '計算やメモにご利用ください...' : 'この問題に関する自分なりの解説やメモを書き込もう'}

              />

              <div className="p-4 border-t flex justify-end">

                <button

                  onClick={handleSaveAndCloseModal}

                  className="px-6 py-2 bg-primary-new text-white rounded-lg hover:bg-blue-700"

                >

                  保存して閉じる

                </button>

              </div>

            </div>

          </div>

        )}

  

        {editingProblem && (

          <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">

            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">

              <h3 className="text-xl font-bold p-4 border-b">問題の編集</h3>

              <div className="flex-grow overflow-y-auto p-6 space-y-4">

                {/* 問題文 */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">問題文</label>

                  <textarea name="question_text" value={editingProblem.question_text} onChange={handleProblemFormChange} rows={4} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

                {/* 選択肢 */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">選択肢</label>

                  <div className="space-y-2 mt-1">

                    {editingProblem.choices.map((choice, index) => (

                      <div key={index} className="flex items-center gap-2">

                        <input type="text" value={choice.label} onChange={(e) => handleProblemChoiceChange(index, 'label', e.target.value)} className="w-16 shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                        <input type="text" value={choice.text} onChange={(e) => handleProblemChoiceChange(index, 'text', e.target.value)} className="flex-grow shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                      </div>

                    ))}

                  </div>

                </div>

                {/* 正解 */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">正解の選択肢ラベル</label>

                  <input type="text" name="answer" value={editingProblem.answer} onChange={handleProblemFormChange} className="mt-1 w-32 block shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

                {/* カテゴリ */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">カテゴリ</label>

                  <input type="text" name="category" value={editingProblem.category || ''} onChange={handleProblemFormChange} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

                {/* 解説 */}

                <div>

                  <label className="block text-sm font-medium text-gray-700">解説</label>

                  <textarea name="explanation.text" value={editingProblem.explanation.text} onChange={handleProblemFormChange} rows={6} className="mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"/>

                </div>

              </div>

              <div className="p-4 border-t flex justify-end gap-4">

                <button onClick={() => setEditingProblem(null)} className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">

                  キャンセル

                </button>

                <button onClick={handleSaveChanges} className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">

                  変更を保存

                </button>

              </div>

            </div>

          </div>

        )}

      </>

    );

  }

  
