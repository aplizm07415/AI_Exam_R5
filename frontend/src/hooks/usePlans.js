import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
const STORAGE_KEY = 'exercisePlans';
export function usePlans() {
    const [plans, setPlans] = useState([]);
    useEffect(() => {
        try {
            const savedPlans = localStorage.getItem(STORAGE_KEY);
            if (savedPlans) {
                setPlans(JSON.parse(savedPlans));
            }
        }
        catch (error) {
            console.error("Failed to load plans from localStorage", error);
        }
    }, []);
    const savePlans = (newPlans) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newPlans));
            setPlans(newPlans);
        }
        catch (error) {
            console.error("Failed to save plans to localStorage", error);
        }
    };
    const addPlan = (newPlanData) => {
        const newPlan = { ...newPlanData, id: uuidv4() };
        const updatedPlans = [...plans, newPlan];
        savePlans(updatedPlans);
    };
    const updatePlan = (updatedPlan) => {
        const updatedPlans = plans.map(p => p.id === updatedPlan.id ? updatedPlan : p);
        savePlans(updatedPlans);
    };
    const deletePlan = (planId) => {
        const updatedPlans = plans.filter(p => p.id !== planId);
        savePlans(updatedPlans);
    };
    return { plans, addPlan, updatePlan, deletePlan };
}
//# sourceMappingURL=usePlans.js.map