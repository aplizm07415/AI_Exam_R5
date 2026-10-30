interface Subject {
    name: string;
}
interface AnalyticsData {
    overall_correct_rate: number;
    total_runs: number;
    answered_problems_count: number;
    daily_correct_rate_trend: Record<string, number>;
    frequently_missed_categories: Record<string, number>;
    total_problems_in_subject: number;
    unanswered_problems_count: number;
    today_total_runs: number;
    today_correct_answers: number;
    today_mode_breakdown: {
        mode: string;
        total_runs: number;
        correct_answers: number;
        accuracy: number;
    }[];
}
interface DailySummaryItem {
    date: string;
    total_questions: number;
    correct_count: number;
    accuracy: number;
    mode_breakdown?: {
        mode: string;
        total_questions: number;
        correct_count: number;
        accuracy: number;
    }[];
}
interface AnalysisDashboardProps {
    subjects: Subject[];
    selectedSubjectNames: string[];
    setSelectedSubjectNames: (names: string[]) => void;
    analytics: AnalyticsData | null;
    isLoading: boolean;
    error: string;
    dailySummary: DailySummaryItem[];
    isDailySummaryLoading: boolean;
    dailySummaryError: string;
    hasMoreDailySummary: boolean;
    totalDailySummaryDays: number;
    isLoadingMoreDailySummary: boolean;
    isLoadingAllDailySummary: boolean;
    onLoadMoreDailySummary: () => void;
    onLoadAllDailySummary: () => void;
    startDate: string;
    setStartDate: (date: string) => void;
    endDate: string;
    setEndDate: (date: string) => void;
    categories: string[];
    selectedCategory: string;
    setSelectedCategory: (category: string) => void;
    onApplyFilters: () => void;
}
export default function AnalysisDashboard({ subjects, selectedSubjectNames, setSelectedSubjectNames, analytics, isLoading, error, dailySummary, isDailySummaryLoading, dailySummaryError, hasMoreDailySummary, totalDailySummaryDays, isLoadingMoreDailySummary, isLoadingAllDailySummary, onLoadMoreDailySummary, onLoadAllDailySummary, startDate, setStartDate, endDate, setEndDate, categories, selectedCategory, setSelectedCategory, onApplyFilters, }: AnalysisDashboardProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AnalysisDashboard.d.ts.map