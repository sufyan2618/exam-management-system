import { Link } from "react-router-dom";

export function Logo({ className = "", variant = "auto" }: { className?: string; variant?: "auto" | "light" }) {
  return <span className={"verity-logo-pair " + (variant === "light" ? "verity-logo-on-dark " : "") + className}>
    <img className="verity-logo verity-logo-dark" src="/verity-logo-dark.svg" alt="Verity · Secure Examination" width="420" height="112" />
    <img className="verity-logo verity-logo-light" src="/verity-logo-light.svg" alt="Verity · Secure Examination" width="420" height="112" />
  </span>;
}

export function Brand() {
  return <Link className="brand verity-brand" to="/" aria-label="Verity home"><Logo /></Link>;
}
