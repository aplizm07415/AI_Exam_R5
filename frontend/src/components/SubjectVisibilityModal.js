import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
export default function SubjectVisibilityModal({ isOpen, onClose, subjects, hiddenSubjects, onHiddenSubjectsChange, }) {
    const [tempHiddenSubjects, setTempHiddenSubjects] = useState(hiddenSubjects);
    useEffect(() => {
        setTempHiddenSubjects(hiddenSubjects);
    }, [hiddenSubjects, isOpen]);
    const handleCheckboxChange = (subjectName, isHidden) => {
        if (isHidden) {
            setTempHiddenSubjects(prev => [...prev, subjectName]);
        }
        else {
            setTempHiddenSubjects(prev => prev.filter(name => name !== subjectName));
        }
    };
    const handleSave = () => {
        onHiddenSubjectsChange(tempHiddenSubjects);
        onClose();
    };
    const handleCancel = () => {
        setTempHiddenSubjects(hiddenSubjects); // 変更をリセット
        onClose();
    };
    if (!isOpen) {
        return null;
    }
    return (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col", children: [_jsxs("div", { className: "flex justify-between items-center p-4 border-b", children: [_jsx("h3", { className: "text-xl font-bold text-gray-800", children: "\u8868\u793A\u79D1\u76EE\u306E\u5236\u5FA1" }), _jsx("button", { onClick: handleCancel, className: "text-gray-400 hover:text-gray-600", children: _jsx("svg", { xmlns: "http://www.w3.org/2000/svg", className: "h-6 w-6", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) }) })] }), _jsxs("div", { className: "p-6 overflow-y-auto", children: [_jsx("p", { className: "text-sm text-gray-600 mb-4", children: "\u30C9\u30ED\u30C3\u30D7\u30C0\u30A6\u30F3\u30EA\u30B9\u30C8\u306B\u8868\u793A\u3059\u308B\u79D1\u76EE\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u30C1\u30A7\u30C3\u30AF\u3092\u5916\u3057\u305F\u79D1\u76EE\u306F\u975E\u8868\u793A\u306B\u306A\u308A\u307E\u3059\u3002" }), _jsx("div", { className: "space-y-3", children: subjects.map(subject => (_jsxs("label", { className: "flex items-center p-3 rounded-lg hover:bg-gray-100 transition-colors duration-200", children: [_jsx("input", { type: "checkbox", className: "h-5 w-5 rounded text-primary-new focus:ring-primary-new border-gray-300", checked: !tempHiddenSubjects.includes(subject.name), onChange: e => handleCheckboxChange(subject.name, !e.target.checked) }), _jsx("span", { className: "ml-4 text-md font-medium text-gray-800", children: subject.name })] }, subject.name))) })] }), _jsxs("div", { className: "flex justify-end gap-4 p-4 border-t", children: [_jsx("button", { onClick: handleCancel, className: "px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-300", children: "\u30AD\u30E3\u30F3\u30BB\u30EB" }), _jsx("button", { onClick: handleSave, className: "px-4 py-2 bg-primary-new text-white text-sm font-medium rounded-md hover:bg-blue-700", children: "\u4FDD\u5B58\u3059\u308B" })] })] }) }));
}
//# sourceMappingURL=SubjectVisibilityModal.js.map