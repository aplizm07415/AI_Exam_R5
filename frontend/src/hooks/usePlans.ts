import { useState, useEffect } from 'react';
import type { Plan } from '../types/plan.d';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'exercisePlans';

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    try {
      const savedPlans = localStorage.getItem(STORAGE_KEY);
      if (savedPlans) {
        setPlans(JSON.parse(savedPlans));
      }
    } catch (error) {
      console.error("Failed to load plans from localStorage", error);
    }
  }, []);

  const savePlans = (newPlans: Plan[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPlans));
      setPlans(newPlans);
    } catch (error) {
      console.error("Failed to save plans to localStorage", error);
    }
  };

  const addPlan = (newPlanData: Omit<Plan, 'id'>) => {
    const newPlan: Plan = { ...newPlanData, id: uuidv4() };
    const updatedPlans = [...plans, newPlan];
    savePlans(updatedPlans);
  };

  const updatePlan = (updatedPlan: Plan) => {
    const updatedPlans = plans.map(p => p.id === updatedPlan.id ? updatedPlan : p);
    savePlans(updatedPlans);
  };

  const deletePlan = (planId: string) => {
    const updatedPlans = plans.filter(p => p.id !== planId);
    savePlans(updatedPlans);
  };

  return { plans, addPlan, updatePlan, deletePlan };
}
