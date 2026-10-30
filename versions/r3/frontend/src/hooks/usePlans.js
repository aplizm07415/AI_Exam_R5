import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
const API_URL = '/api/plans';
const normalizePlan = (plan) => ({
    ...plan,
    archived: plan.archived ?? false,
});
export function usePlans() {
    const [plans, setPlans] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        const fetchPlans = async () => {
            try {
                setIsLoading(true);
                const response = await fetch(API_URL);
                if (!response.ok) {
                    throw new Error('学習計画の取得に失敗しました。');
                }
                const data = await response.json();
                setPlans(data.map(normalizePlan));
            }
            catch (err) {
                setError(err.message);
                console.error("Failed to load plans from API", err);
            }
            finally {
                setIsLoading(false);
            }
        };
        fetchPlans();
    }, []);
    const savePlansToBackend = async (newPlans) => {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newPlans),
            });
            if (!response.ok) {
                throw new Error('学習計画の保存に失敗しました。');
            }
        }
        catch (err) {
            setError(err.message);
            console.error("Failed to save plans to API", err);
            // ここでユーザーにエラーを通知するUIを出すのが望ましい
            // 例: toast("保存に失敗しました。")
        }
    };
    const addPlan = (newPlanData) => {
        const newPlan = normalizePlan({ ...newPlanData, id: uuidv4() });
        const updatedPlans = [...plans, newPlan];
        setPlans(updatedPlans);
        savePlansToBackend(updatedPlans);
    };
    const updatePlan = (updatedPlan) => {
        const updatedPlans = plans.map(p => p.id === updatedPlan.id ? normalizePlan(updatedPlan) : p);
        setPlans(updatedPlans);
        savePlansToBackend(updatedPlans);
    };
    const deletePlan = (planId) => {
        const updatedPlans = plans.filter(p => p.id !== planId);
        setPlans(updatedPlans);
        savePlansToBackend(updatedPlans);
    };
    return { plans, addPlan, updatePlan, deletePlan, isLoading, error };
}
//# sourceMappingURL=usePlans.js.map