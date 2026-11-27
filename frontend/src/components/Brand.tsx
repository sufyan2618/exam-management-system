import { Link } from "react-router-dom";

export function InfinityMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-4 -2 56 32" fill="none" aria-hidden="true">
      <path d="M24 14C17 3 14 3 10 3a11 11 0 0 0 0 22c5 0 8-3 14-11S34 3 38 3a11 11 0 0 1 0 22c-5 0-8-3-14-11Z" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Infinity home">
      <InfinityMark />
      <span>infinity<span className="brand-period">.</span></span>
    </Link>
  );
}
