import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from '../components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const API_BASE_URL = "http://127.0.0.1:8000/api";
export default function QuizPage({ subjects }) {
    const [selectedSubjectName, setSelectedSubjectName] = useState('');
    const [quizMode, setQuizMode] = useState('random');
    const [numQuestions, setNumQuestions] = useState(10);
    const [quizState, setQuizState] = useState('setup');
    const [questions, setQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [isAnswered, setIsAnswered] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [score, setScore] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (subjects.length > 0 && !selectedSubjectName) {
            const firstSubject = subjects[0];
            if (firstSubject) {
                setSelectedSubjectName(firstSubject.name);
            }
        }
        else if (subjects.length === 0) {
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
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setIsLoading(false);
        }
    };
    const resetQuestionState = () => {
        setSelectedAnswer(null);
        setIsAnswered(false);
        setFeedback(null);
    };
    const handleAnswerSubmit = async () => {
        if (selectedAnswer === null)
            return;
        setIsAnswered(true);
        const currentQuestion = questions[currentQuestionIndex];
        if (!currentQuestion)
            return;
        const isCorrect = selectedAnswer === currentQuestion.answer;
        if (isCorrect) {
            setScore(prev => prev + 1);
        }
        try {
            await fetch(`${API_BASE_URL}/history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    problem_id: currentQuestion.id,
                    subject: selectedSubjectName,
                    selected_answer: selectedAnswer,
                    is_correct: isCorrect,
                }),
            });
        }
        catch (e) {
            console.error("Failed to submit history:", e);
        }
        const explanation = currentQuestion.explanation || "この問題の解説はありません。";
        setFeedback({ correct: isCorrect, explanation });
    };
    const handleNextQuestion = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            resetQuestionState();
        }
        else {
            setQuizState('finished');
        }
    };
    const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);
    if (subjects.length === 0) {
        return (_jsxs("div", { className: "text-center text-gray-400", children: [_jsx("h2", { className: "text-2xl font-bold mb-4", children: "\u7DF4\u7FD2\u554F\u984C" }), _jsx("p", { children: "\u79D1\u76EE\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u300C\u30C7\u30FC\u30BF\u7BA1\u7406\u300D\u30DA\u30FC\u30B8\u3067\u554F\u984C\u30C7\u30FC\u30BF\u3092\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })] }));
    }
    if (quizState === 'setup') {
        return (_jsxs("div", { className: "max-w-lg mx-auto", children: [_jsx("h2", { className: "text-3xl font-bold text-white text-center mb-8", children: "\u30AF\u30A4\u30BA\u306E\u8A2D\u5B9A" }), _jsxs("div", { className: "bg-gray-800 rounded-xl shadow-lg p-8", children: [_jsxs("form", { onSubmit: (e) => e.preventDefault(), className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "subject", className: "block text-sm font-medium text-gray-300", children: "\u79D1\u76EE" }), _jsxs("select", { id: "subject", value: selectedSubjectName, onChange: e => setSelectedSubjectName(e.target.value), className: "mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500", children: [_jsx("option", { value: "", disabled: true, children: "\u79D1\u76EE\u3092\u9078\u629E..." }), subjects.map(s => (_jsx("option", { value: s.name, children: s.name }, s.name)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-300", children: "\u30E2\u30FC\u30C9" }), _jsxs("div", { className: "mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3", children: [_jsx("button", { type: "button", onClick: () => setQuizMode('random'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`, children: "\u30E9\u30F3\u30C0\u30E0" }), _jsx("button", { type: "button", onClick: () => setQuizMode('weak_area'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`, children: "\u82E6\u624B\u5206\u91CE" })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "num-questions", className: "block text-sm font-medium text-gray-300", children: "\u554F\u984C\u6570" }), _jsx("input", { type: "number", id: "num-questions", value: numQuestions, onChange: e => setNumQuestions(Math.max(1, parseInt(e.target.value) || 1)), className: "mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" })] })] }), _jsx("div", { className: "mt-6", children: _jsxs("button", { type: "button", onClick: startQuiz, disabled: isLoading || !selectedSubjectName, className: "w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500", children: [isLoading ? _jsx(LoaderIcon, { className: "w-5 h-5" }) : null, isLoading ? 'クイズ準備中...' : '演習開始'] }) }), error && _jsx("p", { className: "text-red-400 text-sm mt-2 text-center", children: error })] })] }));
    }
    if (quizState === 'finished') {
        return (_jsxs("div", { className: "text-center max-w-lg mx-auto", children: [_jsx("h2", { className: "text-3xl font-bold text-white mb-4", children: "\u30AF\u30A4\u30BA\u5B8C\u4E86\uFF01" }), _jsxs("div", { className: "bg-gray-800 rounded-xl p-8", children: [_jsx("p", { className: "text-lg text-gray-300", children: "\u3042\u306A\u305F\u306E\u30B9\u30B3\u30A2\uFF1A" }), _jsxs("p", { className: "text-6xl font-bold text-indigo-400 my-4", children: [questions.length > 0 ? Math.round((score / questions.length) * 100) : 0, "%"] }), _jsxs("p", { className: "text-gray-400", children: [questions.length, "\u554F\u4E2D", score, "\u554F\u6B63\u89E3\u3057\u307E\u3057\u305F\u3002"] }), _jsx("button", { type: "button", onClick: () => setQuizState('setup'), className: "mt-8 px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700", children: "\u3082\u3046\u4E00\u5EA6\u6311\u6226\u3059\u308B" })] })] }));
    }
    if (!currentQuestion) {
        return (_jsx("div", { className: "flex justify-center items-center h-full", children: _jsx(LoaderIcon, { className: "w-8 h-8" }) }));
    }
    return (_jsxs("div", { className: "max-w-3xl mx-auto", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-white", children: selectedSubjectName }), _jsxs("p", { className: "text-gray-400", children: ["\u554F\u984C ", currentQuestionIndex + 1, " / ", questions.length] })] }), _jsxs("div", { className: "bg-gray-800 rounded-xl shadow-lg p-6 md:p-8", children: [_jsx("p", { className: "text-lg font-semibold text-gray-200 mb-6", children: currentQuestion.question_text }), _jsx("div", { className: "space-y-3", children: currentQuestion.choices.map((option, index) => {
                            const isCorrectAnswer = option === currentQuestion.answer;
                            const isSelectedAnswer = option === selectedAnswer;
                            let buttonClass = 'bg-gray-700 hover:bg-gray-600';
                            if (isAnswered) {
                                if (isCorrectAnswer) {
                                    buttonClass = 'bg-green-500/50 border-green-500';
                                }
                                else if (isSelectedAnswer) {
                                    buttonClass = 'bg-red-500/50 border-red-500';
                                }
                                else {
                                    buttonClass = 'bg-gray-700 opacity-60';
                                }
                            }
                            else if (isSelectedAnswer) {
                                buttonClass = 'bg-indigo-600';
                            }
                            return (_jsx("button", { type: "button", onClick: () => !isAnswered && setSelectedAnswer(option), disabled: isAnswered, className: `w-full text-left p-4 rounded-lg border border-transparent transition-all duration-200 ${buttonClass}`, children: option }, index));
                        }) }), _jsx("div", { className: "mt-6 text-center", children: !isAnswered ? (_jsx("button", { type: "button", onClick: handleAnswerSubmit, disabled: selectedAnswer === null, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed", children: "\u89E3\u7B54\u3059\u308B" })) : (_jsx("button", { type: "button", onClick: handleNextQuestion, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-gray-600 hover:bg-gray-500", children: currentQuestionIndex < questions.length - 1 ? '次の問題へ' : 'クイズを終了' })) })] }), isAnswered && (_jsxs("div", { className: "mt-6 bg-gray-800 rounded-xl shadow-lg p-6 md:p-8 fade-in", children: [_jsxs("div", { className: "flex items-center gap-3 mb-4", children: [feedback?.correct ? _jsx(CheckCircleIcon, { className: "w-8 h-8 text-green-400" }) : _jsx(XCircleIcon, { className: "w-8 h-8 text-red-400" }), _jsx("h3", { className: "text-2xl font-bold", children: feedback?.correct ? '正解！' : '不正解' })] }), _jsx("h4", { className: "text-lg font-semibold text-indigo-400 mb-2", children: "\u89E3\u8AAC" }), _jsx("div", { className: "prose prose-invert prose-sm md:prose-base max-w-none text-gray-300", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm], children: feedback?.explanation || '' }) })] }))] }));
}
//# sourceMappingURL=QuizPage.js.map