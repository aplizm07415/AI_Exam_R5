import { jsx as _jsx } from "react/jsx-runtime";
import { isValidElement } from 'react';
const rawTableHtmlPattern = /<\/?(?:table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col)\b/i;
const allowedTableHtmlTags = new Set([
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'colgroup',
    'col',
    'br',
    'p',
    'strong',
    'b',
    'em',
    'i',
    'code',
    'span',
    'div',
    'ul',
    'ol',
    'li',
]);
const safeTableHtmlAttributes = new Map([
    ['align', 'align'],
    ['colspan', 'colSpan'],
    ['rowspan', 'rowSpan'],
    ['scope', 'scope'],
]);
const getTextLength = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') {
        return 0;
    }
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node).trim().length;
    }
    if (Array.isArray(node)) {
        return node.reduce((total, child) => total + getTextLength(child), 0);
    }
    if (isValidElement(node)) {
        return getTextLength(node.props.children);
    }
    return 0;
};
const getCellClassName = (className, textLength) => {
    const existingClassName = typeof className === 'string' ? className : '';
    const densityClassName = textLength >= 180
        ? 'markdown-table-cell--very-long'
        : textLength >= 48
            ? 'markdown-table-cell--long'
            : '';
    return [existingClassName, densityClassName].filter(Boolean).join(' ');
};
const getElementProperties = (element) => {
    const properties = {};
    for (const attribute of Array.from(element.attributes)) {
        const propertyName = safeTableHtmlAttributes.get(attribute.name.toLowerCase());
        if (!propertyName) {
            continue;
        }
        const numericValue = Number(attribute.value);
        properties[propertyName] = Number.isFinite(numericValue) && attribute.value.trim() !== '' ? numericValue : attribute.value;
    }
    return properties;
};
const domNodeToHast = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
        return [{ type: 'text', value: node.textContent ?? '' }];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return [];
    }
    const element = node;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'script' || tagName === 'style' || tagName === 'iframe') {
        return [];
    }
    const children = Array.from(element.childNodes).flatMap(domNodeToHast);
    if (!allowedTableHtmlTags.has(tagName)) {
        return children;
    }
    return [
        {
            type: 'element',
            tagName,
            properties: getElementProperties(element),
            children,
        },
    ];
};
const parseRawTableHtml = (html) => {
    if (!rawTableHtmlPattern.test(html) || typeof DOMParser === 'undefined') {
        return [];
    }
    const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(parsedDocument.body.childNodes).flatMap(domNodeToHast);
};
const transformRawTableHtml = (node) => {
    if (!Array.isArray(node.children)) {
        return;
    }
    for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (!child) {
            continue;
        }
        if (child.type === 'raw' && typeof child.value === 'string') {
            const replacement = parseRawTableHtml(child.value);
            if (replacement.length > 0) {
                node.children.splice(index, 1, ...replacement);
                index += replacement.length - 1;
                continue;
            }
        }
        transformRawTableHtml(child);
    }
};
const rehypeRawTableHtml = () => (tree) => {
    transformRawTableHtml(tree);
};
export const markdownRehypePlugins = [rehypeRawTableHtml];
export const markdownComponents = {
    table: ({ node: _node, ...props }) => (_jsx("div", { className: "markdown-table-scroll", children: _jsx("table", { ...props }) })),
    th: ({ node: _node, className, children, ...props }) => (_jsx("th", { ...props, className: getCellClassName(className, getTextLength(children)), children: children })),
    td: ({ node: _node, className, children, ...props }) => (_jsx("td", { ...props, className: getCellClassName(className, getTextLength(children)), children: children })),
};
//# sourceMappingURL=markdownComponents.js.map