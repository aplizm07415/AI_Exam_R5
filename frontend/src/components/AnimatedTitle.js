import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
export default function AnimatedTitle({ text, className = '', }) {
    return (_jsx("span", { className: `motion-title ${className}`.trim(), "aria-label": text, children: Array.from(text).map((char, index) => (_jsx("span", { className: "motion-title-char", style: { animationDelay: `${index * 45}ms` }, "aria-hidden": "true", children: char === ' ' ? '\u00A0' : char }, `${char}-${index}`))) }));
}
//# sourceMappingURL=AnimatedTitle.js.map