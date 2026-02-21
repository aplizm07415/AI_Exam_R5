interface Subject {
    name: string;
}
interface AnalyticsData {
    overall_correct_rate: number;
    total_runs: number;
    daily_correct_rate_trend: Record<string, number>;
    frequently_missed_categories: Record<string, number>;
    total_problems_in_subject: number;
    unanswered_problems_count: number;
}
interface DailySummaryItem {
    date: string;
    total_questions: number;
    correct_count: number;
    accuracy: number;
}
interface AnalysisDashboardProps {
    subjects: Subject[];
    selectedSubjectName: string;
    setSelectedSubjectName: (name: string) => void;
    analytics: AnalyticsData | null;
    isLoading: boolean;
    error: string;
    dailySummary: DailySummaryItem[];
    isDailySummaryLoading: boolean;
    dailySummaryError: string;
    startDate: string;
    setStartDate: (date: string) => void;
    endDate: string;
    setEndDate: (date: string) => void;
    categories: string[];
    selectedCategory: string;
    setSelectedCategory: (category: string) => void;
    onApplyFilters: () => void;
}
export default function AnalysisDashboard({ subjects, selectedSubjectName, setSelectedSubjectName, analytics, isLoading, error, dailySummary, isDailySummaryLoading, dailySummaryError, startDate, setStartDate, endDate, setEndDate, categories, selectedCategory, setSelectedCategory, onApplyFilters, }: AnalysisDashboardProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AnalysisDashboard.d.ts.map