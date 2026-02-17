import type { Plan } from '../types/plan.d';
export declare function usePlans(): {
    plans: Plan[];
    addPlan: (newPlanData: Omit<Plan, "id">) => void;
    updatePlan: (updatedPlan: Plan) => void;
    deletePlan: (planId: string) => void;
    isLoading: boolean;
    error: string | null;
};
//# sourceMappingURL=usePlans.d.ts.map