import type { SecondaryDraft, SecondaryExamDashboardResponse, SecondaryExamDetailResponse, SecondaryGradeResult, SecondaryOralVivaResponse, SecondaryOralVivaTurn } from './types';
export declare function fetchSecondaryExamDashboard(): Promise<SecondaryExamDashboardResponse>;
export declare function fetchSecondaryExamDetail(yearLabel: string, caseNo: number): Promise<SecondaryExamDetailResponse>;
export declare function saveSecondaryExamDraft(yearLabel: string, caseNo: number, payload: {
    answers: Record<string, string>;
    active_question_key?: string | null;
}): Promise<SecondaryDraft>;
export declare function gradeSecondaryExam(yearLabel: string, caseNo: number, answers: Record<string, string>): Promise<SecondaryGradeResult>;
export declare function askSecondaryExamOralViva(yearLabel: string, caseNo: number, payload: {
    user_message: string;
    attempt_id?: string | null;
    conversation?: SecondaryOralVivaTurn[];
}): Promise<SecondaryOralVivaResponse>;
//# sourceMappingURL=api.d.ts.map