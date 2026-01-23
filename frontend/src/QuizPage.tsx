import React, { useState, useEffect, useMemo } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';
import SubjectVisibilityModal from './components/SubjectVisibilityModal';
import { usePlans } from './hooks/usePlans';
import type { Plan } from './types/plan.d';
import { isHoliday } from './utils/date';

const API_BASE_URL = "/api";

interface Choice {
  label: string;
  text: string;
}

interface QuizQuestion {
  id: string;
  question_text: string;
  choices: Choice[];
  answer: string;
  subject: string;
  explanation: string;
  category?: string;
  image_urls?: string[];
  explanation_image_urls?: string[];
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

type QuizMode = 'random' | 'weak_area' | 'unanswered' | 'today_remaining';

export default function QuizPage({ subjects: allSubjects }: QuizPageProps) {
  const { plans, isLoading: isPlansLoading, error: plansError } = usePlans();
  const [dailySummaryAll, setDailySummaryAll] = useState<DailySummaryItem[]>([]);
  const [selectedSubjectNames, setSelectedSubjectNames] = useState<string[]>([]);
  const [quizMode, setQuizMode] = useState<QuizMode>('today_remaining');
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const [quizState, setQuizState] = useState<'setup' | 'active' | 'finished'>('setup');

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string } | null>(null);
  const [score, setScore] = useState(0);
  const [scratchpadText, setScratchpadText] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [effectStatus, setEffectStatus] = useState<'correct' | 'incorrect' | null>(null);

  const [unansweredCount, setUnansweredCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(false);

  useEffect(() => {
    const fetchDailySummaryAll = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/history/daily-summary/all`);
        if (response.ok) {
          const data = await response.json();
          setDailySummaryAll(data);
        }
      } catch (error) {
        console.error("Failed to fetch all daily summary:", error);
      }
    };
    fetchDailySummaryAll();
  }, []);
  
  const todayRemaining = useMemo(() => {
    if (isPlansLoading) return { count: 0, subjects: [], plan: 0, actual: 0 };

    const todayStr = new Date().toISOString().split('T')[0]!;
    const today = new Date(todayStr);
    
    let dailyPlan = 0;
    const targetSubjects = new Set<string>();

    plans.filter((p: Plan) => p.enabled).forEach((plan: Plan) => {
      // 厳密な型チェックを追加
      const fromDateStr = plan.period?.from;
      const toDateStr = plan.period?.to;

      if (fromDateStr && toDateStr && typeof fromDateStr === 'string' && typeof toDateStr === 'string') {
        const from = new Date(fromDateStr);
        const to = new Date(toDateStr);
        if (today >= from && today <= to) {
          const holiday = isHoliday(today);
          if (plan.applyDays === 'all' || (plan.applyDays === 'holiday' && holiday) || (plan.applyDays === 'weekday' && !holiday)) {
            dailyPlan += holiday ? plan.dailyGoal.holiday : plan.dailyGoal.weekday;
            plan.subjectNames.forEach((name: string) => targetSubjects.add(name));
          }
        }
      }
    });

    const dailyActual = dailySummaryAll.find(d => d.date === todayStr)?.total_questions ?? 0;
    const remaining = Math.max(0, dailyPlan - dailyActual);

    return {
      count: remaining,
      subjects: Array.from(targetSubjects),
      plan: dailyPlan,
      actual: dailyActual
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
        setError('未回答の問題はありません。');
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
      const subjectParams = selectedSubjectNames.map((s: string) => `subjects=${encodeURIComponent(s)}`).join('&');
      const apiMode = quizMode === 'today_remaining' ? 'unanswered' : quizMode;
      
      const response = await fetch(`${API_BASE_URL}/quiz/start?${subjectParams}&mode=${apiMode}&count=${questionsToFetch}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'クイズの開始に失敗しました。');
      }

      if (data.quiz_set.length === 0) {
        if (quizMode === 'unanswered') {
          setError('未回答の問題はありません。設定画面に戻ります。');
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
    
    const explanation = currentQuestion.explanation || "この問題の解説はありません。";
    setFeedback({ correct: isCorrect, explanation });
    setIsAnswered(true);
  };

  const handleNextQuestion = () => {
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

  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

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
        const nextButton = document.getElementById('next-question-button');

        if (!isAnswered && submitButton) {
          submitButton.click();
        } else if (isAnswered && nextButton) {
          nextButton.click();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [quizState, isAnswered, currentQuestion, handleAnswerSubmit, handleNextQuestion]);

  return (
    <>
      <SubjectVisibilityModal
        isOpen={isVisibilityModalOpen}
        onClose={() => setIsVisibilityModalOpen(false)}
        subjects={allSubjects}
        hiddenSubjects={hiddenSubjects}
        onHiddenSubjectsChange={handleHiddenSubjectsChange}
      />
      {effectStatus && (
        <div className="feedback-overlay">
          <div className={`feedback-icon ${effectStatus} feedback-effect-animation`}>
            {effectStatus === 'correct' ? '○' : '×'}
          </div>
        </div>
      )}
      <div className="max-w-3xl mx-auto">
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
                      <button type="button" onClick={() => setQuizMode('weak_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>苦手分野</button>
                      <button type="button" onClick={() => setQuizMode('unanswered')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>未回答問題</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">問題数</label>
                    <div className="mt-2 text-sm text-gray-500 mb-2">
                      {quizMode === 'today_remaining' && `(今日の残り: ${todayRemaining.count} 問 (予定:${todayRemaining.plan} / 実績:${todayRemaining.actual}))`}
                      {quizMode === 'unanswered' && unansweredCount !== null && `(未回答: ${unansweredCount} 問)`}
                    </div>
                    <div className="mt-2 grid grid-cols-5 gap-3">
                      {[
                        { label: '10', value: 10 },
                        { label: '20', value: 20 },
                        { label: '30', value: 30 },
                        { label: '50', value: 50 },
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
                          }
                        }

                        const isDisabled = (quizMode === 'today_remaining' && actualButtonValue > todayRemaining.count) ||
                                           (quizMode === 'unanswered' && unansweredCount !== null && actualButtonValue > unansweredCount) ||
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

        {(quizState === 'active' && currentQuestion) && (
          <>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-dark truncate" title={selectedSubjectNames.join(', ')}>{selectedSubjectNames.join(', ')}</h2>
              <p className="text-gray-500">問題 {currentQuestionIndex + 1} / {questions.length}</p>
            </div>
            <div className="bg-white rounded-xl shadow p-6 md:p-8">
              <p className="text-lg font-semibold text-gray-700 mb-6">{currentQuestion.question_text}</p>
              {(currentQuestion.image_urls && currentQuestion.image_urls.length > 0) && (
                <div className="my-4 grid grid-cols-1 gap-4">
                  {currentQuestion.image_urls.map((url: string, index: number) => (
                    <img key={index} src={url} alt={`Question image ${index + 1}`} className="max-w-full h-auto mx-auto rounded-lg shadow-md" />
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {currentQuestion.choices.map((option: Choice, index: number) => {
                  const isCorrectAnswer = option.label === currentQuestion.answer;
                  const isSelectedAnswer = option.label === selectedAnswer;
                  let buttonClass = 'bg-gray-100 hover:bg-gray-200';
                  if (isAnswered) {
                    if (isCorrectAnswer) {
                      buttonClass = 'bg-success/50 border-success';
                    } else if (isSelectedAnswer) {
                      buttonClass = 'bg-danger/50 border-danger';
                    } else {
                      buttonClass = 'bg-gray-100 opacity-60';
                    }
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
                <label htmlFor="scratchpad" className="block text-sm font-medium text-gray-700 mb-2">メモ帳</label>
                <textarea
                  id="scratchpad"
                  value={scratchpadText}
                  onChange={(e) => setScratchpadText(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new"
                  rows={3}
                  placeholder="計算やメモにご利用ください..."
                />
              </div>

              <div className="mt-6 text-center">
                {!isAnswered ? (
                  <button id="submit-answer-button" type="button" onClick={handleAnswerSubmit} disabled={selectedAnswer === null} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                    解答する
                  </button>
                ) : (
                  <button id="next-question-button" type="button" onClick={handleNextQuestion} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-dark bg-gray-200 hover:bg-gray-300">
                    {currentQuestionIndex < questions.length - 1 ? '次の問題へ' : 'クイズを終了'}
                  </button>
                )}
              </div>
            </div>
            {isAnswered && (
              <div className="mt-6 bg-white rounded-xl shadow p-6 md:p-8 fade-in">
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
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback?.explanation || ''}</ReactMarkdown>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
