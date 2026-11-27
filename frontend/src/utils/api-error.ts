export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown[];
  readonly retryable: boolean;

  constructor(message: string, status: number, code?: string, requestId?: string, details: unknown[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    this.retryable = [0, 502, 503, 504].includes(status);
  }
}

export type ApiValidationIssue = { field: string; label: string; message: string };

const fieldLabels: Record<string, string> = {
  title: "Title", stem: "Question text", type: "Question type", categoryId: "Category", difficulty: "Difficulty",
  defaultMarks: "Marks", marks: "Marks", passMarks: "Pass marks", totalMarks: "Total marks", startsAt: "Opening time",
  endsAt: "Closing time", durationMinutes: "Duration", instructions: "Instructions", options: "Answer options",
  rubric: "Marking rubric", tags: "Tags", emails: "Email addresses", email: "Email address", name: "Name",
  maxAttempts: "Maximum attempts", lateEntryMinutes: "Late entry minutes", disputeWindowHours: "Dispute window",
};

export function getApiValidationIssues(error: unknown): ApiValidationIssue[] {
  if (!(error instanceof ApiError)) return [];
  return error.details.flatMap((detail) => {
    if (!detail || typeof detail !== "object") return [];
    const item = detail as { field?: unknown; issue?: unknown; message?: unknown };
    const field = typeof item.field === "string" ? item.field.replace(/^(body|query|params)\./, "") : "";
    const issue = typeof item.issue === "string" ? item.issue : typeof item.message === "string" ? item.message : "Check this value.";
    const option = /^options\.(\d+)(?:\.(text|isCorrect))?$/.exec(field);
    const label = option ? `Option ${Number(option[1]) + 1}${option[2] === "text" ? " text" : option[2] === "isCorrect" ? " correctness" : ""}` :
      fieldLabels[field] ?? (field ? field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()) : "Form");
    return [{ field, label, message: readableValidationMessage(issue) }];
  });
}

export function readableValidationMessage(issue: string) {
  const known: Record<string, string> = {
    "endsAt must be after startsAt": "Choose a closing time after the opening time.",
    "Duration cannot exceed the exam window unless flexibleStart is enabled": "The exam window is shorter than the duration. Extend the window or reduce the duration.",
    "passMarks cannot exceed totalMarks": "Pass marks cannot be greater than total marks.",
    "Single-answer questions need exactly 1 correct option": "Choose exactly one correct answer.",
    "Multiple-select questions need at least 1 correct option": "Choose at least one correct answer.",
    "Option text must be unique": "Each answer option must be different.",
    "Invalid date": "Enter a valid date and time.",
    "Invalid id": "Choose a valid item.",
    "Required": "This field is required.",
  };
  if (known[issue]) return known[issue];
  if (/^Must be at least (\d+) characters$/.test(issue)) return `Enter at least ${issue.match(/\d+/)?.[0]} characters.`;
  if (/^Must be at most (\d+) characters$/.test(issue)) return `Use no more than ${issue.match(/\d+/)?.[0]} characters.`;
  if (/^Number must be greater than 0$/.test(issue)) return "Enter a value greater than 0.";
  if (/^Number must be less than or equal to (.+)$/.test(issue)) return `Enter a value no greater than ${issue.split(" ").at(-1)}.`;
  const arrayBound = /Too (big|small): expected array to have (<=|>=)(\d+) items?/.exec(issue);
  if (arrayBound) return arrayBound[1] === "big" ? `Use no more than ${arrayBound[3]} items.` : `Provide at least ${arrayBound[3]} items.`;
  const stringBound = /Too (big|small): expected string to have (<=|>=)(\d+) characters?/.exec(issue);
  if (stringBound) return stringBound[1] === "big" ? `Use no more than ${stringBound[3]} characters.` : `Enter at least ${stringBound[3]} characters.`;
  const numberBound = /Too (big|small): expected number to be (<=|>=)(.+)/.exec(issue);
  if (numberBound) return numberBound[1] === "big" ? `Enter a value no greater than ${numberBound[3]}.` : `Enter a value of at least ${numberBound[3]}.`;
  if (/Invalid input: expected string/.test(issue)) return "Enter a value for this field.";
  if (/Invalid input: expected number/.test(issue)) return "Enter a valid number.";
  if (/Invalid input: expected array/.test(issue)) return "Provide the required items.";
  if (/Invalid input: expected/.test(issue)) return "Choose a valid option.";
  if (/Unrecognized key/.test(issue)) return "This form contains an unsupported field. Reload the page and try again.";
  return issue.replace(/^(title|stem|type|categoryId|difficulty|defaultMarks|options|rubric|startsAt|endsAt|durationMinutes|totalMarks|passMarks):\s*/i, "");
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const issues = getApiValidationIssues(error);
    if (issues.length) return `Please correct these fields: ${issues.map((item) => `${item.label}: ${item.message}`).join("; ")}`;
    if (error.message === "Request validation failed" || error.message === "Validation failed") {
      return "Some information needs attention. Review the form fields and try again.";
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
