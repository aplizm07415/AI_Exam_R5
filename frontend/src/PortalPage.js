import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Link } from 'react-router-dom';
import SectionHeading from './components/SectionHeading';
export default function PortalPage() {
    const portalLinks = [
        {
            href: '/',
            label: 'Webアプリ',
            note: '学習と復習のメイン導線',
            tone: 'bg-[#3d7cce] hover:bg-[#356db5]',
            kind: 'internal',
        },
        {
            href: 'https://kakomonn.com/account/login',
            label: '診断士一次',
            note: '外部サービスへすぐ移動',
            tone: 'bg-[#2cb4ad] hover:bg-[#249a94]',
            kind: 'external',
        },
        {
            href: 'https://www.ap-siken.com/apkakomon.php',
            label: '応用情報',
            note: '関連学習へのショートカット',
            tone: 'bg-[#cf483e] hover:bg-[#b83f36]',
            kind: 'external',
        },
    ];
    return (_jsxs("div", { className: "motion-page mx-auto flex min-h-[calc(100vh-220px)] max-w-6xl flex-col justify-center", children: [_jsx("section", { className: "motion-rise motion-delay-1 rounded-[2rem] border border-slate-200 bg-white px-6 py-8 shadow-sm md:px-10 md:py-12", children: _jsx(SectionHeading, { eyebrow: "Study Portal", title: "\u5B66\u7FD2\u306E\u5165\u53E3", description: "\u5FC5\u8981\u306A\u5B66\u7FD2\u5148\u3078\u3059\u3070\u3084\u304F\u79FB\u52D5\u3067\u304D\u308B\u3001\u8EFD\u304F\u3066\u898B\u901A\u3057\u306E\u826F\u3044\u30DD\u30FC\u30BF\u30EB\u3067\u3059\u3002\u9759\u304B\u306A\u7ACB\u3061\u4E0A\u304C\u308A\u3068\u3001\u89E6\u308C\u305F\u3068\u304D\u3060\u3051\u53CD\u5FDC\u3059\u308B\u30AB\u30FC\u30C9\u3067\u6574\u7406\u3057\u3066\u3044\u307E\u3059\u3002", titleClassName: "text-4xl md:text-5xl text-slate-900", className: "max-w-3xl", toneClassName: "text-[#3d7cce]" }) }), _jsx("div", { className: "mt-8 grid w-full grid-cols-1 gap-6 md:grid-cols-3", children: portalLinks.map((item, index) => {
                    const content = (_jsxs("div", { className: `motion-card motion-rise rounded-[1.75rem] px-6 py-8 text-white shadow-lg ${item.tone} motion-delay-${Math.min(index + 2, 4)}`, children: [_jsx("div", { className: "text-xs font-semibold uppercase tracking-[0.26em] text-white/75", children: "Destination" }), _jsx("div", { className: "motion-button-text mt-6 text-3xl font-bold tracking-tight", children: item.label }), _jsx("p", { className: "mt-4 text-sm leading-7 text-white/80", children: item.note })] }));
                    if (item.kind === 'internal') {
                        return (_jsx(Link, { to: item.href, className: "block", children: content }, item.label));
                    }
                    return (_jsx("a", { href: item.href, target: "_blank", rel: "noopener noreferrer", className: "block", children: content }, item.label));
                }) })] }));
}
//# sourceMappingURL=PortalPage.js.map