import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import AnimatedTitle from './AnimatedTitle';
export default function SectionHeading({ eyebrow, title, description, titleClassName = '', className = '', toneClassName = 'text-slate-400', }) {
    return (_jsxs("div", { className: `section-heading ${className}`.trim(), children: [_jsx("div", { className: `section-heading-eyebrow ${toneClassName}`.trim(), children: eyebrow }), _jsx("h2", { className: `section-heading-title ${titleClassName}`.trim(), children: _jsx(AnimatedTitle, { text: title }) }), description ? _jsx("p", { className: "section-heading-description", children: description }) : null] }));
}
//# sourceMappingURL=SectionHeading.js.map