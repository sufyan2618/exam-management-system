import { Fragment } from "react";

function inlineContent(text: string) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

// Render a limited set of exam formatting as React nodes. Raw HTML and
// external resources remain plain text.
export function ExamMarkdown({ text }: { text: string }) {
  return <div className="exam-markdown">
    {text.split(/\r?\n\s*\r?\n/).map((block, index) => {
      const lines = block.split(/\r?\n/);
      if (lines.every((line) => /^[-*] /.test(line))) {
        return <ul key={index}>{lines.map((line, i) => <li key={i}>{inlineContent(line.slice(2))}</li>)}</ul>;
      }
      if (lines.every((line) => /^\d+\. /.test(line))) {
        return <ol key={index}>{lines.map((line, i) => <li key={i}>{inlineContent(line.replace(/^\d+\. /, ""))}</li>)}</ol>;
      }
      return <p className="exam-prose" key={index}>{inlineContent(block.replace(/^#{1,6} /gm, ""))}</p>;
    })}
  </div>;
}
