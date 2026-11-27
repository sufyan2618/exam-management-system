import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";

export function StatusPage({ code, title, message, primaryLabel = "Back to dashboard", primaryTo = "/dashboard" }: {
  code: "403" | "404"; title: string; message: string; primaryLabel?: string; primaryTo?: string;
}) {
  return <main id="main-content" className="status-page">
    <section className="status-card" aria-labelledby="status-title">
      <Brand />
      <div className="status-code" aria-hidden="true">{code}</div>
      <p className="eyebrow">{code === "403" ? "ACCESS CONTROL" : "PAGE NOT FOUND"}</p>
      <h1 id="status-title">{title}</h1>
      <p className="status-message">{message}</p>
      <div className="status-actions">
        <Link className="button button-primary" to={primaryTo}>{primaryLabel}</Link>
        <button className="button" onClick={() => window.history.back()}>Go back</button>
      </div>
      <p className="status-footnote">Verity · Secure Examination</p>
    </section>
  </main>;
}
