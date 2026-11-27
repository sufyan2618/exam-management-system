import sanitizeHtml from "sanitize-html";

/** Stored text is Markdown. Any HTML is stripped entirely (allow-list is empty). */
export function sanitizeMarkdown(input: string) {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: "discard" })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">") // keep markdown blockquotes
    .replace(/&amp;/g, "&")
    .trim();
}

export function normalizeText(input: string) {
  return input.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** Neutralise spreadsheet formula injection for exported cells. */
export function csvSafe(value: unknown) {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvSafe).join(",")).join("\r\n") + "\r\n";

export function maskName(fullName: string) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (p.length <= 1 ? p : p[0] + "*".repeat(Math.min(p.length - 1, 5))))
    .join(" ");
}

export function maskEmail(email: string) {
  const [u = "", d = ""] = email.split("@");
  return `${u.slice(0, 1)}***@${d}`;
}
