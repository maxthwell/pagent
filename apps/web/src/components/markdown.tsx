"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";

function normalizeMathDelimiters(input: string): string {
  // Support common LaTeX math delimiters beyond $...$ / $$...$$
  // - \( ... \) -> $ ... $
  // - \[ ... \] -> $$ ... $$
  // - [ \frac{...} ... ] (common plaintext display-math) -> block $$ ... $$
  let out = input;

  out = out.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
  out = out.replace(/\\\(/g, "$").replace(/\\\)/g, "$");

  // Heuristic: transform bracketed LaTeX that starts with a command into display math.
  // Avoids interfering with markdown links because those are immediately followed by "(".
  out = out.replace(/(^|[\n\r]|[：:]\s*)\[\s*(\\[A-Za-z][\s\S]*?)\s*\](?=\s|$)/g, (_m, prefix, inner) => {
    return `${prefix}\n\n$$\n${inner}\n$$\n\n`;
  });

  return out;
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: "ignore" }],
          [rehypeHighlight, { ignoreMissing: true }]
        ]}
        components={{
          a: ({ node, ...props }) => (
            // eslint-disable-next-line jsx-a11y/anchor-has-content
            <a {...props} target="_blank" rel="noreferrer" />
          )
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}
