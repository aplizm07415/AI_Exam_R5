import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LoaderIcon, CheckCircleIcon, XCircleIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import LoadingSpinner from './components/LoadingSpinner';
import SubjectVisibilityModal from './components/SubjectVisibilityModal';
import SubjectProgress from './components/SubjectProgress';
import { usePlans } from './hooks/usePlans';
import { getMinutesUntilJstHour, getNowJstParts, getTodayYmdJst } from './utils/date';
import { buildPlanSchedule } from './utils/planSchedule';
const API_BASE_URL = "/api";
const QUESTION_TIMER_MS = 2 * 60 * 1000;
const FORCED_ANSWER_TIMER_MS = 80 * 1000;
const SUBJECT_SELECTION_PATTERNS_STORAGE_KEY = 'subjectSelectionPatterns';
const SPECIFIC_AREA_PROGRESS_STEPS = [
    '条件を確認中',
    '問題文・解説を照合中',
    '対象件数を集計中',
];
function MermaidDiagram({ chart }) {
    const idBaseRef = useRef(`question-mermaid-${Math.random().toString(36).slice(2)}`);
    const renderCountRef = useRef(0);
    const [svg, setSvg] = useState('');
    const [renderError, setRenderError] = useState('');
    useEffect(() => {
        const source = chart.trim();
        if (!source) {
            setSvg('');
            setRenderError('');
            return;
        }
        let isCancelled = false;
        const renderDiagram = async () => {
            try {
                const { default: mermaid } = await import('mermaid');
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'strict',
                    theme: 'default',
                });
                renderCountRef.current += 1;
                const renderId = `${idBaseRef.current}-${renderCountRef.current}`;
                const result = await mermaid.render(renderId, source);
                if (!isCancelled) {
                    setSvg(result.svg);
                    setRenderError('');
                }
            }
            catch (error) {
                if (!isCancelled) {
                    setSvg('');
                    setRenderError(error instanceof Error ? error.message : 'Mermaid図の描画に失敗しました。');
                }
            }
        };
        void renderDiagram();
        return () => {
            isCancelled = true;
        };
    }, [chart]);
    if (renderError) {
        return (_jsxs("div", { className: "question-mermaid question-mermaid--error", children: [_jsx("p", { className: "text-xs font-semibold text-red-700", children: "Mermaid\u56F3\u3092\u63CF\u753B\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" }), _jsx("pre", { children: chart })] }));
    }
    return (_jsx("div", { className: "question-mermaid", "aria-label": "\u554F\u984C\u6587\u306E\u56F3", children: svg ? (_jsx("div", { className: "question-mermaid__svg", dangerouslySetInnerHTML: { __html: svg } })) : (_jsx("div", { className: "text-sm text-gray-500", children: "\u56F3\u3092\u63CF\u753B\u4E2D..." })) }));
}
const getCustomImageUrls = (urls, legacyUrl) => {
    const normalized = (urls ?? []).filter((url) => typeof url === 'string' && url.trim().length > 0);
    if (normalized.length > 0) {
        return normalized;
    }
    return legacyUrl && legacyUrl.trim() ? [legacyUrl] : [];
};
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
function buildQuizTimelineItems(total, currentIndex) {
    if (total <= 0) {
        return [];
    }
    const currentStep = currentIndex + 1;
    const visibleSteps = new Set();
    if (total <= 7) {
        for (let step = 1; step <= total; step += 1) {
            visibleSteps.add(step);
        }
    }
    else {
        visibleSteps.add(1);
        visibleSteps.add(total);
        for (let step = currentStep - 1; step <= currentStep + 1; step += 1) {
            if (step >= 1 && step <= total) {
                visibleSteps.add(step);
            }
        }
        if (currentStep <= 3) {
            visibleSteps.add(2);
            visibleSteps.add(3);
            visibleSteps.add(4);
        }
        if (currentStep >= total - 2) {
            visibleSteps.add(total - 3);
            visibleSteps.add(total - 2);
            visibleSteps.add(total - 1);
        }
    }
    const orderedSteps = Array.from(visibleSteps)
        .filter((step) => step >= 1 && step <= total)
        .sort((a, b) => a - b);
    const items = [];
    orderedSteps.forEach((step, index) => {
        const previousStep = index > 0 ? orderedSteps[index - 1] : undefined;
        if (previousStep !== undefined && step - previousStep > 1) {
            items.push({
                key: `gap-${previousStep}-${step}`,
                label: '...',
                state: 'gap',
            });
        }
        items.push({
            key: `step-${step}`,
            label: String(step),
            state: step < currentStep ? 'prev' : step === currentStep ? 'current' : 'upcoming',
        });
    });
    return items;
}
export default function QuizPage({ subjects: allSubjects }) {
    const { plans, isLoading: isPlansLoading, error: plansError } = usePlans();
    const [dailySummaryAll, setDailySummaryAll] = useState([]);
    const [selectedSubjectNames, setSelectedSubjectNames] = useState([]);
    const [quizMode, setQuizMode] = useState('today_remaining');
    const [questionTagFilter, setQuestionTagFilter] = useState('all');
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
    const [reviewLaterKeys, setReviewLaterKeys] = useState([]);
    const [isUpdatingReviewLater, setIsUpdatingReviewLater] = useState(false);
    const [error, setError] = useState('');
    const [effectStatus, setEffectStatus] = useState(null);
    const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
    const [isScratchpadOpen, setIsScratchpadOpen] = useState(false);
    const [adhocQuizLabel, setAdhocQuizLabel] = useState('');
    const [isOralVivaActive, setIsOralVivaActive] = useState(false);
    const [oralVivaStepIndex, setOralVivaStepIndex] = useState(0);
    const [oralVivaMessages, setOralVivaMessages] = useState([]);
    const [oralVivaInput, setOralVivaInput] = useState('');
    const [oralVivaScores, setOralVivaScores] = useState({
        logicality: 0,
        specificity: 0,
        reproducibility: 0,
    });
    const [oralVivaResult, setOralVivaResult] = useState(null);
    const [isOralVivaLoading, setIsOralVivaLoading] = useState(false);
    const [isQuestionHelpActive, setIsQuestionHelpActive] = useState(false);
    const [questionHelpMessages, setQuestionHelpMessages] = useState([]);
    const [questionHelpInput, setQuestionHelpInput] = useState('');
    const [questionHelpSuggestedFollowups, setQuestionHelpSuggestedFollowups] = useState([]);
    const [isQuestionHelpLoading, setIsQuestionHelpLoading] = useState(false);
    const [isSpeechSupported, setIsSpeechSupported] = useState(false);
    const [isListeningSpeech, setIsListeningSpeech] = useState(false);
    const questionTopRef = useRef(null);
    const oralVivaMessagesEndRef = useRef(null);
    const questionHelpMessagesEndRef = useRef(null);
    const shuffledChoicesByQuestionRef = useRef({});
    const prefetchedImageUrlsRef = useRef(new Set());
    const speechRecognitionRef = useRef(null);
    const currentQuestion = questions[currentQuestionIndex];
    const currentQuestionImageDataUrls = currentQuestion
        ? getCustomImageUrls(currentQuestion.custom_question_image_data_urls, currentQuestion.custom_question_image_data_url)
        : [];
    const currentExplanationImageDataUrls = currentQuestion
        ? getCustomImageUrls(currentQuestion.custom_explanation_image_data_urls, currentQuestion.custom_explanation_image_data_url)
        : [];
    const openMemoModal = (type) => {
        const content = type === 'scratchpad' ? scratchpadText : customExplanationText;
        setEditingMemo({ type, content });
    };
    const buildReviewKey = useCallback((subject, problemId) => `${subject}::${problemId}`, []);
    const oralVivaSteps = ['root', 'refute', 'apply', 'summary'];
    const oralVivaStepLabels = {
        root: '根拠',
        refute: '反証',
        apply: '応用',
        summary: '要約',
    };
    const ensureShuffledChoicesForQuestion = useCallback((question) => {
        const existing = shuffledChoicesByQuestionRef.current[question.id];
        if (existing && existing.length === question.choices.length) {
            return existing;
        }
        const shuffled = [...question.choices];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = tmp;
        }
        shuffledChoicesByQuestionRef.current[question.id] = shuffled;
        return shuffled;
    }, []);
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
            const { image_urls, explanation_image_urls, custom_explanation, custom_explanation_image_data_url, custom_question_image_data_url, custom_explanation_image_data_urls, custom_question_image_data_urls, ...payload } = editingProblem;
            const response = await fetch(`/api/subjects/${encodeURIComponent(editingProblem.subject)}/problems/${encodeURIComponent(editingProblem.id)}`, {
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
    const fetchReviewLaterItems = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/review-later`);
            if (!response.ok) {
                throw new Error('後で確認一覧の取得に失敗しました。');
            }
            const data = await response.json();
            setReviewLaterKeys(data.map((item) => buildReviewKey(item.subject, item.problem_id)));
        }
        catch (fetchError) {
            console.error(fetchError);
        }
    }, [buildReviewKey]);
    const toggleReviewLater = async () => {
        if (!currentQuestion || isUpdatingReviewLater)
            return;
        const reviewKey = buildReviewKey(currentQuestion.subject, currentQuestion.id);
        const alreadyRegistered = reviewLaterKeys.includes(reviewKey);
        try {
            setIsUpdatingReviewLater(true);
            const requestInit = alreadyRegistered
                ? { method: 'DELETE' }
                : {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subject: currentQuestion.subject, problem_id: currentQuestion.id }),
                };
            const response = await fetch(alreadyRegistered
                ? `${API_BASE_URL}/review-later/${encodeURIComponent(currentQuestion.id)}?subject=${encodeURIComponent(currentQuestion.subject)}`
                : `${API_BASE_URL}/review-later`, requestInit);
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '後で確認の更新に失敗しました。');
            }
            setReviewLaterKeys((prev) => alreadyRegistered ? prev.filter((key) => key !== reviewKey) : [...prev, reviewKey]);
        }
        catch (toggleError) {
            console.error(toggleError);
            const message = toggleError instanceof Error ? toggleError.message : '後で確認の更新に失敗しました。';
            setError(message);
        }
        finally {
            setIsUpdatingReviewLater(false);
        }
    };
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
    const [specificAreaKeywords, setSpecificAreaKeywords] = useState(['']);
    const [specificAreaCount, setSpecificAreaCount] = useState(null);
    const [isSpecificAreaCountLoading, setIsSpecificAreaCountLoading] = useState(false);
    const [specificAreaCountError, setSpecificAreaCountError] = useState('');
    const [specificAreaProgressStep, setSpecificAreaProgressStep] = useState(0);
    const [lastSpecificAreaInvestigationSignature, setLastSpecificAreaInvestigationSignature] = useState(null);
    const [specificAreaHistoryScope, setSpecificAreaHistoryScope] = useState('all');
    const [specificAreaSuggestions, setSpecificAreaSuggestions] = useState([]);
    const [isSpecificAreaSuggestionsLoading, setIsSpecificAreaSuggestionsLoading] = useState(false);
    const [subjectSelectionPatterns, setSubjectSelectionPatterns] = useState(() => {
        try {
            const saved = localStorage.getItem(SUBJECT_SELECTION_PATTERNS_STORAGE_KEY);
            const parsed = saved ? JSON.parse(saved) : [];
            if (!Array.isArray(parsed))
                return [];
            return parsed
                .filter((item) => (item &&
                typeof item.id === 'string' &&
                typeof item.name === 'string' &&
                Array.isArray(item.subjectNames) &&
                item.subjectNames.every((subject) => typeof subject === 'string') &&
                typeof item.createdAt === 'string'))
                .map((item) => ({
                ...item,
                subjectNames: Array.from(new Set(item.subjectNames)),
            }));
        }
        catch (error) {
            console.error('Failed to parse subject selection patterns from localStorage', error);
            return [];
        }
    });
    const [subjectPatternName, setSubjectPatternName] = useState('');
    const [selectedSubjectPatternId, setSelectedSubjectPatternId] = useState('');
    const specificAreaProgressTimerRef = useRef(null);
    const normalizedSpecificAreaKeywords = useMemo(() => specificAreaKeywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0), [specificAreaKeywords]);
    const specificAreaInvestigationSignature = useMemo(() => JSON.stringify({
        subjects: [...selectedSubjectNames].sort(),
        keywords: [...normalizedSpecificAreaKeywords].sort(),
        historyScope: specificAreaHistoryScope,
        tagFilter: questionTagFilter,
    }), [selectedSubjectNames, normalizedSpecificAreaKeywords, specificAreaHistoryScope, questionTagFilter]);
    const isSpecificAreaInvestigationReady = selectedSubjectNames.length > 0 && normalizedSpecificAreaKeywords.length > 0;
    const isSpecificAreaInvestigationStale = isSpecificAreaInvestigationReady && lastSpecificAreaInvestigationSignature !== specificAreaInvestigationSignature;
    const hasSpecificAreaInvestigationResult = isSpecificAreaInvestigationReady &&
        !isSpecificAreaInvestigationStale &&
        specificAreaCount !== null &&
        !specificAreaCountError;
    const clearSpecificAreaProgressTimer = useCallback(() => {
        if (specificAreaProgressTimerRef.current !== null) {
            window.clearInterval(specificAreaProgressTimerRef.current);
            specificAreaProgressTimerRef.current = null;
        }
    }, []);
    useEffect(() => {
        localStorage.setItem('subjectWeights', JSON.stringify(subjectWeights));
    }, [subjectWeights]);
    useEffect(() => {
        localStorage.setItem(SUBJECT_SELECTION_PATTERNS_STORAGE_KEY, JSON.stringify(subjectSelectionPatterns));
    }, [subjectSelectionPatterns]);
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
        const todayYmd = getTodayYmdJst();
        const activePlans = plans.filter((p) => p.enabled);
        const targetSubjects = new Set();
        activePlans.forEach((plan) => {
            plan.subjectNames.forEach((name) => targetSubjects.add(name));
        });
        const actualsMap = new Map(dailySummaryAll.filter(item => item.date).map(item => [item.date, item.total_questions]));
        const schedule = buildPlanSchedule(activePlans, actualsMap, todayYmd);
        const todayRow = schedule.rows.find((row) => row.date === todayYmd);
        const cumulativePlannedTotal = todayRow?.planCumulative ?? 0;
        const cumulativeActualTotal = todayRow?.actualCumulative ?? 0;
        const remaining = todayRow ? Math.max(0, todayRow.planDaily - todayRow.actualDaily) : 0;
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
            setSelectedSubjectPatternId('');
        }
    }, [quizMode, todayRemaining]);
    useEffect(() => {
        if (quizState !== 'setup')
            return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('adhoc') !== '1')
            return;
        const raw = sessionStorage.getItem('adhocQuizSet');
        if (!raw)
            return;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('類題セットが空です。');
            }
            setQuestions(parsed);
            setCurrentQuestionIndex(0);
            setScore(0);
            setIsForcedSession(false);
            setQuizState('active');
            setSelectedSubjectNames(Array.from(new Set(parsed.map((q) => q.subject).filter(Boolean))));
            setAdhocQuizLabel(sessionStorage.getItem('adhocQuizLabel') || '類題演習');
            shuffledChoicesByQuestionRef.current = {};
            prefetchedImageUrlsRef.current = new Set();
            resetQuestionState();
            sessionStorage.removeItem('adhocQuizSet');
            sessionStorage.removeItem('adhocQuizLabel');
            params.delete('adhoc');
            const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
            window.history.replaceState({}, '', nextUrl);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '類題セットの読み込みに失敗しました。';
            setError(message);
            sessionStorage.removeItem('adhocQuizSet');
            sessionStorage.removeItem('adhocQuizLabel');
        }
    }, [quizState]);
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
    const visibleSubjectNameSet = useMemo(() => {
        return new Set(visibleSubjects.map((subject) => subject.name));
    }, [visibleSubjects]);
    const subjectSelectionPatternOptions = useMemo(() => {
        return subjectSelectionPatterns.map((pattern) => ({
            ...pattern,
            availableSubjectNames: pattern.subjectNames.filter((subjectName) => visibleSubjectNameSet.has(subjectName)),
        }));
    }, [subjectSelectionPatterns, visibleSubjectNameSet]);
    const handleHiddenSubjectsChange = (newHiddenSubjects) => {
        setHiddenSubjects(newHiddenSubjects);
        localStorage.setItem('hiddenSubjects', JSON.stringify(newHiddenSubjects));
        setSelectedSubjectNames((prev) => prev.filter((name) => !newHiddenSubjects.includes(name)));
        setSelectedSubjectPatternId('');
    };
    useEffect(() => {
        const fetchUnansweredCount = async () => {
            if (quizMode === 'unanswered' && selectedSubjectNames.length > 0) {
                setIsCountLoading(true);
                setUnansweredCount(null);
                try {
                    const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
                    const params = subjectParams
                        ? `${subjectParams}&tag_filter=${encodeURIComponent(questionTagFilter)}`
                        : `tag_filter=${encodeURIComponent(questionTagFilter)}`;
                    const response = await fetch(`${API_BASE_URL}/quiz/unanswered-count?${params}`);
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
    }, [quizMode, selectedSubjectNames, questionTagFilter]);
    useEffect(() => {
        const fetchWeakAreaCount = async () => {
            if (quizMode === 'weak_area' && selectedSubjectNames.length > 0) {
                setIsWeakCountLoading(true);
                setWeakAreaCount(null);
                try {
                    const subjectParams = selectedSubjectNames.map((s) => `subjects=${encodeURIComponent(s)}`).join('&');
                    const queryParams = subjectParams
                        ? `${subjectParams}&tag_filter=${encodeURIComponent(questionTagFilter)}`
                        : `tag_filter=${encodeURIComponent(questionTagFilter)}`;
                    const response = await fetch(`${API_BASE_URL}/quiz/missed-problems-count?${queryParams}`);
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
    }, [quizMode, selectedSubjectNames, questionTagFilter]);
    useEffect(() => {
        if (!isSpecificAreaInvestigationReady) {
            setSpecificAreaCount(null);
            setSpecificAreaCountError('');
            setSpecificAreaProgressStep(0);
            clearSpecificAreaProgressTimer();
            return;
        }
        if (isSpecificAreaInvestigationStale) {
            setSpecificAreaCount(null);
            setSpecificAreaCountError('');
            setSpecificAreaProgressStep(0);
        }
    }, [
        clearSpecificAreaProgressTimer,
        isSpecificAreaInvestigationReady,
        isSpecificAreaInvestigationStale,
    ]);
    useEffect(() => () => {
        clearSpecificAreaProgressTimer();
    }, [clearSpecificAreaProgressTimer]);
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
        setSelectedSubjectPatternId('');
        setSelectedSubjectNames((prev) => prev.includes(subjectName)
            ? prev.filter((s) => s !== subjectName)
            : [...prev, subjectName]);
    };
    const saveSubjectSelectionPattern = () => {
        if (quizMode === 'today_remaining') {
            alert('今日の残りモードでは、科目は学習計画から自動選択されます。');
            return;
        }
        const patternName = subjectPatternName.trim();
        if (!patternName) {
            alert('パターン名を入力してください。');
            return;
        }
        const subjectNames = selectedSubjectNames.filter((subjectName) => visibleSubjectNameSet.has(subjectName));
        if (subjectNames.length === 0) {
            alert('登録する科目を1つ以上選択してください。');
            return;
        }
        const existingPattern = subjectSelectionPatterns.find((pattern) => pattern.name === patternName);
        const patternId = existingPattern?.id ?? `subject-pattern-${Date.now()}`;
        const nextPattern = {
            id: patternId,
            name: patternName,
            subjectNames,
            createdAt: existingPattern?.createdAt ?? new Date().toISOString(),
        };
        setSubjectSelectionPatterns((prev) => {
            const withoutSameName = prev.filter((pattern) => pattern.name !== patternName);
            return [...withoutSameName, nextPattern].sort((a, b) => a.name.localeCompare(b.name));
        });
        setSelectedSubjectPatternId(patternId);
        setSubjectPatternName('');
    };
    const applySubjectSelectionPattern = (patternId) => {
        if (!patternId) {
            setSelectedSubjectPatternId('');
            return;
        }
        if (quizMode === 'today_remaining') {
            alert('今日の残りモードでは、科目は学習計画から自動選択されます。');
            setSelectedSubjectPatternId('');
            return;
        }
        const pattern = subjectSelectionPatterns.find((item) => item.id === patternId);
        if (!pattern) {
            setSelectedSubjectPatternId('');
            return;
        }
        const subjectNames = pattern.subjectNames.filter((subjectName) => visibleSubjectNameSet.has(subjectName));
        if (subjectNames.length === 0) {
            alert('このパターンで選択できる表示中の科目がありません。');
            setSelectedSubjectPatternId('');
            return;
        }
        setSelectedSubjectNames(subjectNames);
        setSelectedSubjectPatternId(pattern.id);
    };
    const deleteSelectedSubjectSelectionPattern = () => {
        if (!selectedSubjectPatternId)
            return;
        const pattern = subjectSelectionPatterns.find((item) => item.id === selectedSubjectPatternId);
        if (!pattern)
            return;
        if (!window.confirm(`科目パターン「${pattern.name}」を削除しますか？`))
            return;
        setSubjectSelectionPatterns((prev) => prev.filter((item) => item.id !== selectedSubjectPatternId));
        setSelectedSubjectPatternId('');
    };
    const updateSpecificAreaKeyword = (index, value) => {
        setSpecificAreaKeywords((prev) => prev.map((keyword, idx) => (idx === index ? value : keyword)));
    };
    const addSpecificAreaKeywordField = () => {
        setSpecificAreaKeywords((prev) => [...prev, '']);
    };
    const removeSpecificAreaKeywordField = (index) => {
        setSpecificAreaKeywords((prev) => {
            if (prev.length === 1) {
                return [''];
            }
            return prev.filter((_, idx) => idx !== index);
        });
    };
    const applySpecificAreaSuggestion = (suggestion) => {
        setSpecificAreaKeywords((prev) => {
            const normalizedSuggestion = suggestion.trim();
            if (!normalizedSuggestion)
                return prev;
            const alreadyExists = prev.some((keyword) => keyword.trim() === normalizedSuggestion);
            if (alreadyExists) {
                return prev;
            }
            const firstEmptyIndex = prev.findIndex((keyword) => keyword.trim().length === 0);
            if (firstEmptyIndex >= 0) {
                return prev.map((keyword, index) => (index === firstEmptyIndex ? normalizedSuggestion : keyword));
            }
            return [...prev, normalizedSuggestion];
        });
    };
    const fetchSpecificAreaSuggestions = async () => {
        if (normalizedSpecificAreaKeywords.length === 0) {
            setError('関連語を提案するには、先にキーワードを1つ以上入力してください。');
            return;
        }
        try {
            setIsSpecificAreaSuggestionsLoading(true);
            setError('');
            const response = await fetch(`${API_BASE_URL}/quiz/specific-area-suggestions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keywords: normalizedSpecificAreaKeywords }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '関連語の提案に失敗しました。');
            }
            const data = await response.json();
            setSpecificAreaSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        }
        catch (suggestionError) {
            console.error(suggestionError);
            const message = suggestionError instanceof Error ? suggestionError.message : '関連語の提案に失敗しました。';
            setError(message);
            setSpecificAreaSuggestions([]);
        }
        finally {
            setIsSpecificAreaSuggestionsLoading(false);
        }
    };
    const fetchSpecificAreaCount = async () => {
        if (selectedSubjectNames.length === 0) {
            setError('科目を1つ以上選択してください。');
            return;
        }
        if (normalizedSpecificAreaKeywords.length === 0) {
            setError('特定領域モードではキーワードを1つ以上入力してください。');
            return;
        }
        try {
            clearSpecificAreaProgressTimer();
            setIsSpecificAreaCountLoading(true);
            setSpecificAreaCount(null);
            setSpecificAreaCountError('');
            setSpecificAreaProgressStep(0);
            setError('');
            specificAreaProgressTimerRef.current = window.setInterval(() => {
                setSpecificAreaProgressStep((prev) => Math.min(prev + 1, SPECIFIC_AREA_PROGRESS_STEPS.length - 1));
            }, 700);
            const params = new URLSearchParams();
            selectedSubjectNames.forEach((name) => params.append('subjects', name));
            normalizedSpecificAreaKeywords.forEach((keyword) => params.append('keywords', keyword));
            params.append('history_scope', specificAreaHistoryScope);
            params.append('tag_filter', questionTagFilter);
            const response = await fetch(`${API_BASE_URL}/quiz/specific-area-count?${params.toString()}`);
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '対象問題の調査に失敗しました。');
            }
            const data = await response.json();
            clearSpecificAreaProgressTimer();
            setSpecificAreaProgressStep(SPECIFIC_AREA_PROGRESS_STEPS.length - 1);
            setSpecificAreaCount(data.specific_area_count);
            setLastSpecificAreaInvestigationSignature(specificAreaInvestigationSignature);
        }
        catch (countError) {
            console.error(countError);
            clearSpecificAreaProgressTimer();
            const message = countError instanceof Error ? countError.message : '対象問題の調査に失敗しました。';
            setSpecificAreaCountError(message);
            setSpecificAreaCount(null);
            setLastSpecificAreaInvestigationSignature(null);
            setError(message);
        }
        finally {
            setIsSpecificAreaCountLoading(false);
        }
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
        else if (quizMode === 'specific_area') {
            if (normalizedSpecificAreaKeywords.length === 0) {
                setError('特定領域モードではキーワードを1つ以上入力してください。');
                return;
            }
            if (isSpecificAreaCountLoading) {
                setError('対象問題を調査中です。完了してから開始してください。');
                return;
            }
            if (!hasSpecificAreaInvestigationResult) {
                setError('対象問題を調査してから開始してください。条件を変えた場合は再調査が必要です。');
                return;
            }
            if (specificAreaCount === null || specificAreaCount === 0) {
                setError('該当する問題はありません。');
                return;
            }
            questionsToFetch = Math.min(numQuestions, specificAreaCount);
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
                    keywords: quizMode === 'specific_area' ? normalizedSpecificAreaKeywords : undefined,
                    specific_area_history_scope: quizMode === 'specific_area' ? specificAreaHistoryScope : undefined,
                    tag_filter: questionTagFilter,
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
            shuffledChoicesByQuestionRef.current = {};
            prefetchedImageUrlsRef.current = new Set();
            setAdhocQuizLabel('');
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
    const openIpadMode = (profile) => {
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
        else if (quizMode === 'specific_area') {
            setError('特定領域モードはiPadモード未対応です。Web画面から開始してください。');
            return;
        }
        const subjectQuery = selectedSubjectNames
            .map((s) => `subject=${encodeURIComponent(s)}`)
            .join('&');
        const deepLink = `quizapp://quiz?base=${encodeURIComponent(window.location.origin)}` +
            `&${subjectQuery}` +
            `&mode=${encodeURIComponent(quizMode)}` +
            `&count=${encodeURIComponent(String(Math.max(1, questionsToFetch)))}` +
            `&profile=${encodeURIComponent(profile)}`;
        window.location.href = deepLink;
    };
    const resetQuestionState = () => {
        setSelectedAnswer(null);
        setIsAnswered(false);
        setFeedback(null);
        setScratchpadText('');
        setCustomExplanationText('');
        setIsScratchpadOpen(false);
        setIsOralVivaActive(false);
        setOralVivaStepIndex(0);
        setOralVivaMessages([]);
        setOralVivaInput('');
        setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
        setOralVivaResult(null);
        setIsOralVivaLoading(false);
        setIsQuestionHelpActive(false);
        setQuestionHelpMessages([]);
        setQuestionHelpInput('');
        setQuestionHelpSuggestedFollowups([]);
        setIsQuestionHelpLoading(false);
        setIsListeningSpeech(false);
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
    const handleAnswerSubmit = async (forcedSubmission = false, forceIncorrect = false) => {
        if (isSubmittingAnswer)
            return;
        if (selectedAnswer === null && !forcedSubmission)
            return;
        const currentQuestion = questions[currentQuestionIndex];
        if (!currentQuestion)
            return;
        const submittedAnswer = selectedAnswer ?? '';
        const isCorrect = forceIncorrect ? false : submittedAnswer === currentQuestion.answer;
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
                    mode: quizMode,
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
            resetQuestionState();
            setQuizState('setup');
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
    const handleSaveCustomExplanation = async (overrideText) => {
        if (!currentQuestion)
            return;
        const textToSave = overrideText ?? customExplanationText;
        try {
            setIsSavingCustomExplanation(true);
            const response = await fetch(`${API_BASE_URL}/problems/${currentQuestion.id}/custom-explanation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: textToSave,
                    explanation_image_data_urls: currentExplanationImageDataUrls,
                    question_image_data_urls: currentQuestionImageDataUrls,
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
                    custom_explanation: textToSave,
                    custom_explanation_image_data_urls: currentExplanationImageDataUrls,
                    custom_question_image_data_urls: currentQuestionImageDataUrls,
                    custom_explanation_image_data_url: currentExplanationImageDataUrls[0],
                    custom_question_image_data_url: currentQuestionImageDataUrls[0],
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
    const callOralVivaStep = useCallback(async (step, userMessage) => {
        if (!currentQuestion) {
            throw new Error('問題情報が見つかりません。');
        }
        const response = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                step,
                question: {
                    problem_id: currentQuestion.id,
                    question_text: currentQuestion.question_text,
                    explanation_text: feedback?.explanation?.text ?? currentQuestion.explanation?.text ?? '',
                    correct_answer: currentQuestion.answer,
                    selected_answer: selectedAnswer,
                    was_correct: feedback?.correct ?? false,
                },
                conversation: oralVivaMessages,
                user_message: userMessage,
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.detail || '口頭試問の生成に失敗しました。');
        }
        return response.json();
    }, [currentQuestion, feedback, selectedAnswer, oralVivaMessages]);
    const startOralViva = useCallback(async () => {
        if (!currentQuestion || !isAnswered || isOralVivaLoading)
            return;
        setIsOralVivaLoading(true);
        setError('');
        setIsOralVivaActive(true);
        setOralVivaStepIndex(0);
        setOralVivaMessages([]);
        setOralVivaResult(null);
        setOralVivaScores({ logicality: 0, specificity: 0, reproducibility: 0 });
        try {
            const step = oralVivaSteps[0];
            const result = await callOralVivaStep(step, '');
            setOralVivaMessages([{ role: 'assistant', content: result.assistant_message }]);
            setOralVivaScores(result.scores);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '口頭試問の開始に失敗しました。';
            setError(message);
            setIsOralVivaActive(false);
        }
        finally {
            setIsOralVivaLoading(false);
        }
    }, [currentQuestion, isAnswered, isOralVivaLoading, callOralVivaStep, oralVivaSteps]);
    const submitOralVivaAnswer = useCallback(async () => {
        if (!isOralVivaActive || isOralVivaLoading)
            return;
        const message = oralVivaInput.trim();
        if (!message)
            return;
        const step = oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)];
        setIsOralVivaLoading(true);
        setError('');
        const userTurn = { role: 'user', content: message };
        setOralVivaMessages((prev) => [...prev, userTurn]);
        setOralVivaInput('');
        try {
            const result = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    step,
                    question: {
                        problem_id: currentQuestion?.id,
                        question_text: currentQuestion?.question_text,
                        explanation_text: feedback?.explanation?.text ?? currentQuestion?.explanation?.text ?? '',
                        correct_answer: currentQuestion?.answer,
                        selected_answer: selectedAnswer,
                        was_correct: feedback?.correct ?? false,
                    },
                    conversation: [...oralVivaMessages, userTurn],
                    user_message: message,
                }),
            });
            if (!result.ok) {
                const payload = await result.json().catch(() => null);
                throw new Error(payload?.detail || '口頭試問の送信に失敗しました。');
            }
            const payload = await result.json();
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
                    await handleSaveCustomExplanation(appended);
                }
            }
            else {
                setOralVivaStepIndex((prev) => Math.min(prev + 1, oralVivaSteps.length - 1));
            }
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : '口頭試問の送信に失敗しました。';
            setError(errMsg);
        }
        finally {
            setIsOralVivaLoading(false);
        }
    }, [
        isOralVivaActive,
        isOralVivaLoading,
        oralVivaInput,
        oralVivaSteps,
        oralVivaStepIndex,
        currentQuestion,
        feedback,
        selectedAnswer,
        oralVivaMessages,
        customExplanationText,
        handleSaveCustomExplanation,
    ]);
    const toggleSpeechInput = useCallback(() => {
        const recognition = speechRecognitionRef.current;
        if (!recognition)
            return;
        if (isListeningSpeech) {
            recognition.stop();
            setIsListeningSpeech(false);
        }
        else {
            recognition.start();
            setIsListeningSpeech(true);
        }
    }, [isListeningSpeech]);
    const skipOralVivaToSummary = useCallback(async () => {
        if (!isOralVivaActive || isOralVivaLoading)
            return;
        setOralVivaStepIndex(oralVivaSteps.length - 1);
        setIsOralVivaLoading(true);
        try {
            const userTurn = { role: 'user', content: 'ここまでの内容を要約して終了してください。' };
            const result = await fetch(`${API_BASE_URL}/quiz/oral-viva/step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    step: 'summary',
                    question: {
                        problem_id: currentQuestion?.id,
                        question_text: currentQuestion?.question_text,
                        explanation_text: feedback?.explanation?.text ?? currentQuestion?.explanation?.text ?? '',
                        correct_answer: currentQuestion?.answer,
                        selected_answer: selectedAnswer,
                        was_correct: feedback?.correct ?? false,
                    },
                    conversation: [...oralVivaMessages, userTurn],
                    user_message: userTurn.content,
                }),
            });
            if (!result.ok) {
                const payload = await result.json().catch(() => null);
                throw new Error(payload?.detail || '要約生成に失敗しました。');
            }
            const payload = await result.json();
            setOralVivaMessages((prev) => [...prev, userTurn, { role: 'assistant', content: payload.assistant_message }]);
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
                await handleSaveCustomExplanation(appended);
            }
        }
        catch (e) {
            const message = e instanceof Error ? e.message : '要約生成に失敗しました。';
            setError(message);
        }
        finally {
            setIsOralVivaLoading(false);
        }
    }, [
        isOralVivaActive,
        isOralVivaLoading,
        oralVivaSteps.length,
        currentQuestion,
        feedback,
        selectedAnswer,
        oralVivaMessages,
        customExplanationText,
        handleSaveCustomExplanation,
    ]);
    const submitQuestionHelp = useCallback(async (prefilledQuestion) => {
        if (!currentQuestion || !isAnswered || isQuestionHelpLoading)
            return;
        const message = (prefilledQuestion ?? questionHelpInput).trim();
        if (!message)
            return;
        const userTurn = { role: 'user', content: message };
        const nextConversation = [...questionHelpMessages, userTurn];
        setIsQuestionHelpActive(true);
        setQuestionHelpMessages(nextConversation);
        setQuestionHelpInput('');
        setIsQuestionHelpLoading(true);
        setError('');
        try {
            const response = await fetch(`${API_BASE_URL}/quiz/question-help`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: {
                        problem_id: currentQuestion.id,
                        question_text: currentQuestion.question_text,
                        explanation_text: feedback?.explanation?.text ?? currentQuestion.explanation?.text ?? '',
                        correct_answer: currentQuestion.answer,
                        selected_answer: selectedAnswer,
                        was_correct: feedback?.correct ?? false,
                    },
                    conversation: questionHelpMessages,
                    user_message: message,
                }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.detail || '質問相談の送信に失敗しました。');
            }
            const payload = await response.json();
            setQuestionHelpMessages((prev) => [...prev, { role: 'assistant', content: payload.assistant_message }]);
            setQuestionHelpSuggestedFollowups(payload.suggested_followups ?? []);
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : '質問相談の送信に失敗しました。';
            setError(errMsg);
            setQuestionHelpMessages((prev) => prev.slice(0, -1));
            setQuestionHelpInput(message);
        }
        finally {
            setIsQuestionHelpLoading(false);
        }
    }, [
        currentQuestion,
        isAnswered,
        isQuestionHelpLoading,
        questionHelpInput,
        questionHelpMessages,
        feedback,
        selectedAnswer,
    ]);
    const currentReviewKey = currentQuestion ? buildReviewKey(currentQuestion.subject, currentQuestion.id) : null;
    const isCurrentQuestionReviewLater = currentReviewKey ? reviewLaterKeys.includes(currentReviewKey) : false;
    const displayedChoices = useMemo(() => (currentQuestion ? ensureShuffledChoicesForQuestion(currentQuestion) : []), [currentQuestion, ensureShuffledChoicesForQuestion]);
    useEffect(() => {
        fetchReviewLaterItems();
    }, [fetchReviewLaterItems]);
    useEffect(() => {
        if (currentQuestion) {
            setCustomExplanationText(currentQuestion.custom_explanation || '');
        }
    }, [currentQuestion]);
    useEffect(() => {
        const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
            setIsSpeechSupported(false);
            speechRecognitionRef.current = null;
            return;
        }
        setIsSpeechSupported(true);
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = 'ja-JP';
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.onresult = (event) => {
            const transcript = event?.results?.[0]?.[0]?.transcript ?? '';
            if (typeof transcript === 'string' && transcript.trim()) {
                setOralVivaInput((prev) => (prev ? `${prev}\n${transcript.trim()}` : transcript.trim()));
            }
        };
        recognition.onerror = () => {
            setIsListeningSpeech(false);
        };
        recognition.onend = () => {
            setIsListeningSpeech(false);
        };
        speechRecognitionRef.current = recognition;
        return () => {
            recognition.stop();
            speechRecognitionRef.current = null;
        };
    }, []);
    useEffect(() => {
        oralVivaMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [oralVivaMessages]);
    useEffect(() => {
        questionHelpMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [questionHelpMessages]);
    useEffect(() => {
        if (isOralVivaActive)
            return;
        if (speechRecognitionRef.current) {
            speechRecognitionRef.current.stop();
        }
        setIsListeningSpeech(false);
    }, [isOralVivaActive]);
    useEffect(() => {
        const handleKeyPress = (event) => {
            if (quizState !== 'active' ||
                event.target instanceof HTMLTextAreaElement ||
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLSelectElement ||
                (event.target instanceof HTMLElement && event.target.isContentEditable)) {
                return;
            }
            if (event.key >= '1' && event.key <= '9') {
                if (!isAnswered) {
                    const choiceIndex = parseInt(event.key) - 1;
                    if (displayedChoices[choiceIndex]) {
                        setSelectedAnswer(displayedChoices[choiceIndex].label);
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
    }, [quizState, isAnswered, currentQuestion, displayedChoices, handleAnswerSubmit, handleNextQuestion, isSubmittingAnswer, isSavingCustomExplanation]);
    useEffect(() => {
        if (quizState !== 'active')
            return;
        const target = questionTopRef.current;
        if (!target)
            return;
        window.requestAnimationFrame(() => {
            const top = target.getBoundingClientRect().top + window.scrollY - 12;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        });
    }, [quizState, currentQuestionIndex, isAnswered]);
    useEffect(() => {
        if (quizState !== 'active' || questions.length === 0)
            return;
        const prefetchCount = 3;
        const start = currentQuestionIndex + 1;
        const end = Math.min(questions.length, start + prefetchCount);
        for (let i = start; i < end; i += 1) {
            const q = questions[i];
            if (!q)
                continue;
            const urls = [...(q.image_urls ?? []), ...(q.explanation_image_urls ?? [])];
            for (const url of urls) {
                if (!url || prefetchedImageUrlsRef.current.has(url))
                    continue;
                prefetchedImageUrlsRef.current.add(url);
                const img = new Image();
                img.src = url;
            }
        }
    }, [quizState, questions, currentQuestionIndex]);
    // --- Render logic for active quiz ---
    const renderActiveQuiz = () => {
        if (!currentQuestion)
            return null;
        const hasQuestionImages = (currentQuestion.image_urls && currentQuestion.image_urls.length > 0)
            || currentQuestionImageDataUrls.length > 0;
        // レイアウトの決定ロジック
        let layoutType = 'default';
        if (hasQuestionImages) {
            layoutType = 'image';
        }
        else if (isAnswered) {
            layoutType = 'answered';
        }
        const questionTextMd = currentQuestion.question_text_md?.trim();
        const questionTextMermaid = currentQuestion.question_text_mermaid?.trim();
        const imagesComponent = hasQuestionImages ? (_jsxs("div", { className: "space-y-4", children: [(currentQuestion.image_urls || []).map((url, index) => (_jsx("img", { src: url, alt: `Question image ${index + 1}`, className: "max-w-full w-full h-auto mx-auto rounded-lg shadow-md" }, index))), currentQuestionImageDataUrls.map((url, index) => (_jsx("button", { type: "button", onClick: () => setPreviewImageUrl(url), className: "block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50", children: _jsx("img", { src: url, alt: `My Memo question supplement ${index + 1}`, className: "max-h-64 w-full object-contain" }) }, `custom-question-${index}`)))] })) : null;
        const explanationComponent = isAnswered ? (_jsxs("div", { className: "bg-white rounded-xl shadow p-6 md:p-8 fade-in", children: [_jsxs("div", { className: "flex items-center gap-3 mb-4", children: [feedback?.correct ? _jsx(CheckCircleIcon, { className: "w-8 h-8 text-green-600" }) : _jsx(XCircleIcon, { className: "w-8 h-8 text-red-600" }), _jsx("h3", { className: "text-xl md:text-2xl font-bold", children: feedback?.correct ? '正解！' : '不正解' })] }), _jsx("h4", { className: "text-base md:text-lg font-semibold text-primary-new mb-2", children: "\u89E3\u8AAC" }), (currentQuestion.explanation_image_urls && currentQuestion.explanation_image_urls.length > 0) && (_jsx("div", { className: "my-4 grid grid-cols-1 gap-4", children: currentQuestion.explanation_image_urls.map((url, index) => (_jsx("img", { src: url, alt: `Explanation image ${index + 1}`, className: "max-w-full h-auto mx-auto rounded-lg shadow-md" }, index))) })), _jsx("div", { className: "prose prose-sm md:prose-base max-w-none text-gray-700", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkBreaks], children: feedback?.explanation?.text || '' }) }), currentExplanationImageDataUrls.length > 0 && (_jsxs("div", { className: "mt-6", children: [_jsx("h4", { className: "text-base md:text-lg font-semibold text-primary-new mb-2", children: "My Memo \u89E3\u8AAC\u88DC\u8DB3\u753B\u50CF" }), _jsx("div", { className: "space-y-3", children: currentExplanationImageDataUrls.map((url, index) => (_jsx("button", { type: "button", onClick: () => setPreviewImageUrl(url), className: "block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50", children: _jsx("img", { src: url, alt: `My Memo handwrite ${index + 1}`, className: "max-h-48 w-full object-contain" }) }, `custom-explanation-${index}`))) })] })), _jsxs("div", { className: "mt-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-2", children: [_jsx("h4", { className: "text-base md:text-lg font-semibold text-primary-new", children: "My Memo" }), _jsx("button", { onClick: () => openMemoModal('customExplanation'), className: "p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700", title: "\u62E1\u5927\u8868\u793A", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "1em", height: "1em", viewBox: "0 0 24 24", children: _jsx("path", { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "2", d: "M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4" }) }) })] }), _jsx("textarea", { value: customExplanationText, onChange: (e) => setCustomExplanationText(e.target.value), className: "w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new", rows: 4 })] }), _jsxs("div", { className: "mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("h4", { className: "text-base md:text-lg font-semibold text-sky-900", children: "\u53E3\u982D\u8A66\u554F\u30E2\u30FC\u30C9" }), !isOralVivaActive ? (_jsx("button", { type: "button", onClick: () => void startOralViva(), disabled: isOralVivaLoading, className: "px-4 py-2 rounded-md bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 disabled:bg-gray-300", children: isOralVivaLoading ? '開始中...' : '口頭試問を開始' })) : (_jsxs("div", { className: "text-right", children: [_jsxs("div", { className: "text-xs font-semibold text-sky-800", children: ["\u30B9\u30C6\u30C3\u30D7: ", oralVivaStepLabels[oralVivaSteps[Math.min(oralVivaStepIndex, oralVivaSteps.length - 1)]], " (", Math.min(oralVivaStepIndex + 1, oralVivaSteps.length), "/", oralVivaSteps.length, ")"] }), _jsx("div", { className: "text-[11px] text-sky-700", children: "\u7D42\u4E86\u6761\u4EF6: 4\u30B9\u30C6\u30C3\u30D7\u5B8C\u4E86 or \u8981\u7D04\u3078\u30B9\u30AD\u30C3\u30D7" })] }))] }), isOralVivaActive && (_jsxs("div", { className: "mt-4 space-y-3", children: [_jsx("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-2", children: [
                                        ['論理性', oralVivaScores.logicality],
                                        ['具体性', oralVivaScores.specificity],
                                        ['再現性', oralVivaScores.reproducibility],
                                    ].map(([label, value]) => (_jsxs("div", { className: "rounded-md bg-white border border-sky-200 px-3 py-2", children: [_jsxs("div", { className: "flex items-center justify-between text-xs text-sky-900 mb-1", children: [_jsx("span", { children: label }), _jsx("span", { children: value })] }), _jsx("div", { className: "h-2 rounded bg-sky-100 overflow-hidden", children: _jsx("div", { className: "h-full bg-sky-500", style: { width: `${Math.max(0, Math.min(100, value))}%` } }) })] }, label))) }), _jsxs("div", { className: "max-h-72 overflow-y-auto rounded-md border border-sky-200 bg-white p-3 space-y-2", children: [oralVivaMessages.length === 0 && (_jsx("p", { className: "text-sm text-gray-500", children: "\u958B\u59CB\u3059\u308B\u3068\u3001AI\u9762\u63A5\u5B98\u304C\u8CEA\u554F\u3057\u307E\u3059\u3002" })), oralVivaMessages.map((msg, idx) => (_jsxs("div", { className: `rounded-lg px-3 py-2 text-sm ${msg.role === 'assistant' ? 'bg-sky-100 text-sky-900' : 'bg-gray-100 text-gray-800'}`, children: [_jsx("p", { className: "text-[11px] font-semibold mb-1", children: msg.role === 'assistant' ? 'AI面接官' : 'あなた' }), _jsx("p", { className: "whitespace-pre-wrap", children: msg.content })] }, `${msg.role}-${idx}`))), _jsx("div", { ref: oralVivaMessagesEndRef })] }), !oralVivaResult && (_jsxs("div", { className: "space-y-2", children: [_jsx("textarea", { value: oralVivaInput, onChange: (e) => setOralVivaInput(e.target.value), className: "w-full p-2 border border-sky-300 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 bg-white", rows: 3, placeholder: "\u56DE\u7B54\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u4EFB\u610F\u3067\u97F3\u58F0\u5165\u529B\u3082\u53EF\uFF09" }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => void submitOralVivaAnswer(), disabled: isOralVivaLoading || !oralVivaInput.trim(), className: "px-4 py-2 rounded-md bg-sky-700 text-white text-sm font-medium hover:bg-sky-800 disabled:bg-gray-300", children: isOralVivaLoading ? '送信中...' : '送信' }), isSpeechSupported && (_jsx("button", { type: "button", onClick: toggleSpeechInput, className: `px-4 py-2 rounded-md text-sm font-medium border ${isListeningSpeech ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-sky-300 bg-white text-sky-800'}`, children: isListeningSpeech ? '音声入力停止' : '音声入力開始' })), _jsx("button", { type: "button", onClick: () => void skipOralVivaToSummary(), disabled: isOralVivaLoading, className: "px-4 py-2 rounded-md text-sm font-medium border border-sky-300 bg-white text-sky-800 hover:bg-sky-100 disabled:bg-gray-100 disabled:text-gray-400", children: "\u8981\u7D04\u3078\u30B9\u30AD\u30C3\u30D7" }), _jsx("button", { type: "button", onClick: () => setIsOralVivaActive(false), disabled: isOralVivaLoading, className: "px-4 py-2 rounded-md text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400", children: "\u53E3\u982D\u8A66\u554F\u3092\u9589\u3058\u308B" })] })] })), oralVivaResult && (_jsxs("div", { className: "rounded-md border border-sky-200 bg-white p-3 space-y-2", children: [_jsx("h5", { className: "text-sm font-semibold text-sky-900", children: "\u6700\u7D42\u30D5\u30A3\u30FC\u30C9\u30D0\u30C3\u30AF" }), _jsx("ul", { className: "list-disc pl-5 text-sm text-gray-700 space-y-1", children: oralVivaResult.improvementPoints.map((point, idx) => (_jsx("li", { children: point }, `${point}-${idx}`))) }), oralVivaResult.miniQuizQuestion && (_jsxs("div", { className: "text-sm text-gray-800", children: [_jsx("p", { className: "font-semibold", children: "\u6B21\u56DE\u78BA\u8A8D\u30DF\u30CB\u554F\u984C" }), _jsx("p", { className: "whitespace-pre-wrap", children: oralVivaResult.miniQuizQuestion })] })), oralVivaResult.miniQuizAnswer && (_jsxs("div", { className: "text-sm text-gray-700", children: [_jsx("p", { className: "font-semibold", children: "\u60F3\u5B9A\u89E3\u7B54" }), _jsx("p", { className: "whitespace-pre-wrap", children: oralVivaResult.miniQuizAnswer })] })), _jsx("p", { className: "text-xs text-gray-500", children: "\u6700\u7D42\u8981\u7D04\u306F My Memo \u306B\u81EA\u52D5\u8FFD\u8A18\u30FB\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002" })] }))] }))] }), _jsxs("div", { className: "mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { children: [_jsx("h4", { className: "text-base md:text-lg font-semibold text-emerald-900", children: "\u8CEA\u554F\u76F8\u8AC7\u30E2\u30FC\u30C9" }), _jsx("p", { className: "mt-1 text-xs text-emerald-800", children: "\u3053\u306E\u554F\u984C\u3067\u5F15\u3063\u304B\u304B\u3063\u305F\u70B9\u3092\u81EA\u7531\u306B\u805E\u3051\u307E\u3059\u3002\u7406\u89E3\u3067\u304D\u305F\u3068\u3053\u308D\u3067\u305D\u306E\u307E\u307E\u9589\u3058\u3066OK\u3067\u3059\u3002" })] }), !isQuestionHelpActive ? (_jsx("button", { type: "button", onClick: () => setIsQuestionHelpActive(true), className: "px-4 py-2 rounded-md bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800", children: "\u8CEA\u554F\u76F8\u8AC7\u3092\u958B\u304F" })) : (_jsx("button", { type: "button", onClick: () => setIsQuestionHelpActive(false), disabled: isQuestionHelpLoading, className: "px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400", children: "\u8CEA\u554F\u76F8\u8AC7\u3092\u9589\u3058\u308B" }))] }), isQuestionHelpActive && (_jsxs("div", { className: "mt-4 space-y-3", children: [_jsxs("div", { className: "max-h-72 overflow-y-auto rounded-md border border-emerald-200 bg-white p-3 space-y-2", children: [questionHelpMessages.length === 0 && (_jsx("p", { className: "text-sm text-gray-500", children: "\u4F8B: \u300C\u306A\u305C\u3053\u308C\u304C\u6B63\u89E3\uFF1F\u300D\u300C\u4ED6\u306E\u9078\u629E\u80A2\u306F\u3069\u3053\u304C\u9055\u3046\uFF1F\u300D" })), questionHelpMessages.map((msg, idx) => (_jsxs("div", { className: `rounded-lg px-3 py-2 text-sm ${msg.role === 'assistant' ? 'bg-emerald-100 text-emerald-950' : 'bg-gray-100 text-gray-800'}`, children: [_jsx("p", { className: "text-[11px] font-semibold mb-1", children: msg.role === 'assistant' ? 'AI講師' : 'あなた' }), _jsx("p", { className: "whitespace-pre-wrap", children: msg.content })] }, `${msg.role}-${idx}`))), _jsx("div", { ref: questionHelpMessagesEndRef })] }), questionHelpSuggestedFollowups.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-2", children: questionHelpSuggestedFollowups.map((item) => (_jsx("button", { type: "button", onClick: () => void submitQuestionHelp(item), disabled: isQuestionHelpLoading, className: "px-3 py-1.5 rounded-full border border-emerald-200 bg-white text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60", children: item }, item))) })), _jsxs("div", { className: "space-y-2", children: [_jsx("textarea", { value: questionHelpInput, onChange: (e) => setQuestionHelpInput(e.target.value), className: "w-full p-2 border border-emerald-300 rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 bg-white", rows: 3, placeholder: "\u3053\u306E\u554F\u984C\u3067\u6C17\u306B\u306A\u308B\u70B9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => void submitQuestionHelp(), disabled: isQuestionHelpLoading || !questionHelpInput.trim(), className: "px-4 py-2 rounded-md bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:bg-gray-300", children: isQuestionHelpLoading ? '回答中...' : '質問する' }), _jsx("button", { type: "button", onClick: () => setIsQuestionHelpActive(false), disabled: isQuestionHelpLoading, className: "px-4 py-2 rounded-md text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400", children: "\u9589\u3058\u308B" })] })] })] }))] }), _jsxs("div", { className: "mt-6 pt-4 border-t border-gray-200 flex justify-between items-center", children: [_jsx("button", { onClick: openProblemEditor, className: "px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200", children: "\u3053\u306E\u554F\u984C\u3092\u7DE8\u96C6\u3059\u308B" }), _jsx("button", { id: "next-question-button-bottom", type: "button", onClick: handleNextQuestion, disabled: isSavingCustomExplanation, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-dark bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed", children: currentQuestionIndex < questions.length - 1 ? '次の問題へ' : '終了' })] })] })) : null;
        const questionColumn = (_jsxs("div", { className: "bg-white rounded-xl shadow p-6 md:p-8 min-h-full flex flex-col", children: [_jsxs("div", { className: "mb-6 space-y-4", children: [_jsx("p", { className: "text-base md:text-lg font-semibold text-gray-700 whitespace-pre-wrap", children: currentQuestion.question_text }), questionTextMd && (_jsx("div", { className: "question-markdown text-sm md:text-base text-gray-700", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkBreaks], children: questionTextMd }) })), questionTextMermaid && (_jsx(MermaidDiagram, { chart: questionTextMermaid })), _jsx("div", { className: "md:hidden", children: layoutType === 'image' && imagesComponent })] }), _jsx(TimerProgressBar, { durationMs: isForcedSession ? FORCED_ANSWER_TIMER_MS : QUESTION_TIMER_MS, isActive: quizState === 'active' && !isAnswered && !isSubmittingAnswer, resetToken: `${currentQuestion.id}-${questionStartedAt}-${isForcedSession ? 'forced' : 'normal'}`, onExpire: isForcedSession ? () => void handleAnswerSubmit(true) : undefined }), _jsx("div", { className: "space-y-3", children: displayedChoices.map((option, index) => {
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
                        return (_jsxs("button", { type: "button", onClick: () => !isAnswered && setSelectedAnswer(option.label), disabled: isAnswered, className: `w-full text-left p-4 rounded-lg border border-transparent transition-all duration-200 text-sm md:text-base ${buttonClass}`, children: [_jsxs("span", { className: "font-bold mr-2", children: [option.label, "."] }), _jsx("span", { className: "whitespace-pre-wrap", children: option.text })] }, index));
                    }) }), _jsxs("div", { className: "mt-6", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 mb-2", children: [_jsx("button", { type: "button", onClick: () => setIsScratchpadOpen((prev) => !prev), className: "px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-gray-50 hover:bg-gray-100", children: isScratchpadOpen ? 'メモ帳を閉じる' : 'メモ帳を開く' }), isScratchpadOpen && (_jsx("button", { onClick: () => openMemoModal('scratchpad'), className: "p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700", title: "\u62E1\u5927\u8868\u793A", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "1em", height: "1em", viewBox: "0 0 24 24", children: _jsx("path", { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "2", d: "M3 8V4h4m10 0h4v4M3 16v4h4m14-4h-4v4" }) }) }))] }), isScratchpadOpen && (_jsx("textarea", { id: "scratchpad", value: scratchpadText, onChange: (e) => setScratchpadText(e.target.value), className: "w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-new focus:border-primary-new", rows: 3 })), _jsx("div", { className: "mt-3 flex justify-end", children: _jsx("button", { type: "button", onClick: () => void toggleReviewLater(), disabled: isUpdatingReviewLater, className: `px-4 py-2 rounded-md text-sm font-medium border shadow-sm transition-colors ${isCurrentQuestionReviewLater
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                    : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'} disabled:bg-gray-200 disabled:text-gray-500 disabled:border-gray-300 disabled:cursor-not-allowed`, children: isUpdatingReviewLater ? '更新中...' : isCurrentQuestionReviewLater ? '登録済み' : '後で確認' }) }), !isAnswered && ( // Moved "解答する" button here
                        _jsx("div", { className: "mt-6 text-center", children: _jsxs("div", { className: "flex flex-col justify-center gap-3 sm:flex-row", children: [_jsx("button", { id: "submit-answer-button", type: "button", onClick: () => void handleAnswerSubmit(), disabled: selectedAnswer === null || isSubmittingAnswer, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed", children: isSubmittingAnswer ? '保存中...' : '解答する' }), _jsx("button", { type: "button", onClick: () => void handleAnswerSubmit(true, true), disabled: isSubmittingAnswer, className: "px-8 py-3 border border-amber-300 rounded-md shadow-sm text-sm md:text-base font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed", children: isSubmittingAnswer ? '保存中...' : 'わからない' })] }) }))] }), isAnswered && ( // This div now only contains "次の問題へ" button, and retains mt-auto
                _jsx("div", { className: "mt-auto pt-6 text-center", children: _jsx("button", { id: "next-question-button", type: "button", onClick: handleNextQuestion, disabled: isSavingCustomExplanation, className: "px-8 py-3 border border-transparent rounded-md shadow-sm text-sm md:text-base font-medium text-dark bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed", children: currentQuestionIndex < questions.length - 1 ? '次の問題へ' : '終了' }) }))] }));
        // 右カラム（画像・解説）
        const rightColumn = (_jsxs("div", { className: "space-y-8 pb-4", children: [layoutType === 'image' && (_jsx("div", { className: "bg-white rounded-xl shadow p-6 md:p-8", children: imagesComponent })), explanationComponent] }));
        const timelineItems = buildQuizTimelineItems(questions.length, currentQuestionIndex);
        return (_jsxs("div", { className: "md:flex md:h-screen md:flex-col md:overflow-hidden text-sm md:text-base", children: [_jsx("div", { ref: questionTopRef, className: "px-4 pb-2 pt-3 md:shrink-0 md:px-6 md:pb-2 md:pt-3", children: _jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("div", { className: "flex flex-wrap justify-end items-center gap-x-3 gap-y-1", children: [isForcedSession && (_jsx("div", { className: "text-xs font-semibold text-[#e8383d] whitespace-nowrap", children: "\u5F37\u5236\u30E2\u30FC\u30C9: 80\u79D2" })), (() => {
                                        const stats = historyStats[currentQuestion.id];
                                        if (stats && stats.total > 0) {
                                            return (_jsxs("div", { className: "text-xs text-gray-500 whitespace-nowrap", children: ["\u76F4\u8FD1", stats.total, "\u56DE \u6B63\u7B54\u7387: ", Math.round((stats.correct / stats.total) * 100), "% (", stats.correct, "/", stats.total, ")"] }));
                                        }
                                        if (Object.keys(historyStats).length > 0) {
                                            return _jsx("div", { className: "text-xs text-gray-500 whitespace-nowrap", children: "\u521D\u6311\u6226" });
                                        }
                                        return null;
                                    })(), adhocQuizLabel && (_jsx("span", { className: "text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 whitespace-nowrap", children: adhocQuizLabel })), _jsxs("p", { className: "text-xs font-semibold text-slate-600", children: ["\u554F\u984C ", currentQuestionIndex + 1, " / ", questions.length] })] }), _jsx("div", { className: "rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm md:px-4", children: _jsx("ol", { className: "quiz-progress-timeline", "aria-label": `問題進捗 ${currentQuestionIndex + 1} / ${questions.length}`, children: timelineItems.map((item) => (_jsx("li", { className: item.state === 'gap' ? 'gap' : item.state, "aria-current": item.state === 'current' ? 'step' : undefined, children: item.label }, item.key))) }) })] }) }), _jsxs("div", { className: `
                pb-6 md:grid md:min-h-0 md:flex-1 md:gap-6 md:pb-0
                ${layoutType === 'image' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'answered' ? 'md:grid-cols-3' : ''}
                ${layoutType === 'default' ? 'md:grid-cols-1' : ''}
            `, children: [_jsx("div", { className: `
                px-4 md:h-full md:min-h-0 md:overflow-y-auto md:px-0 md:pb-4 md:pl-6 md:pr-1
                ${layoutType === 'image' ? 'md:col-span-1' : ''}
                ${layoutType === 'answered' ? 'md:col-span-1' : ''}
              `, children: questionColumn }), layoutType !== 'default' && (_jsx("div", { className: `
                  hidden md:block md:pr-6
                  ${layoutType === 'image' ? 'md:col-span-2' : ''}
                  ${layoutType === 'answered' ? 'md:col-span-2' : ''}
                  md:h-full md:min-h-0 md:overflow-y-auto
                `, children: rightColumn })), _jsx("div", { className: "md:hidden mt-8 px-4", children: explanationComponent })] })] }));
    };
    return (_jsxs(_Fragment, { children: [_jsx(SubjectVisibilityModal, { isOpen: isVisibilityModalOpen, onClose: () => setIsVisibilityModalOpen(false), subjects: allSubjects, hiddenSubjects: hiddenSubjects, onHiddenSubjectsChange: handleHiddenSubjectsChange, quizMode: quizMode, subjectWeights: subjectWeights, onSubjectWeightsChange: setSubjectWeights }), effectStatus && (_jsx("div", { className: "feedback-overlay", children: _jsx("div", { className: `feedback-icon ${effectStatus} feedback-effect-animation`, children: effectStatus === 'correct' ? '○' : '×' }) })), _jsxs("div", { className: quizState === 'active' ? "w-full" : "max-w-3xl mx-auto", children: [quizState === 'setup' && ((isLoading || isPlansLoading) ? (_jsx(LoadingSpinner, {})) : (_jsxs("div", { className: "max-w-2xl mx-auto", children: [_jsxs("div", { className: "bg-white rounded-xl shadow p-8", children: [_jsxs("form", { onSubmit: (e) => e.preventDefault(), className: "space-y-6", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u79D1\u76EE (\u8907\u6570\u9078\u629E\u53EF)" }), _jsx("button", { onClick: () => setIsVisibilityModalOpen(true), className: "p-1 rounded-md hover:bg-gray-200", title: "\u8868\u793A\u79D1\u76EE\u306E\u5236\u5FA1", children: _jsxs("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-5 w-5 text-gray-600", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: [_jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })] }) })] }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3", children: visibleSubjects.map((s) => {
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
                                                        }) }), _jsxs("div", { className: "mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3", children: [_jsxs("div", { className: "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end", children: [_jsxs("div", { children: [_jsx("label", { className: "heading-2 block text-xs font-medium text-gray-600", children: "\u767B\u9332\u30D1\u30BF\u30FC\u30F3" }), _jsxs("select", { value: selectedSubjectPatternId, onChange: (event) => applySubjectSelectionPattern(event.target.value), disabled: quizMode === 'today_remaining' || subjectSelectionPatterns.length === 0, className: "mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20 disabled:bg-gray-100 disabled:text-gray-400", children: [_jsx("option", { value: "", children: "\u30D1\u30BF\u30FC\u30F3\u3092\u9078\u629E" }), subjectSelectionPatternOptions.map((pattern) => (_jsxs("option", { value: pattern.id, children: [pattern.name, " (", pattern.availableSubjectNames.length, ")"] }, pattern.id)))] })] }), _jsx("button", { type: "button", onClick: deleteSelectedSubjectSelectionPattern, disabled: !selectedSubjectPatternId, className: "rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400", children: "\u524A\u9664" })] }), _jsxs("div", { className: "mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]", children: [_jsx("input", { type: "text", value: subjectPatternName, onChange: (event) => setSubjectPatternName(event.target.value), disabled: quizMode === 'today_remaining', placeholder: "\u4F8B: \u671D\u306E\u91CD\u70B9\u30BB\u30C3\u30C8", className: "block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20 disabled:bg-gray-100 disabled:text-gray-400" }), _jsx("button", { type: "button", onClick: saveSubjectSelectionPattern, disabled: quizMode === 'today_remaining' || selectedSubjectNames.length === 0, className: "rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-gray-300", children: "\u73FE\u5728\u306E\u9078\u629E\u3092\u767B\u9332" })] }), quizMode === 'today_remaining' && (_jsx("p", { className: "mt-2 text-xs text-gray-500", children: "\u4ECA\u65E5\u306E\u6B8B\u308A\u30E2\u30FC\u30C9\u3067\u306F\u5B66\u7FD2\u8A08\u753B\u306E\u79D1\u76EE\u304C\u4F7F\u308F\u308C\u307E\u3059\u3002" }))] })] }), _jsxs("div", { children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u30E2\u30FC\u30C9" }), _jsxs("div", { className: "mt-2 grid grid-cols-2 sm:grid-cols-5 gap-3", children: [_jsx("button", { type: "button", onClick: () => setQuizMode('today_remaining'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'today_remaining' ? 'bg-[#e8383d] text-white' : 'bg-red-100 text-gray-700 hover:bg-red-200'}`, children: "\u4ECA\u65E5\u306E\u6B8B\u308A" }), _jsx("button", { type: "button", onClick: () => setQuizMode('random'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'random' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u30E9\u30F3\u30C0\u30E0" }), _jsx("button", { type: "button", onClick: () => setQuizMode('weak_area'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'weak_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u82E6\u624B\u514B\u670D" }), _jsx("button", { type: "button", onClick: () => setQuizMode('unanswered'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u672A\u89E3\u7B54\u554F\u984C" }), _jsx("button", { type: "button", onClick: () => setQuizMode('specific_area'), className: `px-4 py-2 rounded-md text-sm font-medium ${quizMode === 'specific_area' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u7279\u5B9A\u9818\u57DF" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u8A08\u7B97\u554F\u984C" }), _jsxs("select", { value: questionTagFilter, onChange: (event) => setQuestionTagFilter(event.target.value), className: "mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20", children: [_jsx("option", { value: "all", children: "\u3059\u3079\u3066\u51FA\u984C" }), _jsx("option", { value: "calculation_only", children: "\u8A08\u7B97\u554F\u984C\u306E\u307F" }), _jsx("option", { value: "exclude_calculation", children: "\u8A08\u7B97\u554F\u984C\u3092\u9664\u5916" })] })] }), quizMode === 'specific_area' && (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u691C\u7D22\u30AD\u30FC\u30EF\u30FC\u30C9" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => void fetchSpecificAreaCount(), disabled: isSpecificAreaCountLoading || !isSpecificAreaInvestigationReady, className: "px-3 py-1.5 rounded-md text-sm font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed", children: isSpecificAreaCountLoading ? '対象問題を調査中...' : hasSpecificAreaInvestigationResult ? '対象問題を再調査' : '対象問題を調査' }), _jsx("button", { type: "button", onClick: () => void fetchSpecificAreaSuggestions(), disabled: isSpecificAreaSuggestionsLoading || normalizedSpecificAreaKeywords.length === 0, className: "px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed", children: isSpecificAreaSuggestionsLoading ? '関連語を提案中...' : '関連語を提案' }), _jsx("button", { type: "button", onClick: addSpecificAreaKeywordField, className: "px-3 py-1.5 rounded-md text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200", children: "\u5165\u529B\u6B04\u3092\u8FFD\u52A0" })] })] }), _jsx("p", { className: "mt-2 text-xs text-gray-500", children: "1\u3064\u306E\u5165\u529B\u6B04\u30921\u30EF\u30FC\u30C9\u3068\u3057\u3066\u6271\u3044\u307E\u3059\u3002\u3044\u305A\u308C\u304B1\u3064\u3067\u3082\u4E00\u81F4\u3059\u308C\u3070\u5BFE\u8C61\u306B\u306A\u308A\u307E\u3059\u3002" }), _jsx("div", { className: "mt-3 space-y-3", children: specificAreaKeywords.map((keyword, index) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "text", value: keyword, onChange: (event) => updateSpecificAreaKeyword(index, event.target.value), placeholder: index === 0 ? '例: NPV' : `キーワード ${index + 1}`, className: "flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-new focus:outline-none focus:ring-2 focus:ring-primary-new/20" }), _jsx("button", { type: "button", onClick: () => removeSpecificAreaKeywordField(index), disabled: specificAreaKeywords.length === 1, className: "px-3 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed", children: "\u524A\u9664" })] }, `specific-area-keyword-${index}`))) }), _jsxs("div", { className: "mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-3 text-sm", children: [_jsx("span", { className: "font-medium text-slate-700", children: "\u8ABF\u67FB\u30B9\u30C6\u30FC\u30BF\u30B9" }), !isSpecificAreaInvestigationReady && (_jsx("span", { className: "text-slate-500", children: "\u79D1\u76EE\u3068\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u5165\u529B\u3059\u308B\u3068\u8ABF\u67FB\u3067\u304D\u307E\u3059" })), isSpecificAreaInvestigationReady && isSpecificAreaCountLoading && (_jsx("span", { className: "text-blue-700", children: SPECIFIC_AREA_PROGRESS_STEPS[specificAreaProgressStep] })), isSpecificAreaInvestigationReady && !isSpecificAreaCountLoading && hasSpecificAreaInvestigationResult && (_jsx("span", { className: "text-emerald-700", children: "\u8ABF\u67FB\u5B8C\u4E86" })), isSpecificAreaInvestigationReady && !isSpecificAreaCountLoading && !hasSpecificAreaInvestigationResult && !specificAreaCountError && (_jsx("span", { className: "text-amber-700", children: "\u672A\u8ABF\u67FB" })), specificAreaCountError && !isSpecificAreaCountLoading && (_jsx("span", { className: "text-red-700", children: "\u8ABF\u67FB\u5931\u6557" }))] }), _jsx("div", { className: "mt-3 h-2 overflow-hidden rounded-full bg-slate-200", children: _jsx("div", { className: `h-full rounded-full transition-all duration-300 ${specificAreaCountError ? 'bg-red-400' : hasSpecificAreaInvestigationResult ? 'bg-emerald-500' : 'bg-blue-500'}`, style: {
                                                                        width: !isSpecificAreaInvestigationReady
                                                                            ? '0%'
                                                                            : `${((specificAreaCountError ? 1 : specificAreaProgressStep + (hasSpecificAreaInvestigationResult ? 1 : 0)) / SPECIFIC_AREA_PROGRESS_STEPS.length) * 100}%`,
                                                                    } }) }), _jsx("div", { className: "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3", children: SPECIFIC_AREA_PROGRESS_STEPS.map((stepLabel, index) => {
                                                                    const isCompleted = hasSpecificAreaInvestigationResult && index <= specificAreaProgressStep;
                                                                    const isCurrent = isSpecificAreaCountLoading && index === specificAreaProgressStep;
                                                                    return (_jsxs("div", { className: `rounded-md border px-3 py-2 text-xs ${isCompleted
                                                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                                            : isCurrent
                                                                                ? 'border-blue-200 bg-blue-50 text-blue-700'
                                                                                : 'border-slate-200 bg-white text-slate-500'}`, children: [index + 1, ". ", stepLabel] }, stepLabel));
                                                                }) }), isSpecificAreaInvestigationReady && !isSpecificAreaCountLoading && !hasSpecificAreaInvestigationResult && !specificAreaCountError && (_jsx("p", { className: "mt-3 text-xs text-amber-700", children: "\u30AD\u30FC\u30EF\u30FC\u30C9\u30FB\u79D1\u76EE\u30FB\u5BFE\u8C61\u6761\u4EF6\u3092\u5909\u66F4\u3057\u305F\u5834\u5408\u306F\u3001\u3082\u3046\u4E00\u5EA6\u300C\u5BFE\u8C61\u554F\u984C\u3092\u8ABF\u67FB\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002" })), specificAreaCountError && !isSpecificAreaCountLoading && (_jsx("p", { className: "mt-3 text-xs text-red-700", children: specificAreaCountError }))] }), _jsxs("div", { className: "mt-4", children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u5BFE\u8C61\u6761\u4EF6" }), _jsxs("div", { className: "mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3", children: [_jsx("button", { type: "button", onClick: () => setSpecificAreaHistoryScope('all'), className: `px-4 py-2 rounded-md text-sm font-medium ${specificAreaHistoryScope === 'all' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u5168\u554F\u984C" }), _jsx("button", { type: "button", onClick: () => setSpecificAreaHistoryScope('unanswered'), className: `px-4 py-2 rounded-md text-sm font-medium ${specificAreaHistoryScope === 'unanswered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u672A\u56DE\u7B54\u306E\u307F" }), _jsx("button", { type: "button", onClick: () => setSpecificAreaHistoryScope('answered'), className: `px-4 py-2 rounded-md text-sm font-medium ${specificAreaHistoryScope === 'answered' ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: "\u65E2\u56DE\u7B54\u306E\u307F" })] })] }), _jsxs("div", { className: "mt-4", children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u95A2\u9023\u8A9E\u5019\u88DC" }), _jsxs("div", { className: "mt-2 flex flex-wrap gap-2", children: [specificAreaSuggestions.map((suggestion) => (_jsx("button", { type: "button", onClick: () => applySpecificAreaSuggestion(suggestion), className: "px-3 py-1.5 rounded-full text-sm font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100", children: suggestion }, suggestion))), !isSpecificAreaSuggestionsLoading && specificAreaSuggestions.length === 0 && (_jsx("p", { className: "text-xs text-gray-500", children: "\u5FC5\u8981\u306A\u3089\u95A2\u9023\u8A9E\u3092\u63D0\u6848\u3067\u5019\u88DC\u3092\u51FA\u3057\u3001\u4F7F\u3044\u305F\u3044\u3082\u306E\u3060\u3051\u8FFD\u52A0\u3067\u304D\u307E\u3059\u3002" }))] })] })] })), _jsxs("div", { children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u554F\u984C\u6570" }), _jsxs("div", { className: "mt-2 text-sm text-gray-500 mb-2", children: [quizMode === 'today_remaining' && `(今日の残り: ${todayRemaining.count} 問 (予定:${todayRemaining.plan} / 実績:${todayRemaining.actual}) / 2分/問で約${estimatedCompletionText})`, quizMode === 'today_remaining' && todayRemainingPaceHint && (_jsx("div", { className: "mt-1 text-xs font-medium text-[#e8383d]", children: todayRemainingPaceHint })), quizMode === 'unanswered' && unansweredCount !== null && `(未解答: ${unansweredCount} 問)`, quizMode === 'weak_area' && weakAreaCount !== null && `(苦手問題: ${weakAreaCount} 問)`, quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length === 0 && '(キーワードを1つ以上入力してください)', quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length > 0 && !isSpecificAreaCountLoading && hasSpecificAreaInvestigationResult && specificAreaCount !== null && `(対象問題数: ${specificAreaCount} 問)`, quizMode === 'specific_area' && isSpecificAreaCountLoading && '(対象選定中...)', quizMode === 'specific_area' && normalizedSpecificAreaKeywords.length > 0 && !isSpecificAreaCountLoading && !hasSpecificAreaInvestigationResult && !specificAreaCountError && '(対象問題を調査してください)'] }), _jsx("div", { className: "mt-2 grid grid-cols-5 gap-3", children: [
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
                                                                else if (quizMode === 'specific_area' && specificAreaCount !== null) {
                                                                    actualButtonValue = specificAreaCount;
                                                                    displayButtonLabel = `MAX (${specificAreaCount})`;
                                                                }
                                                            }
                                                            const isDisabled = (quizMode === 'today_remaining' && actualButtonValue > todayRemaining.count) ||
                                                                (quizMode === 'unanswered' && unansweredCount !== null && actualButtonValue > unansweredCount) ||
                                                                (quizMode === 'weak_area' && weakAreaCount !== null && actualButtonValue > weakAreaCount) ||
                                                                (quizMode === 'specific_area' && specificAreaCount !== null && actualButtonValue > specificAreaCount) ||
                                                                actualButtonValue <= 0; // Disable if value is 0 or less
                                                            return (_jsx("button", { type: "button", onClick: () => setNumQuestions(actualButtonValue), disabled: isDisabled, className: `px-2 py-2 rounded-md text-sm font-medium transition-colors ${numQuestions === actualButtonValue && !isDisabled
                                                                    ? 'bg-primary-new text-white'
                                                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'}`, children: displayButtonLabel }, option.label));
                                                        }) })] })] }), _jsxs("div", { className: "mt-6", children: [_jsxs("button", { type: "button", onClick: () => void startQuiz(), disabled: isLoading || selectedSubjectNames.length === 0, className: "w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700 disabled:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-primary-new", children: [isLoading ? _jsx(LoaderIcon, { className: "w-5 h-5" }) : null, isLoading ? 'クイズ準備中...' : 'Start'] }), _jsxs("div", { className: "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2", children: [_jsx("button", { type: "button", onClick: () => openIpadMode('air'), disabled: isLoading || selectedSubjectNames.length === 0 || quizMode === 'specific_area', className: "w-full py-3 px-4 border border-cyan-600 rounded-md shadow-sm text-base font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-50 disabled:cursor-not-allowed", children: "iPad Air\u30E2\u30FC\u30C9" }), _jsx("button", { type: "button", onClick: () => openIpadMode('mini'), disabled: isLoading || selectedSubjectNames.length === 0 || quizMode === 'specific_area', className: "w-full py-3 px-4 border border-sky-600 rounded-md shadow-sm text-base font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed", children: "iPad mini\u30E2\u30FC\u30C9" })] }), _jsx("button", { type: "button", onClick: () => void startQuiz(true), disabled: isLoading || selectedSubjectNames.length === 0, className: "mt-3 w-full py-3 px-4 border border-[#e8383d] rounded-md shadow-sm text-base font-medium text-[#e8383d] bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed", children: "\u5F37\u5236\u30E2\u30FC\u30C9" })] }), (error || plansError) && _jsx("p", { className: "text-danger text-sm mt-2 text-center", children: error || plansError })] }), _jsx(SubjectProgress, { selectedSubjectNames: selectedSubjectNames, quizMode: quizMode })] }))), quizState === 'finished' && (_jsxs("div", { className: "text-center max-w-lg mx-auto", children: [_jsx("h2", { className: "text-3xl font-bold text-dark mb-4", children: "\u5B8C\u4E86\uFF01" }), _jsx("div", { className: "bg-white rounded-xl shadow p-8", children: _jsx("div", { className: "flex justify-center mt-2", children: _jsx("button", { type: "button", onClick: () => {
                                            setIsForcedSession(false);
                                            setQuizState('setup');
                                        }, className: "px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-primary-new hover:bg-blue-700", children: "\u79D1\u76EE\u9078\u629E\u306B\u9077\u79FB" }) }) })] })), quizState === 'active' && renderActiveQuiz()] }), editingMemo && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-75 z-50 flex justify-center items-center p-4", children: _jsxs("div", { className: "bg-white rounded-lg shadow-xl w-full max-w-2xl h-3/4 flex flex-col", children: [_jsx("h3", { className: "text-lg font-bold p-4 border-b", children: editingMemo.type === 'scratchpad' ? 'メモ帳' : 'My Memo' }), _jsx("textarea", { value: editingMemo.content, onChange: (e) => setEditingMemo({ ...editingMemo, content: e.target.value }), className: "flex-grow w-full p-4 border-0 focus:ring-0 text-base" }), _jsx("div", { className: "p-4 border-t flex justify-end", children: _jsx("button", { onClick: handleSaveAndCloseModal, className: "px-6 py-2 bg-primary-new text-white rounded-lg hover:bg-blue-700", children: "\u4FDD\u5B58\u3057\u3066\u9589\u3058\u308B" }) })] }) })), previewImageUrl && (_jsxs("div", { className: "fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4", onClick: () => setPreviewImageUrl(null), children: [_jsx("button", { type: "button", className: "absolute top-4 right-4 rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white", onClick: () => setPreviewImageUrl(null), children: "\u9589\u3058\u308B" }), _jsx("img", { src: previewImageUrl, alt: "My Memo preview", className: "max-h-full max-w-full rounded-lg bg-white object-contain", onClick: (e) => e.stopPropagation() })] })), editingProblem && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4", children: _jsxs("div", { className: "bg-white rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col", children: [_jsx("h3", { className: "text-xl font-bold p-4 border-b", children: "\u554F\u984C\u306E\u7DE8\u96C6" }), _jsxs("div", { className: "flex-grow overflow-y-auto p-6 space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u554F\u984C\u6587" }), _jsx("textarea", { name: "question_text", value: editingProblem.question_text, onChange: handleProblemFormChange, rows: 4, className: "mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u9078\u629E\u80A2" }), _jsx("div", { className: "space-y-2 mt-1", children: editingProblem.choices.map((choice, index) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "text", value: choice.label, onChange: (e) => handleProblemChoiceChange(index, 'label', e.target.value), className: "w-16 shadow-sm sm:text-sm border-gray-300 rounded-md" }), _jsx("input", { type: "text", value: choice.text, onChange: (e) => handleProblemChoiceChange(index, 'text', e.target.value), className: "flex-grow shadow-sm sm:text-sm border-gray-300 rounded-md" })] }, index))) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u6B63\u89E3\u306E\u9078\u629E\u80A2\u30E9\u30D9\u30EB" }), _jsx("input", { type: "text", name: "answer", value: editingProblem.answer, onChange: handleProblemFormChange, className: "mt-1 w-32 block shadow-sm sm:text-sm border-gray-300 rounded-md" })] }), _jsxs("div", { children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsx("input", { type: "text", name: "category", value: editingProblem.category || '', onChange: handleProblemFormChange, className: "mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" })] }), _jsxs("div", { children: [_jsx("label", { className: "heading-2 block text-sm font-medium text-gray-700", children: "\u89E3\u8AAC" }), _jsx("textarea", { name: "explanation.text", value: editingProblem.explanation.text, onChange: handleProblemFormChange, rows: 6, className: "mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" })] })] }), _jsxs("div", { className: "p-4 border-t flex justify-end gap-4", children: [_jsx("button", { onClick: () => setEditingProblem(null), className: "px-6 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300", children: "\u30AD\u30E3\u30F3\u30BB\u30EB" }), _jsx("button", { onClick: handleSaveChanges, className: "px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700", children: "\u5909\u66F4\u3092\u4FDD\u5B58" })] })] }) }))] }));
}
//# sourceMappingURL=QuizPage.js.map