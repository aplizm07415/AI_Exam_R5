import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LoadingSpinner from './components/LoadingSpinner';
import SubjectVisibilityModal from './components/SubjectVisibilityModal';
import SubjectProgress from './components/SubjectProgress';
import { usePlans } from './hooks/usePlans';
import { isHoliday, getMinutesUntilJstHour, getNowJstParts } from './utils/date';
const API_BASE_URL = "/api";
const QUESTION_TIMER_MS = 2 * 60 * 1000;
const FORCED_ANSWER_TIMER_MS = 80 * 1000;
function TimerProgressBar({ durationMs, isActive, resetToken, onExpire, }) {
    const [remainingRatio, setRemainingRatio] = useState(1);
    const expireHandledRef = useRef(false);
    useEffect(() => {
        setRemainingRatio(1);
        expireHandledRef.current = false;
        if (!isActive) {
            return;
        }
        const startedAt = Date.now();
        const tick = () => {
            const elapsed = Math.max(0, Date.now() - startedAt);
            const nextRatio = Math.max(0, Math.min(1, 1 - elapsed / durationMs));
            setRemainingRatio(nextRatio);
            if (elapsed >= durationMs && !expireHandledRef.current) {
                expireHandledRef.current = true;
                onExpire?.();
            }
        };
        tick();
        const id = window.setInterval(tick, 250);
        return () => window.clearInterval(id);
    }, [durationMs, isActive, onExpire, resetToken]);
    return (_jsx("div", { className: "w-full h-2.5 rounded-full bg-gray-200/90 border border-gray-200 mb-6 pointer-events-none", "aria-hidden": "true", children: _jsx("div", { className: "h-full rounded-full bg-[#a2c2e6] transition-[width] duration-200 ease-linear", style: { width: `${remainingRatio * 100}%` } }) }));
}
export default function QuizPage({ subjects: allSubjects }) {
    const { plans, isLoading: isPlansLoading, error: plansError } = usePlans();
    const [dailySummaryAll, setDailySummaryAll] = useState([]);
    const [selectedSubjectNames, setSelectedSubjectNames] = useState([]);
    const [quizMode, setQuizMode] = useState('today_remaining');
    const [numQuestions, setNumQuestions] = useState(10);
    const [quizState, setQuizState] = useState('setup');
    const [isForcedSession, setIsForcedSession] = useState(false);
    const [questions, setQuestions] = useState([]);
    const [historyStats, setHistoryStats] = useState({});
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [isAnswered, setIsAnswered] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [score, setScore] = useState(0);
    const [scratchpadText, setScratchpadText] = useState('');
    const [customExplanationText, setCustomExplanationText] = useState('');
    const [previewImageUrl, setPreviewImageUrl] = useState(null);
    const [editingMemo, setEditingMemo] = useState(null);
    const [editingProblem, setEditingProblem] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
    const [isSavingCustomExplanation, setIsSavingCustomExplanation] = useState(false);
    const [error, setError] = useState('');
    const [effectStatus, setEffectStatus] = useState(null);
    const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
    const openMemoModal = (type) => {
        const content = type === 'scratchpad' ? scratchpadText : customExplanationText;
        setEditingMemo({ type, content });
    };
    const handleSaveAndCloseModal = () => {
        if (!editingMemo)
            return;
        if (editingMemo.type === 'scratchpad') {
            setScratchpadText(editingMemo.content);
        }
        else {
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
    const handleProblemFormChange = (e) => {
        if (!editingProblem)
            return;
        const { name, value } = e.target;
        if (name.startsWith('explanation.')) {
            const key = name.split('.')[1];
            setEditingProblem({
                ...editingProblem,
                explanation: {
                    ...editingProblem.explanation,
                    [key]: value,
                },
            });
        }
        else {
            setEditingProblem({ ...editingProblem, [name]: value });
        }
    };
    const handleProblemChoiceChange = (index, field, value) => {
        if (!editingProblem)
            return;
        const newChoices = [...editingProblem.choices];
        newChoices[index] = { ...newChoices[index], [field]: value };
        setEditingProblem({ ...editingProblem, choices: newChoices });
    };
    const handleSaveChanges = async () => {
        if (!editingProblem)
            return;
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
            const updatedQuestions = questions.map(q => q.id === editingProblem.id ? { ...q, ...updatedProblem } : q);
            setQuestions(updatedQuestions);
            setEditingProblem(null); // モーダルを閉じる
        }
        catch (error) {
            console.error("Failed to save problem changes:", error);
            alert(`保存に失敗しました: ${error.message}`);
        }
    };
    // --- End of Problem Editing Functions ---
    const [subjectWeights, setSubjectWeights] = useState(() => {
        try {
            const saved = localStorage.getItem('subjectWeights');
            return saved ? JSON.parse(saved) : {};
        }
        catch (error) {
            console.error('Failed to parse subjectWeights from localStorage', error);
            return {};
        }
    });
    const [unansweredCount, setUnansweredCount] = useState(null);
    const [isCountLoading, setIsCountLoading] = useState(false);
    const [weakAreaCount, setWeakAreaCount] = useState(null);
    const [isWeakCountLoading, setIsWeakCountLoading] = useState(false);
    useEffect(() => {
        localStorage.setItem('subjectWeights', JSON.stringify(subjectWeights));
    }, [subjectWeights]);
    useEffect(() => {
        const fetchDailySummaryAll = async () => {
            const planSubjects = Array.from(new Set(plans.filter(p => p.enabled).flatMap(p => p.subjectNames)));
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
                }
                else {
                    // エラーレスポンスのテキストをログに出力
                    const errorText = await response.text();
                    console.error("Failed to fetch filtered daily summary:", response.status, errorText);
                    setDailySummaryAll([]); // エラーの場合は空にする
                }
            }
            catch (error) {
                console.error("Failed to fetch all daily summary:", error);
                setDailySummaryAll([]); // エラーの場合は空にする
            }
        };
        if (!isPlansLoading) {
            fetchDailySummaryAll();
        }
    }, [plans, isPlansLoading]);
    const todayRemaining = useMemo(() => {
        if (isPlansLoading)
            return { count: 0, subjects: [], plan: 0, actual: 0 };
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of today in local timezone
        const parseDateLocal = (dateString) => {
            const [year, month, day] = dateString.split('-').map(Number);
            const date = new Date(year, month - 1, day);
            date.setHours(0, 0, 0, 0);
            return date;
        };
        let cumulativePlannedTotal = 0; // Accumulates all planned questions up to today
        const targetSubjects = new Set();
        console.log("--- Today Remaining Debug Start ---");
        console.log("Debug: Today (local start of day):", today.toISOString());
        console.log("Debug: Plans available:", plans.length);
        plans.filter((p) => p.enabled).forEach((plan, planIndex) => {
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
                    plan.subjectNames.forEach((name) => targetSubjects.add(name));
                    currentDate.setDate(currentDate.getDate() + 1); // Move to next day
                }
                console.log(`Debug: Plan ${planIndex + 1} cumulative for loop: Planned=${planDailyPlanned}`);
            }
            else {
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
    const [hiddenSubjects, setHiddenSubjects] = useState(() => {
        try {
            const saved = localStorage.getItem('hiddenSubjects');
            return saved ? JSON.parse(saved) : [];
        }
        catch (error) {
            console.error('Failed to parse hiddenSubjects from localStorage', error);
            return [];
        }
    });
    const [isVisibilityModalOpen, setIsVisibilityModalOpen] = useState(false);
    const visibleSubjects = useMemo(() => {
        return allSubjects.filter((s) => !hiddenSubjects.includes(s.name));
    }, [allSubjects, hiddenSubjects]);
    const handleHiddenSubjectsChange = (newHiddenSubjects) => {
        setHiddenSubjects(newHiddenSubjects);
        localStorage.setItem('hiddenSubjects', JSON.stringify(newHiddenSubjects));
        setSelectedSubjectNames((prev) => prev.filter((name) => !newHiddenSubjects.includes(name)));
    };
    useEffect(() => {
        const fetchUnansweredCount = async () => {
            if (quizMode === 'unanswered' && selectedSubjectNames.length > 0) {
                setIsCountLoading(true);
                setUnansweredCount(null);
                try {
                    const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
                    const response = await fetch(`${API_BASE_URL}/quiz/unanswered-count?${subjectParams}`);
                    if (!response.ok) {
                        throw new Error('Failed to fetch unanswered count.');
                    }
                    const data = await response.json();
                    setUnansweredCount(data.unanswered_count);
                }
                catch (error) {
                    console.error(error);
                }
                finally {
                    setIsCountLoading(false);
                }
            }
            else {
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
                    const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
                    const response = await fetch(`${API_BASE_URL}/quiz/missed-problems-count?${subjectParams}`);
                    if (!response.ok) {
                        throw new Error('Failed to fetch weak area count.');
                    }
                    const data = await response.json();
                    setWeakAreaCount(data.missed_problems_count);
                }
                catch (error) {
                    console.error(error);
                }
                finally {
                    setIsWeakCountLoading(false);
                }
            }
            else {
                setWeakAreaCount(null);
            }
        };
        fetchWeakAreaCount();
    }, [quizMode, selectedSubjectNames]);
    const fetchHistoryStats = useCallback(async () => {
        if (questions.length === 0) {
            setHistoryStats({});
            return;
        }
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
        }
        catch (fetchError) {
            console.error("Failed to fetch history stats:", fetchError);
        }
    }, [questions, selectedSubjectNames]);
    useEffect(() => {
        fetchHistoryStats();
    }, [fetchHistoryStats]);
    const handleSubjectSelection = (subjectName) => {
        setSelectedSubjectNames((prev) => prev.includes(subjectName)
            ? prev.filter((s) => s !== subjectName)
            : [...prev, subjectName]);
    };
    const startQuiz = async (forcedSession = false) => {
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
        }
        else if (quizMode === 'unanswered') {
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
                }
                else {
                    setError('出題できる問題がありません。');
                }
                setIsLoading(false);
                return;
            }
            setQuestions(data.quiz_set);
            setCurrentQuestionIndex(0);
            setScore(0);
            setIsForcedSession(forcedSession);
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
    const openIpadMode = () => {
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
        }
        else if (quizMode === 'unanswered') {
            if (unansweredCount === null || unansweredCount === 0) {
                setError('未解答の問題はありません。');
                return;
            }
            questionsToFetch = Math.min(numQuestions, unansweredCount);
        }
        else if (quizMode === 'weak_area') {
            if (weakAreaCount === null || weakAreaCount === 0) {
                setError('苦手問題はありません。');
                return;
            }
            questionsToFetch = Math.min(numQuestions, weakAreaCount);
        }
        const subjectQuery = selectedSubjectNames
            .map((s) => `subject=${encodeURIComponent(s)}`)
            .join('&');
        const deepLink = `quizapp://quiz?base=${encodeURIComponent(window.location.origin)}` +
            `&${subjectQuery}` +
            `&mode=${encodeURIComponent(quizMode)}` +
            `&count=${encodeURIComponent(String(Math.max(1, questionsToFetch)))}`;
        window.location.href = deepLink;
    };
    const resetQuestionState = () => {
        setSelectedAnswer(null);
        setIsAnswered(false);
        setFeedback(null);
        setScratchpadText('');
        setCustomExplanationText('');
        setQuestionStartedAt(Date.now());
    };
    const estimatedCompletionText = useMemo(() => {
        const remainingQuestions = Math.max(0, todayRemaining.count);
        const totalMinutes = remainingQuestions * 2;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0) {
            return `${hours}時間${minutes}分`;
        }
        return `${minutes}分`;
    }, [todayRemaining.count]);
    const todayRemainingPaceHint = useMemo(() => {
        const { hour } = getNowJstParts();
        if (hour < 7 || hour >= 21)
            return null;
        const remainingQuestions = Math.max(0, todayRemaining.count);
        if (remainingQuestions === 0)
            return '今日の予定は完了しています。';
        const remainingHoursRaw = getMinutesUntilJstHour(21) / 60;
        const remainingHoursFloor = Math.max(1, Math.floor(remainingHoursRaw));
        const targetPerHour = Math.max(1, Math.ceil(remainingQuestions / remainingHoursFloor));
        const nextHour = Math.min(hour + 1, 21);
        return `${nextHour}時までにあと${targetPerHour}問で順調ペース`;
    }, [todayRemaining.count]);
    const handleAnswerSubmit = async (forcedSubmission = false) => {
        if (isSubmittingAnswer)
            return;
        if (selectedAnswer === null && !forcedSubmission)
            return;
        const currentQuestion = questions[currentQuestionIndex];
        if (!currentQuestion)
            return;
        const submittedAnswer = selectedAnswer ?? '';
        const isCorrect = submittedAnswer === currentQuestion.answer;
        try {
            setIsSubmittingAnswer(true);
            setError('');
            const response = await fetch(`${API_BASE_URL}/history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    problem_id: currentQuestion.id,
                    subject: currentQuestion.subject,
                    selected_answer: submittedAnswer,
                    is_correct: isCorrect,
                    category: currentQuestion.category,
                }),
            });
            if (!response.ok) {
                let detail = '実績の保存に失敗しました。';
                try {
                    const payload = await response.json();
                    detail = payload.detail || detail;
                }
                catch {
                    // no-op
                }
                throw new Error(detail);
            }
            setEffectStatus(isCorrect ? 'correct' : 'incorrect');
            setTimeout(() => setEffectStatus(null), 1000);
            if (isCorrect) {
                setScore(prev => prev + 1);
            }
            const explanation = currentQuestion.explanation || { text: "この問題の解説はありません。" };
            setFeedback({ correct: isCorrect, explanation });
            setIsAnswered(true);
        }
        catch (e) {
            console.error("Failed to submit history:", e);
            const message = e instanceof Error ? e.message : '実績の保存に失敗しました。再試行してください。';
            setError(message);
        }
        finally {
            setIsSubmittingAnswer(false);
        }
    };
    const handleNextQuestion = async () => {
        // メモが変更されていたら保存する
        const originalText = currentQuestion?.custom_explanation || '';
        if (customExplanationText.trim() !== originalText.trim()) {
            try {
                await handleSaveCustomExplanation();
            }
            catch (e) {
                const message = e instanceof Error ? e.message : 'My Memo の保存に失敗しました。';
                setError(message);
                return;
            }
        }
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            resetQuestionState();
        }
        else {
            setIsForcedSession(false);
            setQuizState('finished');
        }
    };
    const handleTryAgain = () => {
        if (quizMode === 'unanswered') {
            setQuizState('setup');
        }
        else {
            startQuiz(isForcedSession);
        }
    };
    const handleSaveCustomExplanation = async () => {
        if (!currentQuestion)
            return;
        try {
            setIsSavingCustomExplanation(true);
            const response = await fetch(`${API_BASE_URL}/problems/${currentQuestion.id}/custom-explanation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: customExplanationText,
                    image_data_url: currentQuestion.custom_explanation_image_data_url ?? null,
                }),
            });
            if (!response.ok) {
                let detail = 'My Memo の保存に失敗しました。';
                try {
                    const payload = await response.json();
                    detail = payload.detail || detail;
                }
                catch {
                    // no-op
                }
                throw new Error(detail);
            }
            // Update the question in the main questions array to persist state during the session
            const updatedQuestions = questions.map((q) => q.id === currentQuestion.id
                ? {
                    ...q,
                    custom_explanation: customExplanationText,
                    custom_explanation_image_data_url: currentQuestion.custom_explanation_image_data_url,
                }
                : q);
            setQuestions(updatedQuestions);
        }
        catch (error) {
            console.error("Failed to save custom explanation:", error);
            throw error;
        }
        finally {
            setIsSavingCustomExplanation(false);
        }
    };
    const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);
    useEffect(() => {
        if (currentQuestion) {
            setCustomExplanationText(currentQuestion.custom_explanation || '');
        }
    }, [currentQuestion]);
    useEffect(() => {
        const handleKeyPress = (event) => {
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
                if (!isAnswered && !isSubmittingAnswer && submitButton) {
                    submitButton.click();
                }
                else if (isAnswered && !isSavingCustomExplanation) {
                    handleNextQuestion();
                }
            }
        };
        window.addEventListener('keydown', handleKeyPress);
        return () => {
            window.removeEventListener('keydown', handleKeyPress);
        };
    }, [quizState, isAnswered, currentQuestion, handleAnswerSubmit, handleNextQuestion, isSubmittingAnswer, isSavingCustomExplanation]);
    // --- Render logic for active quiz ---
    const renderActiveQuiz = () => {
        if (!currentQuestion)
            return null;
        const hasImages = currentQuestion.image_urls && currentQuestion.image_urls.length > 0;
        // レイアウトの決定ロジック
        let layoutType = 'default';
        if (hasImages) {
            layoutType = 'image';
        }
        else if (isAnswered) {
            layoutType = 'answered';
        }
        const imagesComponent = hasImages ? (_jsx("div", { className: "space-y-4", children: currentQuestion.image_urls.map((url, index) => (_jsx("img", { src: url, alt: `Question image ${index + 1}`, className: "max-w-full w-full h-auto mx-auto rounded-lg shadow-md" }, index))) })) : null;
        const explanationComponent = isAnswered ? (_jsxs("div", { className: "bg-white rounded-xl shadow p-6 md:p-8 fade-in", children: [_jsxs("div", { className: "flex items-center gap-3 mb-4", children: [feedback?.correct ? _jsx(CheckCircleIcon, { className: "w-8 h-8 text-green-600" }) : _jsx(XCircleIcon, { className: "w-8 h-8 text-red-600" }), _jsx("h3", { className: "text-xl md:text-2xl font-bold", children: feedback?.correct ? '正解！' : '不正解' })] }), _jsx("h4", { className: "text-base md:text-lg font-semibold text-primary-new mb-2", children: "\u89E3\u8AAC" }), (currentQuestion.explanation_image_urls && currentQuestion.explanation_image_urls.length > 0) && (_jsx("div", { className: "my-4 grid grid-cols-1 gap-4", children: currentQuestion.explanation_image_urls.map((url, index) => (_jsx("img", { src: url, alt: `Explanation image ${index + 1}`, className: "max-w-full h-auto mx-auto rounded-lg shadow-md" }, index))) })), _jsx("div", { className: "prose prose-sm md:prose-base max-w-none text-gray-700", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm], children: feedback?.explanation?.text || '' }) }), currentQuestion.custom_explanation_image_data_url && (_jsxs("div", { className: "mt-6", children: [_jsx("h4", { className: "text-base md:text-lg font-semibold text-primary-new mb-2", children: "My Memo\u753B\u50CF" }), _jsx("button", { type: "button", onClick: () => setPreviewImageUrl(currentQuestion.custom_explanation_image_data_url ?? null), className: "block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50", children: _jsx("img", { src: currentQuestion.custom_explanation_image_data_url, alt: "My Memo handwrite", className: "max-h-48 w-full object-contain" }) })] })), _jsxs("div", { className: "mt-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-2", children: [_jsx("h4", { className: "text-base md:text-lg font-semibold text-primary-new", children: "My Memo" }), _jsx("button", { onClick: () => openMemoModal('customExplanation'), className: "p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700", title: "\u62E1\u5927\u8868\u793A", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "1em", height: "1em", viewBox: "0 0 24 24", children: _jsx("path", { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "2", d: "M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4" }) }) })] }), _jsx("textarea", { value: customExplanationText, onChange: (e) => setCustomExplanationText(e.target.value), className: "w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new", rows: 4 })] }), _jsxs("div", { className: "mt-6 pt-4 border-t border-gray-200 flex justify-between items-center", children: [_jsx("button", { onClick: openProblemEditor, className: "px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200", children: "\u3053\u306E\u554F\u984C\u3092\u7DE8\u96C6\u3059\u308B" }), _jsx("button", { id: "next-question-button-bottom", type: "button", onClick: handleNextQuestion, disabled: isSavingCustomExplanation, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-dark bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed", children: currentQuestionIndex < questions.length - 1 ? '次の問題へ' : '終了' })] })] })) : null;
        // 左カラム（問題・選択肢）
        const QuestionColumn = () => (_jsxs("div", { className: "bg-white rounded-xl shadow p-6 md:p-8 h-full flex flex-col", children: [_jsx("p", { className: "text-base md:text-lg font-semibold text-gray-700 mb-6", children: currentQuestion.question_text }), _jsx(TimerProgressBar, { durationMs: isForcedSession ? FORCED_ANSWER_TIMER_MS : QUESTION_TIMER_MS, isActive: quizState === 'active' && !isAnswered && !isSubmittingAnswer, resetToken: `${currentQuestion.id}-${questionStartedAt}-${isForcedSession ? 'forced' : 'normal'}`, onExpire: isForcedSession ? () => void handleAnswerSubmit(true) : undefined }), _jsx("div", { className: "md:hidden my-4", children: layoutType === 'image' && imagesComponent }), _jsx("div", { className: "space-y-3", children: currentQuestion.choices.map((option, index) => {
                        const isCorrectAnswer = option.label === currentQuestion.answer;
                        const isSelectedAnswer = option.label === selectedAnswer;
                        let buttonClass = 'bg-gray-100 hover:bg-gray-200';
                        if (isAnswered) {
                            if (isCorrectAnswer)
                                buttonClass = 'bg-success/50 border-success';
                            else if (isSelectedAnswer)
                                buttonClass = 'bg-danger/50 border-danger';
                            else
                                buttonClass = 'bg-gray-100 opacity-60';
                        }
                        else if (isSelectedAnswer) {
                            buttonClass = 'bg-primary-new';
                        }
                        return (_jsxs("button", { type: "button", onClick: () => !isAnswered && setSelectedAnswer(option.label), disabled: isAnswered, className: `w-full text-left p-4 rounded-lg border border-transparent transition-all duration-200 text-sm md:text-base ${buttonClass}`, children: [_jsxs("span", { className: "font-bold mr-2", children: [option.label, "."] }), _jsx("span", { children: option.text })] }, index));
                    }) }), _jsxs("div", { className: "mt-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-2", children: [_jsx("label", { htmlFor: "scratchpad", className: "block text-sm font-medium text-gray-700", children: "\u30E1\u30E2\u5E33" }), _jsx("button", { onClick: () => openMemoModal('scratchpad'), className: "p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700", title: "\u62E1\u5927\u8868\u793A", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "1em", height: "1em", viewBox: "0 0 24 24", children: _jsx("path", { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "2", d: "M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4" }) }) })] }), _jsx("textarea", { id: "scratchpad", value: scratchpadText, onChange: (e) => setScratchpadText(e.target.value), className: "w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new", rows: 3 }), !isAnswered && ( // Moved "解答する" button here
                        _jsx("div", { className: "mt-6 text-center", children: _jsx("button", { id: "submit-answer-button", type: "button", onClick: () => void handleAnswerSubmit(), disabled: selectedAnswer === null || isSubmittingAnswer, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed", children: isSubmittingAnswer ? '保存中...' : '解答する' }) }))] }), isAnswered && ( // This div now only contains "次の問題へ" button, and retains mt-auto
                _jsx("div", { className: "mt-auto pt-6 text-center", children: _jsx("button", { id: "next-question-button", type: "button", onClick: handleNextQuestion, disabled: isSavingCustomExplanation, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-dark bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed", children: currentQuestionIndex < questions.length - 1 ? '次の問題へ' : '終了' }) }))] }));
        // 右カラム（画像・解説）
        const RightColumn = () => (_jsxs("div", { className: "space-y-8", children: [layoutType === 'image' && (_jsx("div", { className: "bg-white rounded-xl shadow p-6 md:p-8", children: imagesComponent })), explanationComponent] }));
        const progressPercentage = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0;
        return (_jsxs("div", { className: "md:h-screen md:overflow-hidden text-sm md:text-base", children: [_jsxs("div", { className: "p-4 md:p-6", children: [_jsx("div", { className: "flex justify-end items-center mb-2", children: _jsxs("div", { className: "flex items-center gap-4", children: [isForcedSession && (_jsx("div", { className: "text-sm font-semibold text-[#e8383d] whitespace-nowrap", children: "\u5F37\u5236\u30E2\u30FC\u30C9: 80\u79D2" })), (() => {
                                        const stats = historyStats[currentQuestion.id];
                                        if (stats && stats.total > 0) {
                                            return (_jsxs("div", { className: "text-sm text-gray-500 whitespace-nowrap", children: ["\u76F4\u8FD1", stats.total, "\u56DE \u6B63\u7B54\u7387: ", Math.round((stats.correct / stats.total) * 100), "% (", stats.correct, "/", stats.total, ")"] }));
                                        }
                                        if (Object.keys(historyStats).length > 0) {
                                            return _jsx("div", { className: "text-sm text-gray-500 whitespace-nowrap", children: "\u521D\u6311\u6226" });
                                        }
                                        return null;
                                    })(), _jsxs("p", { className: "text-gray-500", children: ["\u554F\u984C ", currentQuestionIndex + 1, " / ", questions.length] })] }) }), _jsx("div", { className: "w-full bg-gray-200 rounded-full h-2.5", children: _jsx("div", { className: "bg-primary-new h-2.5 rounded-full transition-all duration-500", style: { width: `${progressPercentage}%` } }) })] }), _jsxs("div", { className: `
                md:grid md:gap-8 md:h-[calc(100vh-120px)] // Adjusted height for progress bar
                ${layoutType === 'image' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'answered' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'default' ? 'md:grid-cols-1' : ''}
            `, children: [_jsx("div", { className: `
                px-4 md:px-0 md:pl-6
                ${layoutType === 'image' ? 'md:col-span-1' : ''}
                ${layoutType === 'answered' ? 'md:col-span-1' : ''}
                ${layoutType !== 'default' ? 'md:h-full md:overflow-y-auto' : ''}
              `, children: _jsx(QuestionColumn, {}) }), layoutType !== 'default' && (_jsx("div", { className: `
                  hidden md:block md:pr-6
                  ${layoutType === 'image' ? 'md:col-span-2' : ''}
                  ${layoutType === 'answered' ? 'md:col-span-2' : ''}
                  md:h-full md:overflow-y-auto
                `, children: _jsx(RightColumn, {}) })), _jsx("div", { className: "md:hidden mt-8 px-4", children: explanationComponent })] })] }));
    };
    return (_jsxs(_Fragment, { children: [_jsx(SubjectVisibilityModal, { isOpen: isVisibilityModalOpen, onClose: () => setIsVisibilityModalOpen(false), subjects: allSubjects, hiddenSubjects: hiddenSubjects, onHiddenSubjectsChange: handleHiddenSubjectsChange, quizMode: quizMode, subjectWeights: subjectWeights, onSubjectWeightsChange: setSubjectWeights }), effectStatus && (_jsx("div", { className: "feedback-overlay", children: _jsx("div", { className: `feedback-icon ${effectStatus} feedback-effect-animation`, children: effectStatus === 'correct' ? '○' : '×' }) })), _jsxs("div", { className: quizState === 'active' ? "w-full" : "max-w-3xl mx-auto", children: [quizState === 'setup' && ((isLoading || isPlansLoading) ? (_jsx(LoadingSpinner, {})) : (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-8", children: [_jsxs("form", { onSubmit: (e) => e.preventDefault(), className: "space-y-6", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u79D1\u76EE (\u8907\u6570\u9078\u629E\u53EF)" }), _jsx("button", { onClick: () => setIsVisibilityModalOpen(true), className: "p-1 rounded-md hover:bg-gray-200", title: "\u8868\u793A\u79D1\u76EE\u306E\u5236\u5FA1", children: _jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-5 w-5 text-gray-600", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: [_jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })] }) })] }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3", children: visibleSubjects.map((s) => {
                                                            const isSelected = selectedSubjectNames.includes(s.name);
                                                            const isTodayMode = quizMode === 'today_remaining';
                                                            let buttonClass = 'px-3 py-2 rounded-md text-sm font-medium text-left truncate transition-colors ';
                                                            if (isTodayMode) {
                                                                if (isSelected) {
                                                                    // 予定に含まれる科目: 少し薄く
                                                                    buttonClass += 'bg-primary-new text-white shadow-sm opacity-75 cursor-not-allowed';
                                                                }
                                                                else {
                                                                    // 予定に含まれない科目: グレーアウト
                                                                    buttonClass += 'bg-gray-100 text-gray-400 cursor-not-allowed';
                                                                }
                                                            }
                                                            else {
                                                                if (isSelected) {
                                                                    // 通常選択時のスタイル
                                                                    buttonClass += 'bg-primary-new text-white shadow-sm';
                                                                }
                                                                else {
                                                                    // 通常非選択時のスタイル
                                                                    buttonClass += 'bg-gray-200 text-gray-700 hover:bg-gray-300';
                                                                }
                                                            }
                                                            return (_jsx("button", { type: "button", onClick: () => handleSubjectSelection(s.name), disabled: isTodayMode, className: buttonClass, children: s.name }, s.name));
                                                        }) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u30E2\u30FC\u30C9" }), _jsxs("div", { className: "mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3", children: [_jsx("button", { type: "button", onClick: () => setQuizMode('today_remaining'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'today_remaining' ? 'bg-[#e8383d] text-white' : 'bg-red-100 text-gray-700 hover:bg-red-200'}`, children: "\u4ECA\u65E5\u306E\u6B8B\u308A" }), _jsx("button", { type: "button", onClick: () => setQuizMode('random'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u30E9\u30F3\u30C0\u30E0" }), _jsx("button", { type: "button", onClick: () => setQuizMode('weak_area'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u82E6\u624B\u514B\u670D" }), _jsx("button", { type: "button", onClick: () => setQuizMode('unanswered'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u672A\u89E3\u7B54\u554F\u984C" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u554F\u984C\u6570" }), _jsxs("div", { className: "mt-2 text-sm text-gray-500 mb-2", children: [quizMode === 'today_remaining' && `(今日の残り: ${todayRemaining.count} 問 (予定:${todayRemaining.plan} / 実績:${todayRemaining.actual}) / 2分/問で約${estimatedCompletionText})`, quizMode === 'today_remaining' && todayRemainingPaceHint && (_jsx("div", { className: "mt-1 text-xs font-medium text-[#e8383d]", children: todayRemainingPaceHint })), quizMode === 'unanswered' && unansweredCount !== null && `(未解答: ${unansweredCount} 問)`, quizMode === 'weak_area' && weakAreaCount !== null && `(苦手問題: ${weakAreaCount} 問)`] }), _jsx("div", { className: "mt-2 grid grid-cols-5 gap-3", children: [
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
                                                                }
                                                                else if (quizMode === 'unanswered' && unansweredCount !== null) {
                                                                    actualButtonValue = unansweredCount;
                                                                    displayButtonLabel = `MAX (${unansweredCount})`;
                                                                }
                                                                else if (quizMode === 'weak_area' && weakAreaCount !== null) {
                                                                    actualButtonValue = weakAreaCount;
                                                                    displayButtonLabel = `MAX (${weakAreaCount})`;
                                                                }
                                                            }
                                                            const isDisabled = (quizMode === 'today_remaining' && actualButtonValue > todayRemaining.count) ||
                                                                (quizMode === 'unanswered' && unansweredCount !== null && actualButtonValue > unansweredCount) ||
                                                                (quizMode === 'weak_area' && weakAreaCount !== null && actualButtonValue > weakAreaCount) ||
                                                                actualButtonValue <= 0; // Disable if value is 0 or less
                                                            return (_jsx("button", { type: "button", onClick: () => setNumQuestions(actualButtonValue), disabled: isDisabled, className: `px-2 py-2 rounded-md text-sm font-medium transition-colors ${numQuestions === actualButtonValue && !isDisabled
                                                                    ? 'bg-primary-new text-white'
                                                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'}`, children: displayButtonLabel }, option.label));
                                                        }) })] })] }), _jsxs("div", { className: "mt-6", children: [_jsxs("button", { type: "button", onClick: () => void startQuiz(), disabled: isLoading || selectedSubjectNames.length === 0, className: "w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-primary-new", children: [isLoading ? _jsx(LoaderIcon, { className: "w-5 h-5" }) : null, isLoading ? 'クイズ準備中...' : 'Start'] }), _jsx("button", { type: "button", onClick: openIpadMode, disabled: isLoading || selectedSubjectNames.length === 0, className: "mt-3 w-full py-3 px-4 border border-cyan-600 rounded-md shadow-sm text-base font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed", children: "iPad\u30E2\u30FC\u30C9" }), _jsx("button", { type: "button", onClick: () => void startQuiz(true), disabled: isLoading || selectedSubjectNames.length === 0, className: "mt-3 w-full py-3 px-4 border border-[#e8383d] rounded-md shadow-sm text-base font-medium text-[#e8383d] bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed", children: "\u5F37\u5236\u30E2\u30FC\u30C9" })] }), (error || plansError) && _jsx("p", { className: "text-danger text-sm mt-2 text-center", children: error || plansError })] }), _jsx(SubjectProgress, { selectedSubjectNames: selectedSubjectNames, quizMode: quizMode })] }))), quizState === 'finished' && (_jsxs("div", { className: "text-center max-w-lg mx-auto", children: [_jsx("h2", { className: "text-3xl font-bold text-dark mb-4", children: "\u5B8C\u4E86\uFF01" }), _jsx("div", { className: "bg-white rounded-xl shadow p-8", children: _jsx("div", { className: "flex justify-center mt-2", children: _jsx("button", { type: "button", onClick: () => {
                                            setIsForcedSession(false);
                                            setQuizState('setup');
                                        }, className: "px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700", children: "\u79D1\u76EE\u9078\u629E\u306B\u9077\u79FB" }) }) })] })), quizState === 'active' && renderActiveQuiz()] }), editingMemo && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-75 z-50 flex justify-center items-center p-4", children: _jsxs("div", { className: "bg-white rounded-lg shadow-xl w-full max-w-2xl h-3/4 flex flex-col", children: [_jsx("h3", { className: "text-lg font-bold p-4 border-b", children: editingMemo.type === 'scratchpad' ? 'メモ帳' : 'My Memo' }), _jsx("textarea", { value: editingMemo.content, onChange: (e) => setEditingMemo({ ...editingMemo, content: e.target.value }), className: "flex-grow w-full p-4 border-0 focus:ring-0 text-base" }), _jsx("div", { className: "p-4 border-t flex justify-end", children: _jsx("button", { onClick: handleSaveAndCloseModal, className: "px-6 py-2 bg-primary-new text-white rounded-lg hover:bg-blue-700", children: "\u4FDD\u5B58\u3057\u3066\u9589\u3058\u308B" }) })] }) })), previewImageUrl && (_jsxs("div", { className: "fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4", onClick: () => setPreviewImageUrl(null), children: [_jsx("button", { type: "button", className: "absolute top-4 right-4 rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white", onClick: () => setPreviewImageUrl(null), children: "\u9589\u3058\u308B" }), _jsx("img", { src: previewImageUrl, alt: "My Memo preview", className: "max-h-full max-w-full rounded-lg bg-white object-contain", onClick: (e) => e.stopPropagation() })] })), editingProblem && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4", children: _jsxs("div", { className: "bg-white rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col", children: [_jsx("h3", { className: "text-xl font-bold p-4 border-b", children: "\u554F\u984C\u306E\u7DE8\u96C6" }), _jsxs("div", { className: "flex-grow overflow-y-auto p-6 space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u554F\u984C\u6587" }), _jsx("textarea", { name: "question_text", value: editingProblem.question_text, onChange: handleProblemFormChange, rows: 4, className: "mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u9078\u629E\u80A2" }), _jsx("div", { className: "space-y-2 mt-1", children: editingProblem.choices.map((choice, index) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "text", value: choice.label, onChange: (e) => handleProblemChoiceChange(index, 'label', e.target.value), className: "w-16 shadow-sm sm:text-sm border-gray-300 rounded-md" }), _jsx("input", { type: "text", value: choice.text, onChange: (e) => handleProblemChoiceChange(index, 'text', e.target.value), className: "flex-grow shadow-sm sm:text-sm border-gray-300 rounded-md" })] }, index))) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u6B63\u89E3\u306E\u9078\u629E\u80A2\u30E9\u30D9\u30EB" }), _jsx("input", { type: "text", name: "answer", value: editingProblem.answer, onChange: handleProblemFormChange, className: "mt-1 w-32 block shadow-sm sm:text-sm border-gray-300 rounded-md" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsx("input", { type: "text", name: "category", value: editingProblem.category || '', onChange: handleProblemFormChange, className: "mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u89E3\u8AAC" }), _jsx("textarea", { name: "explanation.text", value: editingProblem.explanation.text, onChange: handleProblemFormChange, rows: 6, className: "mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" })] })] }), _jsxs("div", { className: "p-4 border-t flex justify-end gap-4", children: [_jsx("button", { onClick: () => setEditingProblem(null), className: "px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300", children: "\u30AD\u30E3\u30F3\u30BB\u30EB" }), _jsx("button", { onClick: handleSaveChanges, className: "px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700", children: "\u5909\u66F4\u3092\u4FDD\u5B58" })] })] }) }))] }));
}
//# sourceMappingURL=QuizPage.js.map