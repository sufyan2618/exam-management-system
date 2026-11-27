import type { ReactNode } from "react";

type AuthLayoutProps = {
  title: string; subtitle: string; animationSrc?: string;
  animationSegment?: readonly [number, number]; children: ReactNode; footer: ReactNode;
};
export function AuthLayout({title,subtitle,children,footer}: AuthLayoutProps) {
  return <main className="auth-screen paper-auth" id="main-content">
    <section className="auth-art" aria-label="Secure Examination Management">
      <a className="product-brand" href="/">Secure Examination<span aria-hidden="true">.</span></a>
      <div className="auth-art-copy"><p className="art-eyebrow">PREPARE · PARTICIPATE · PROGRESS</p><h2>A fair chance.<br/><em>A clear result.</em></h2><p>Your examinations, answers and achievements, in one dependable workspace.</p></div>
      <p className="auth-paper-footer">SECURE EXAMINATION MANAGEMENT / PAPER & INK</p>
    </section>
    <section className="auth-panel"><div className="auth-card"><header className="form-heading"><p className="eyebrow">YOUR EXAMINATION WORKSPACE</p><h1>{title}</h1><p>{subtitle}</p></header>{children}<div className="auth-footer">{footer}</div></div></section>
  </main>;
}
