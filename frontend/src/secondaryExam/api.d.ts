import type { SecondaryDraft, SecondaryExamDashboardResponse, SecondaryExamDetailResponse, SecondaryGradeResult } from './types';
export declare function fetchSecondaryExamDashboard(): Promise<SecondaryExamDashboardResponse>;
export declare function fetchSecondaryExamDetail(yearLabel: string, caseNo: number): Promise<SecondaryExamDetailResponse>;
export declare function saveSecondaryExamDraft(yearLabel: string, caseNo: number, payload: {
    answers: Record<string, string>;
    active_question_key?: string | null;
}): Promise<SecondaryDraft>;
export declare function gradeSecondaryExam(yearLabel: string, caseNo: number, answers: Record<string, string>): Promise<SecondaryGradeResult>;
//# sourceMappingURL=api.d.ts.map