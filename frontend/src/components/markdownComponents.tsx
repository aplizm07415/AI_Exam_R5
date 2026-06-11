import type { Components } from 'react-markdown';

export const markdownComponents: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="markdown-table-scroll">
      <table {...props} />
    </div>
  ),
};
