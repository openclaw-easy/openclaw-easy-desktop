import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const renderedHtml = useMemo(() => {
    // Configure marked for GitHub Flavored Markdown
    marked.setOptions({
      gfm: true,
      breaks: true,
      highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (err) {
            console.error('Highlight error:', err);
          }
        }
        return hljs.highlightAuto(code).value;
      }
    });

    // Parse markdown to HTML
    const rawHtml = marked.parse(content) as string;

    // Sanitize HTML with DOMPurify
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
        'a', 'ul', 'ol', 'li', 'blockquote',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'div', 'span', 'img'
      ],
      ALLOWED_ATTR: [
        'href', 'target', 'rel', 'class', 'src', 'alt', 'title'
      ],
      ALLOW_DATA_ATTR: false
    });

    return cleanHtml;
  }, [content]);

  return (
    <div
      className={`markdown-content prose prose-invert max-w-none ${className}`}
      style={{
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        maxWidth: '100%'
      }}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
      onClick={(e) => {
        // Open links in external browser
        const target = e.target as HTMLElement;
        if (target.tagName === 'A') {
          e.preventDefault();
          const href = target.getAttribute('href');
          if (href) {
            window.electronAPI?.openExternal?.(href);
          }
        }
      }}
    />
  );
}
