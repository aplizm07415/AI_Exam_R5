import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useMemo } from 'react';
import { usePlans } from './hooks/usePlans';
import { isHoliday } from './utils/date';
const TrashIcon = (props) => (_jsx("svg", { xmlns: "http://www.w3.org/2000/svg", width: "1em", height: "1em", viewBox: "0 0 24 24", ...props, children: _jsx("path", { fill: "currentColor", d: "M7 21q-.825 0-1.412-.588T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.588 1.413T17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2zM7 6v13z" }) }));
export default function PlanManagementDashboard({ subjects, dailySummaryAll }) {
    const { plans, addPlan, updatePlan, deletePlan } = usePlans();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingPlan, setEditingPlan] = useState(null);
    // Form state
    const [title, setTitle] = useState('');
    const [selectedSubjects, setSelectedSubjects] = useState([]);
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    // New state for plan creation mode
    const [planCreationMode, setPlanCreationMode] = useState('daily');
    // State for "daily" mode
    const [weekdayGoal, setWeekdayGoal] = useState(10);
    const [holidayGoal, setHolidayGoal] = useState(10);
    // State for "total" mode
    const [totalQuestions, setTotalQuestions] = useState(500);
    const [weekdayRatio, setWeekdayRatio] = useState(1);
    const [holidayRatio, setHolidayRatio] = useState(2);
    const [applyDays, setApplyDays] = useState('all');
    const handleSubjectChange = (subjectName) => {
        setSelectedSubjects(prev => prev.includes(subjectName)
            ? prev.filter(s => s !== subjectName)
            : [...prev, subjectName]);
    };
    const resetForm = () => {
        setTitle('');
        setSelectedSubjects([]);
        setFromDate('');
        setToDate('');
        setWeekdayGoal(10);
        setHolidayGoal(10);
        setTotalQuestions(500);
        setWeekdayRatio(1);
        setHolidayRatio(2);
        setApplyDays('all');
        setPlanCreationMode('daily');
        setEditingPlan(null);
        setIsFormOpen(false);
    };
    const handleSubmit = (e) => {
        e.preventDefault();
        if (!title || selectedSubjects.length === 0 || !fromDate || !toDate) {
            alert('タイトル、科目、期間をすべて入力してください。');
            return;
        }
        let calculatedWeekdayGoal = weekdayGoal;
        let calculatedHolidayGoal = holidayGoal;
        if (planCreationMode === 'total') {
            if (!totalQuestions || (weekdayRatio <= 0 && holidayRatio <= 0)) {
                alert('総問題数と比率を正しく入力してください。');
                return;
            }
            let numWeekdays = 0;
            let numHolidays = 0;
            let currentDate = new Date(fromDate);
            const lastDate = new Date(toDate);
            while (currentDate <= lastDate) {
                if (isHoliday(currentDate)) {
                    numHolidays++;
                }
                else {
                    numWeekdays++;
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
            if (numWeekdays === 0 && numHolidays === 0) {
                alert('有効な期間ではありません。');
                return;
            }
            const totalRatioUnits = (numWeekdays * weekdayRatio) + (numHolidays * holidayRatio);
            if (totalRatioUnits === 0) {
                alert('比率が0のため、一日あたりの問題数を計算できません。平日か休日のどちらかの比率を0より大きくしてください。');
                return;
            }
            const questionsPerRatioUnit = totalQuestions / totalRatioUnits;
            calculatedWeekdayGoal = Math.round(questionsPerRatioUnit * weekdayRatio);
            calculatedHolidayGoal = Math.round(questionsPerRatioUnit * holidayRatio);
        }
        const newPlan = {
            title,
            subjectNames: selectedSubjects,
            period: { from: fromDate, to: toDate },
            dailyGoal: { weekday: calculatedWeekdayGoal, holiday: calculatedHolidayGoal },
            applyDays,
            enabled: true,
        };
        if (editingPlan) {
            updatePlan({ ...editingPlan, ...newPlan });
        }
        else {
            addPlan(newPlan);
        }
        resetForm();
    };
    const handleEdit = (plan) => {
        setEditingPlan(plan);
        setTitle(plan.title);
        setSelectedSubjects(plan.subjectNames);
        setFromDate(plan.period.from);
        setToDate(plan.period.to);
        setWeekdayGoal(plan.dailyGoal.weekday);
        setHolidayGoal(plan.dailyGoal.holiday);
        setApplyDays(plan.applyDays);
        setPlanCreationMode('daily'); // Editing defaults to daily mode for simplicity
        setIsFormOpen(true);
    };
    const toggleEnabled = (plan) => {
        updatePlan({ ...plan, enabled: !plan.enabled });
    };
    const progressData = useMemo(() => {
        const activePlans = plans.filter(p => p.enabled);
        if (activePlans.length === 0)
            return [];
        const actualsMap = new Map(dailySummaryAll.filter(item => item.date).map(item => [item.date, item.total_questions]));
        const allDates = new Set();
        activePlans.forEach(p => {
            if (!p.period || typeof p.period.from !== 'string' || typeof p.period.to !== 'string') {
                return;
            }
            let current = new Date(p.period.from);
            const to = new Date(p.period.to);
            while (current <= to) {
                allDates.add(current.toISOString().split('T')[0]);
                current.setDate(current.getDate() + 1);
            }
        });
        dailySummaryAll.forEach(item => {
            if (item.date) {
                allDates.add(item.date);
            }
        });
        if (allDates.size === 0)
            return [];
        const sortedDates = Array.from(allDates).sort();
        let cumulativePlan = 0;
        let cumulativeActual = 0;
        return sortedDates.map(dateStr => {
            const date = new Date(dateStr);
            date.setUTCHours(0, 0, 0, 0);
            let dailyPlan = 0;
            activePlans.forEach((plan) => {
                if (!plan.period.from || !plan.period.to)
                    return;
                const from = new Date(plan.period.from);
                const to = new Date(plan.period.to);
                from.setUTCHours(0, 0, 0, 0);
                to.setUTCHours(0, 0, 0, 0);
                if (date >= from && date <= to) {
                    const holiday = isHoliday(date);
                    if (plan.applyDays === 'all') {
                        dailyPlan += holiday ? plan.dailyGoal.holiday : plan.dailyGoal.weekday;
                    }
                    else if (plan.applyDays === 'holiday' && holiday) {
                        dailyPlan += plan.dailyGoal.holiday;
                    }
                    else if (plan.applyDays === 'weekday' && !holiday) {
                        dailyPlan += plan.dailyGoal.weekday;
                    }
                }
            });
            const dailyActual = actualsMap.get(dateStr) || 0;
            cumulativePlan += dailyPlan;
            cumulativeActual += dailyActual;
            const dailyProgress = dailyPlan > 0 ? (dailyActual / dailyPlan) * 100 : 0;
            const cumulativeProgress = cumulativePlan > 0 ? (cumulativeActual / cumulativePlan) * 100 : 0;
            return {
                date: dateStr,
                plan: { daily: dailyPlan, cumulative: cumulativePlan },
                actual: { daily: dailyActual, cumulative: cumulativeActual },
                progress: { daily: dailyProgress, cumulative: cumulativeProgress },
            };
        }).filter(d => d.plan.cumulative > 0 || d.actual.cumulative > 0)
            .sort((a, b) => b.date.localeCompare(a.date));
    }, [plans, dailySummaryAll]);
    return (_jsxs("div", { className: "bg-white rounded-xl shadow p-6", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-gray-800", children: "\u5B66\u7FD2\u4E88\u5B9A\u7BA1\u7406" }), _jsx("button", { onClick: () => setIsFormOpen(!isFormOpen), className: "px-4 py-2 bg-primary-new text-white rounded-lg hover:bg-blue-700 transition-colors", children: isFormOpen ? '閉じる' : '新しい予定を追加' })] }), isFormOpen && (_jsx("div", { className: "mb-8 p-6 border border-gray-200 rounded-lg bg-gray-50", children: _jsxs("form", { onSubmit: handleSubmit, className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "title", className: "block text-sm font-medium text-gray-700", children: "\u4E88\u5B9A\u30BF\u30A4\u30C8\u30EB" }), _jsx("input", { type: "text", id: "title", value: title, onChange: e => setTitle(e.target.value), required: true, className: "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u5BFE\u8C61\u79D1\u76EE (\u8907\u6570\u9078\u629E\u53EF)" }), _jsx("div", { className: "mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3", children: subjects.map(s => (_jsx("button", { type: "button", onClick: () => handleSubjectChange(s.name), className: `px-3 py-2 rounded-md text-sm font-medium text-left truncate ${selectedSubjects.includes(s.name) ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: s.name }, s.name))) })] }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "fromDate", className: "block text-sm font-medium text-gray-700", children: "\u5BFE\u8C61\u671F\u9593 (From)" }), _jsx("input", { type: "date", id: "fromDate", value: fromDate, onChange: e => setFromDate(e.target.value), required: true, className: "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "toDate", className: "block text-sm font-medium text-gray-700", children: "\u5BFE\u8C61\u671F\u9593 (To)" }), _jsx("input", { type: "date", id: "toDate", value: toDate, onChange: e => setToDate(e.target.value), required: true, className: "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "\u8A08\u753B\u65B9\u6CD5" }), _jsxs("div", { className: "flex rounded-md shadow-sm", children: [_jsx("button", { type: "button", onClick: () => setPlanCreationMode('daily'), className: `px-4 py-2 text-sm font-medium rounded-l-md w-1/2 ${planCreationMode === 'daily' ? 'bg-primary-new text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`, children: "\u65E5\u5225\u76EE\u6A19" }), _jsx("button", { type: "button", onClick: () => setPlanCreationMode('total'), className: `px-4 py-2 text-sm font-medium rounded-r-md w-1/2 ${planCreationMode === 'total' ? 'bg-primary-new text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`, children: "\u7DCF\u6570\u304B\u3089\u9006\u7B97" })] })] }), planCreationMode === 'daily' && (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "1\u65E5\u306E\u554F\u984C\u5B9F\u65BD\u8A08\u753B\u6570" }), _jsxs("div", { className: "mt-2 space-y-4", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("label", { htmlFor: "weekdayGoal", className: "w-20 text-sm text-gray-500", children: "\u5E73\u65E5" }), _jsx("input", { type: "number", id: "weekdayGoal", value: weekdayGoal, onChange: e => setWeekdayGoal(parseInt(e.target.value, 10)), min: "0", className: "block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("label", { htmlFor: "holidayGoal", className: "w-20 text-sm text-gray-500", children: "\u571F\u65E5\u795D" }), _jsx("input", { type: "number", id: "holidayGoal", value: holidayGoal, onChange: e => setHolidayGoal(parseInt(e.target.value, 10)), min: "0", className: "block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" })] })] })] })), planCreationMode === 'total' && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "totalQuestions", className: "block text-sm font-medium text-gray-700", children: "\u671F\u9593\u4E2D\u306E\u7DCF\u554F\u984C\u6570" }), _jsx("input", { type: "number", id: "totalQuestions", value: totalQuestions, onChange: e => setTotalQuestions(parseInt(e.target.value, 10)), min: "0", className: "mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-new focus:border-primary-new sm:text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u5E73\u65E5\u3068\u571F\u65E5\u795D\u306E\u6D3B\u52D5\u6BD4\u7387" }), _jsxs("div", { className: "mt-2 flex items-center gap-4", children: [_jsx("input", { type: "number", value: weekdayRatio, onChange: e => setWeekdayRatio(parseInt(e.target.value, 10)), min: "0", className: "block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm" }), _jsx("span", { className: "text-gray-500", children: ":" }), _jsx("input", { type: "number", value: holidayRatio, onChange: e => setHolidayRatio(parseInt(e.target.value, 10)), min: "0", className: "block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm" })] })] })] })), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "\u9069\u7528\u66DC\u65E5" }), _jsx("div", { className: "mt-2 flex space-x-4", children: ['all', 'weekday', 'holiday'].map(dayType => (_jsx("button", { type: "button", onClick: () => setApplyDays(dayType), className: `px-4 py-2 rounded-md text-sm font-medium ${applyDays === dayType ? 'bg-primary-new text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`, children: dayType === 'all' ? '毎日' : dayType === 'weekday' ? '平日のみ' : '土日祝のみ' }, dayType))) })] }), _jsxs("div", { className: "flex justify-end gap-4", children: [_jsx("button", { type: "button", onClick: resetForm, className: "px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300", children: "\u30AD\u30E3\u30F3\u30BB\u30EB" }), _jsx("button", { type: "submit", className: "px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700", children: editingPlan ? '更新' : '登録' })] })] }) })), _jsx("div", { className: "space-y-4", children: plans.map(plan => (_jsxs("div", { className: "p-4 border rounded-lg flex items-center justify-between hover:bg-gray-50 transition-colors", children: [_jsxs("div", { className: "flex-1 cursor-pointer", onClick: () => handleEdit(plan), children: [_jsx("p", { className: "font-bold text-gray-800", children: plan.title }), _jsx("p", { className: "text-sm text-gray-500", children: plan.subjectNames.join(', ') }), _jsxs("p", { className: "text-sm text-gray-500", children: [plan.period.from, " ~ ", plan.period.to] })] }), _jsxs("div", { className: "flex items-center gap-4 ml-4", children: [_jsx("label", { htmlFor: `toggle-${plan.id}`, className: "flex items-center cursor-pointer", children: _jsxs("div", { className: "relative", children: [_jsx("input", { type: "checkbox", id: `toggle-${plan.id}`, className: "sr-only", checked: plan.enabled, onChange: () => toggleEnabled(plan) }), _jsx("div", { className: `block w-14 h-8 rounded-full ${plan.enabled ? 'bg-green-500' : 'bg-gray-300'}` }), _jsx("div", { className: `dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${plan.enabled ? 'translate-x-6' : ''}` })] }) }), _jsx("button", { onClick: () => deletePlan(plan.id), className: "text-gray-400 hover:text-red-600", children: _jsx(TrashIcon, { className: "w-6 h-6" }) })] })] }, plan.id))) }), _jsxs("div", { className: "mt-8", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-700 mb-4", children: "\u9032\u6357\u30B5\u30DE\u30EA\u30FC" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "\u65E5\u4ED8" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "\u4E88\u5B9A (\u65E5/\u7D2F)" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "\u5B9F\u7E3E (\u65E5/\u7D2F)" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "\u9032\u6357 (\u65E5/\u7D2F)" })] }) }), _jsxs("tbody", { className: "bg-white divide-y divide-gray-200", children: [progressData.map((row, index) => (_jsxs("tr", { children: [_jsx("td", { className: "px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900", children: row.date }), _jsxs("td", { className: "px-4 py-4 whitespace-nowrap text-sm text-gray-500", children: [row.plan.daily, " / ", row.plan.cumulative] }), _jsxs("td", { className: "px-4 py-4 whitespace-nowrap text-sm text-gray-500", children: [row.actual.daily, " / ", row.actual.cumulative] }), _jsxs("td", { className: "px-4 py-4 whitespace-nowrap text-sm text-gray-500", children: [row.progress.daily.toFixed(0), "% / ", row.progress.cumulative.toFixed(0), "%"] })] }, index))), progressData.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 4, className: "text-center py-10 text-sm text-gray-500", children: "\u8868\u793A\u3067\u304D\u308B\u9032\u6357\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u4E88\u5B9A\u3092\u767B\u9332\u3057\u3001\u6F14\u7FD2\u3092\u884C\u3046\u3068\u8868\u793A\u3055\u308C\u307E\u3059\u3002" }) }))] })] }) })] })] }));
}
//# sourceMappingURL=PlanManagementDashboard.js.map