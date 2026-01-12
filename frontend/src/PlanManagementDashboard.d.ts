interface DailySummaryItem {
    date: string;
    total_questions: number;
    correct_count: number;
    accuracy: number;
}
interface Subject {
    name: string;
}
interface PlanManagementDashboardProps {
    subjects: Subject[];
    dailySummaryAll: DailySummaryItem[];
}
export default function PlanManagementDashboard({ subjects, dailySummaryAll }: PlanManagementDashboardProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=PlanManagementDashboard.d.ts.map