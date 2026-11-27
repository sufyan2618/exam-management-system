import { useState } from "react";
import type { ExamResult } from "../api/examination";
import { ExamMarkdown } from "./ExamMarkdown";

type Question = NonNullable<ExamResult["questions"]>[number];

function ResultQuestion({ q, index }: { q: Question; index: number }) {
  return <article className="result-question" aria-labelledby={"review-question-" + index}>
            <header className="result-question-header">
              <div className="result-question-identity"><span className="result-question-number">{String(index + 1).padStart(2, "0")}</span><div><h3 id={"review-question-" + index}>Question {index + 1}</h3><span className="result-question-kind">{q.options?.length ? "Choice response" : "Written response"}</span></div></div>
              <span className="result-marks" data-full={q.marks > 0 && q.score === q.marks}><strong>{q.score} / {q.marks}</strong> marks</span>
            </header>
            <div className="result-question-body">
              <div className="result-question-stem"><ExamMarkdown text={q.stem} /></div>
              {!!q.options?.length && <ul className="result-options" aria-label="Answer choices">
                {q.options.map((o) => <li key={o.label} className="result-option" data-selected={o.selected} data-correct={o.isCorrect === true}>
                  <span className="result-option-letter">{o.label}</span><span className="result-option-text">{o.text}</span>
                  <span className="result-option-tags">{o.selected && <span className="result-selection-tag">Your answer</span>}{o.isCorrect && <span className="result-correct-tag">✓ Correct answer</span>}</span>
                </li>)}
              </ul>}
              {q.textAnswer && <section className="result-written-answer"><h4>Your response</h4><ExamMarkdown text={q.textAnswer} /></section>}
              {!q.answered && !q.textAnswer && !q.options?.some((o) => o.selected) && <p className="result-unanswered">No answer submitted.</p>}
              {(q.feedback || q.explanation) && <div className="result-insights">
                {q.feedback && <section className="result-feedback"><h4>Examiner feedback</h4><ExamMarkdown text={q.feedback} /></section>}
                {q.explanation && <section className="result-explanation"><h4>Explanation</h4><ExamMarkdown text={q.explanation} /></section>}
              </div>}
            </div>
          </article>;
}

export function ResultQuestionReview({ questions }: { questions: Question[] }) {
  const [position, setPosition] = useState(0);
  const index = Math.min(position, questions.length - 1);
  if (!questions.length) return null;
  return <section className="result-question-viewer" aria-label="Question review">
    <header className="result-review-heading"><h2>Question review</h2><span role="status" aria-live="polite">Question {index + 1} of {questions.length}</span></header>
    <ResultQuestion q={questions[index]} index={index} />
    <nav className="result-question-navigation" aria-label="Review questions">
      <button type="button" className="button button-ghost" disabled={index === 0} onClick={() => setPosition(index - 1)}>← Previous</button>
      <label className="result-question-jump">Question<select aria-label="Go to question" value={index} onChange={(event) => setPosition(Number(event.target.value))}>{questions.map((q, i) => <option key={q.attemptQuestionId} value={i}>{i + 1} of {questions.length}</option>)}</select></label>
      <button type="button" className="button button-primary" disabled={index === questions.length - 1} onClick={() => setPosition(index + 1)}>Next →</button>
    </nav>
  </section>;
}
