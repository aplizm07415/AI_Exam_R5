import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useMemo, useEffect } from 'react';
import UploadPage from './UploadPage';
import QuizPage from './QuizPage';
import DashboardPage from './DashboardPage';
import { FileUpIcon, LayoutDashboardIcon, FileTextIcon } from './components/icons';
const API_BASE_URL = "/api";
export default function App() {
    const [activePage, setActivePage] = useState('quiz');
    const [subjects, setSubjects] = useState([]);
    const fetchSubjects = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/subjects`);
            if (!response.ok) {
                throw new Error("Failed to fetch subject names.");
            }
            const subjectNames = await response.json();
            const subjectObjects = subjectNames.map(name => ({ name }));
            setSubjects(subjectObjects.sort((a, b) => a.name.localeCompare(b.name)));
        }
        catch (error) {
            console.error("Failed to fetch subjects:", error);
        }
    };
    useEffect(() => {
        fetchSubjects();
    }, []);
    const handleUploadSuccess = () => {
        fetchSubjects();
    };
    const renderPage = () => {
        switch (activePage) {
            case 'upload':
                return _jsx(UploadPage, { onUploadSuccess: handleUploadSuccess });
            case 'quiz':
                return _jsx(QuizPage, { subjects: subjects });
            case 'dashboard':
                return _jsx(DashboardPage, { subjects: subjects }, subjects.map(s => s.name).join(','));
            default:
                return _jsx(QuizPage, { subjects: subjects }); // Changed default to QuizPage
        }
    };
    const navItems = useMemo(() => [
        { id: 'upload', label: 'データ管理', icon: _jsx(FileUpIcon, { className: "w-5 h-5" }) },
        { id: 'quiz', label: '練習問題', icon: _jsx(FileTextIcon, { className: "w-5 h-5" }) },
        { id: 'dashboard', label: 'ダッシュボード', icon: _jsx(LayoutDashboardIcon, { className: "w-5 h-5" }) },
    ], []);
    return (_jsxs("div", { className: "min-h-screen bg-gray-100 text-gray-800 flex flex-col", children: [_jsx("header", { className: "bg-white/90 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20", children: _jsx("div", { className: "container mx-auto px-4 sm:px-6 lg:px-8", children: _jsxs("div", { className: "flex items-center justify-between h-16", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "bg-primary-new p-2 rounded-lg", children: _jsx(FileTextIcon, { className: "w-6 h-6 text-white" }) }), _jsx("h1", { className: "text-xl font-bold text-dark", children: "R2" })] }), _jsx("nav", { className: "hidden md:flex space-x-2 bg-gray-200 p-1 rounded-lg", children: navItems.map((item) => (_jsxs("button", { onClick: () => setActivePage(item.id), className: `flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${activePage === item.id
                                        ? 'bg-primary-new text-white'
                                        : 'text-dark hover:bg-blue-100 hover:text-primary-new'}`, children: [item.icon, _jsx("span", { children: item.label })] }, item.id))) })] }) }) }), _jsx("main", { className: "flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8", children: _jsx("div", { className: "fade-in", children: renderPage() }) }), _jsx("nav", { className: "md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around p-2", children: navItems.map((item) => (_jsxs("button", { onClick: () => setActivePage(item.id), className: `flex flex-col items-center w-full py-1 rounded-md transition-colors duration-200 ${activePage === item.id ? 'text-primary-new' : 'text-dark hover:bg-gray-100'}`, children: [item.icon, _jsx("span", { className: "text-xs mt-1", children: item.label })] }, item.id))) }), _jsx("div", { className: "h-16 md:hidden" })] }));
}
//# sourceMappingURL=App.js.map