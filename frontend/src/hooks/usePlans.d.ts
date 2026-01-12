import type { Plan } from '../types/plan.d';
export declare function usePlans(): {
    plans: Plan[];
    addPlan: (newPlanData: Omit<Plan, "id">) => void;
    updatePlan: (updatedPlan: Plan) => void;
    deletePlan: (planId: string) => void;
};
//# sourceMappingURL=usePlans.d.ts.map