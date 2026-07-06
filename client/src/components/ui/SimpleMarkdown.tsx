import { Fragment } from 'react';

export function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// Manuscript reading surface for note content — Newsreader serif prose,
// hairline-underlined headings, and an amber-rule pull-quote treatment for
// blockquotes (DESIGN.md "Prose/reading" + signature pull-quote move).
export default function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <div className="font-serif text-[17px] leading-[1.7] text-gray-700 dark:text-gray-300 max-w-[65ch]">
      {lines.map((line, i) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={i} className="font-serif text-lg text-gray-900 dark:text-white mt-6 mb-2 first:mt-0">
              {trimmed.slice(4)}
            </h3>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h2 key={i} className="font-serif text-xl text-gray-900 dark:text-white mt-7 mb-3 pb-2 border-b border-rule dark:border-dark-border first:mt-0">
              {trimmed.slice(3)}
            </h2>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h1 key={i} className="font-serif italic text-2xl text-gray-900 dark:text-white mt-7 mb-3 first:mt-0">
              {trimmed.slice(2)}
            </h1>
          );
        }
        if (trimmed.startsWith('> ')) {
          return (
            <blockquote
              key={i}
              className="border-l-2 border-primary-400 dark:border-primary-500 pl-4 py-0.5 my-4 font-serif italic text-gray-600 dark:text-gray-300"
            >
              {renderInlineMarkdown(trimmed.slice(2))}
            </blockquote>
          );
        }
        if (trimmed.startsWith('- ')) {
          return (
            <div key={i} className="flex gap-2.5 ml-1 my-1.5">
              <span className="text-primary-500 dark:text-primary-400 shrink-0" aria-hidden="true">&middot;</span>
              <span>{renderInlineMarkdown(trimmed.slice(2))}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(trimmed)) {
          const match = trimmed.match(/^(\d+)\.\s(.*)$/);
          if (match) {
            return (
              <div key={i} className="flex gap-3 ml-1 my-1.5">
                <span className="font-sans text-[12px] text-gray-400 dark:text-gray-600 shrink-0 pt-1 tabular-nums">
                  {match[1].padStart(2, '0')}
                </span>
                <span>{renderInlineMarkdown(match[2])}</span>
              </div>
            );
          }
        }
        if (trimmed === '') {
          return <div key={i} className="h-3" />;
        }
        return <p key={i} className="my-1.5 break-words">{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
}
