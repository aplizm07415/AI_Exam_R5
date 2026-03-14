import type { Plan } from '../types/plan.d';
export interface PlanScheduleRow {
    date: string;
    planDaily: number;
    planCumulative: number;
    actualDaily: number;
    actualCumulative: number;
}
export interface PlanScheduleResult {
    rows: PlanScheduleRow[];
    debtToRedistribute: number;
    extraPerDay: number;
}
export declare const buildPlanSchedule: (plans: Plan[], actualsByDate: Map<string, number>, todayYmd: string) => PlanScheduleResult;
//# sourceMappingURL=planSchedule.d.ts.map