import React, { useState, useEffect, useMemo } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';

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
}

interface Subject {
  name: string;
}

interface QuizPageProps {
  subjects: Subject[];
}

type QuizMode = 'random' | 'weak_area' | 'unanswered';

export default function QuizPage({ subjects }: QuizPageProps) {
  const [selectedSubjectNames, setSelectedSubjectNames] = useState<string[]>([]);
  const [quizMode, setQuizMode] = useState<QuizMode>('random');
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
    const fetchUnansweredCount = async () => {
      if (quizMode === 'unanswered' && selectedSubjectNames.length > 0) {
        setIsCountLoading(true);
        setUnansweredCount(null);
        try {
          const subjectParams = selectedSubjectNames.map(s => `subjects=${encodeURIComponent(s)}`).join('&');
          const response = await fetch(`${API_BASE_URL}/quiz/unanswered-count?${subjectParams}`);
          if (!response.ok) {
            throw new Error('Failed to fetch unanswered count.');
          }
          const data = await response.json();
          setUnansweredCount(data.unanswered_count);
        } catch (error) {
          console.error(error);
          // You might want to set an error state here to inform the user
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
    setSelectedSubjectNames(prev => 
      prev.includes(subjectName) 
        ? prev.filter(s => s !== subjectName)
        : [...prev, subjectName]
    );
  };

  const startQuiz = async () => {
    if (selectedSubjectNames.length === 0) {
      setError('科目を1つ以上選択してください。');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const subjectParams = selectedSubjectNames.map(s => `subjects=${encodeURIComponent(s)}`).join('&');
      const response = await fetch(`${API_BASE_URL}/quiz/start?${subjectParams}&mode=${quizMode}&count=${numQuestions}`);
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
          subject: currentQuestion.subject, // Use subject from the question object
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

  return (
    <>
      {effectStatus && (
        <div className="feedback-overlay">
          <div className={`feedback-icon ${effectStatus} feedback-effect-animation`}>
            {effectStatus === 'correct' ? '○' : '×'}
          </div>
        </div>
      )}
      <div className="max-w-3xl mx-auto">
        {quizState === 'setup' && (
          isLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="max-w-2xl mx-auto">
              <div className="bg-white rounded-xl shadow p-8">
                <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">科目 (複数選択可)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {subjects.map(s => (
                        <button
                          key={s.name}
                          type="button"
                          onClick={() => handleSubjectSelection(s.name)}
                          className={`px-3 py-2 rounded-md text-sm font-medium text-left truncate ${
                            selectedSubjectNames.includes(s.name)
                              ? 'bg-primary-new text-white shadow-sm'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">モード</label>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <button type="button" onClick={() => setQuizMode('random')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>ランダム</button>
                      <button type="button" onClick={() => setQuizMode('weak_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>苦手分野</button>
                      <button type="button" onClick={() => setQuizMode('unanswered')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>未回答問題</button>
                    </div>
                  </div>
                  {quizMode === 'unanswered' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">実施予定問題数</label>
                      <div className="mt-2 text-lg font-bold text-primary-new p-2 bg-gray-100 rounded-md text-center">
                        {isCountLoading ? '計算中...' : unansweredCount !== null ? `${unansweredCount} 問` : '...'}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">問題数</label>
                      <div className="mt-2 grid grid-cols-5 gap-3">
                        {[
                          { label: '10', value: 10 },
                          { label: '20', value: 20 },
                          { label: '30', value: 30 },
                          { label: '50', value: 50 },
                          { label: 'MAX', value: 1000 },
                        ].map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => setNumQuestions(option.value)}
                            className={`px-2 py-2 rounded-md text-sm font-medium transition-colors ${
                              numQuestions === option.value
                                ? 'bg-primary-new text-white'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </form>
                <div className="mt-6">
                  <button type="button" onClick={startQuiz} disabled={isLoading || selectedSubjectNames.length === 0} className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-primary-new">
                    {isLoading ? <LoaderIcon className="w-5 h-5" /> : null}
                    {isLoading ? 'クイズ準備中...' : 'Start'}
                  </button>
                </div>
                {error && <p className="text-danger text-sm mt-2 text-center">{error}</p>}
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
                  {currentQuestion.image_urls.map((url, index) => (
                    <img key={index} src={url} alt={`Question image ${index + 1}`} className="max-w-full h-auto mx-auto rounded-lg shadow-md" />
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {currentQuestion.choices.map((option, index) => {
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
                  <button type="button" onClick={handleAnswerSubmit} disabled={selectedAnswer === null} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                    解答する
                  </button>
                ) : (
                  <button type="button" onClick={handleNextQuestion} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-dark bg-gray-200 hover:bg-gray-300">
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