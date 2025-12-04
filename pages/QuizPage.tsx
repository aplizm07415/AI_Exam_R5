import React, { useState, useEffect, useMemo } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from '../components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API_BASE_URL = "http://127.0.0.1:8000/api";

interface QuizQuestion {
  id: string;
  question_text: string;
  choices: string[];
  answer: string;
  subject: string;
  explanation: string;
}

interface Subject {
  name: string;
}

interface QuizPageProps {
  subjects: Subject[];
}

type QuizMode = 'random' | 'weak_area';

export default function QuizPage({ subjects }: QuizPageProps) {
  const [selectedSubjectName, setSelectedSubjectName] = useState<string>('');
  const [quizMode, setQuizMode] = useState<QuizMode>('random');
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const [quizState, setQuizState] = useState<'setup' | 'active' | 'finished'>('setup');

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string } | null>(null);
  const [score, setScore] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (subjects.length > 0 && !selectedSubjectName) {
      const firstSubject = subjects[0];
      if (firstSubject) {
        setSelectedSubjectName(firstSubject.name);
      }
    } else if (subjects.length === 0) {
      setSelectedSubjectName('');
    }
  }, [subjects]);

  const startQuiz = async () => {
    if (!selectedSubjectName) {
      setError('科目を選択してください。');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/quiz/start/${selectedSubjectName}?mode=${quizMode}&count=${numQuestions}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'クイズの開始に失敗しました。');
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
  };

  const handleAnswerSubmit = async () => {
    if (selectedAnswer === null) return;

    setIsAnswered(true);
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;
    const isCorrect = selectedAnswer === currentQuestion.answer;

    if (isCorrect) {
      setScore(prev => prev + 1);
    }

    // try {
    //   await fetch(`${API_BASE_URL}/history`, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       problem_id: currentQuestion.id,
    //       subject: selectedSubjectName,
    //       selected_answer: selectedAnswer,
    //       is_correct: isCorrect,
    //     }),
    //   });
    // } catch (e) {
    //   console.error("Failed to submit history:", e);
    // }
    
    const explanation = currentQuestion.explanation || "この問題の解説はありません。";
    setFeedback({ correct: isCorrect, explanation });
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      resetQuestionState();
    } else {
      setQuizState('finished');
    }
  };

  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

  if (subjects.length === 0) {
    return (
      <div className="text-center text-gray-400">
        <h2 className="text-2xl font-bold mb-4">練習問題</h2>
        <p>科目がありません。「データ管理」ページで問題データをアップロードしてください。</p>
      </div>
    );
  }

  if (quizState === 'setup') {
    return (
      <div className="max-w-lg mx-auto">
        <h2 className="text-3xl font-bold text-white text-center mb-8">クイズの設定</h2>
        <div className="bg-gray-800 rounded-xl shadow-lg p-8">
          <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-gray-300">科目</label>
              <select id="subject" value={selectedSubjectName} onChange={e => setSelectedSubjectName(e.target.value)} className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                <option value="" disabled>科目を選択...</option>
                {subjects.map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">モード</label>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" onClick={() => setQuizMode('random')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>ランダム</button>
                <button type="button" onClick={() => setQuizMode('weak_area')} className={`px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>苦手分野</button>
              </div>
            </div>
            <div>
              <label htmlFor="num-questions" className="block text-sm font-medium text-gray-300">問題数</label>
              <input type="number" id="num-questions" value={numQuestions} onChange={e => setNumQuestions(Math.max(1, parseInt(e.target.value) || 1))} className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
          </form>
          <div className="mt-6">
            <button type="button" onClick={startQuiz} disabled={isLoading || !selectedSubjectName} className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500">
              {isLoading ? <LoaderIcon className="w-5 h-5" /> : null}
              {isLoading ? 'クイズ準備中...' : '演習開始'}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
        </div>
      </div>
    );
  }

  if (quizState === 'finished') {
    return (
      <div className="text-center max-w-lg mx-auto">
        <h2 className="text-3xl font-bold text-white mb-4">クイズ完了！</h2>
        <div className="bg-gray-800 rounded-xl p-8">
          <p className="text-lg text-gray-300">あなたのスコア：</p>
          <p className="text-6xl font-bold text-indigo-400 my-4">{questions.length > 0 ? Math.round((score / questions.length) * 100) : 0}%</p>
          <p className="text-gray-400">{questions.length}問中{score}問正解しました。</p>
          <button type="button" onClick={() => setQuizState('setup')} className="mt-8 px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700">
            もう一度挑戦する
          </button>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="flex justify-center items-center h-full">
        <LoaderIcon className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">{selectedSubjectName}</h2>
        <p className="text-gray-400">問題 {currentQuestionIndex + 1} / {questions.length}</p>
      </div>
      <div className="bg-gray-800 rounded-xl shadow-lg p-6 md:p-8">
        <p className="text-lg font-semibold text-gray-200 mb-6">{currentQuestion.question_text}</p>
        <div className="space-y-3">
          {currentQuestion.choices.map((option, index) => {
            const isCorrectAnswer = option === currentQuestion.answer;
            const isSelectedAnswer = option === selectedAnswer;
            let buttonClass = 'bg-gray-700 hover:bg-gray-600';
            if (isAnswered) {
              if (isCorrectAnswer) {
                buttonClass = 'bg-green-500/50 border-green-500';
              } else if (isSelectedAnswer) {
                buttonClass = 'bg-red-500/50 border-red-500';
              } else {
                buttonClass = 'bg-gray-700 opacity-60';
              }
            } else if (isSelectedAnswer) {
              buttonClass = 'bg-indigo-600';
            }
            return (
              <button
                type="button"
                key={index}
                onClick={() => !isAnswered && setSelectedAnswer(option)}
                disabled={isAnswered}
                className={`w-full text-left p-4 rounded-lg border border-transparent transition-all duration-200 ${buttonClass}`}
              >
                {option}
              </button>
            );
          })}
        </div>
        <div className="mt-6 text-center">
          {!isAnswered ? (
            <button type="button" onClick={handleAnswerSubmit} disabled={selectedAnswer === null} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed">
              解答する
            </button>
          ) : (
            <button type="button" onClick={handleNextQuestion} className="px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-gray-600 hover:bg-gray-500">
              {currentQuestionIndex < questions.length - 1 ? '次の問題へ' : 'クイズを終了'}
            </button>
          )}
        </div>
      </div>
      {isAnswered && (
        <div className="mt-6 bg-gray-800 rounded-xl shadow-lg p-6 md:p-8 fade-in">
          <div className="flex items-center gap-3 mb-4">
            {feedback?.correct ? <CheckCircleIcon className="w-8 h-8 text-green-400" /> : <XCircleIcon className="w-8 h-8 text-red-400" />}
            <h3 className="text-2xl font-bold">{feedback?.correct ? '正解！' : '不正解'}</h3>
          </div>
          <h4 className="text-lg font-semibold text-indigo-400 mb-2">解説</h4>
          <div className="prose prose-invert prose-sm md:prose-base max-w-none text-gray-300">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{feedback?.explanation || ''}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}