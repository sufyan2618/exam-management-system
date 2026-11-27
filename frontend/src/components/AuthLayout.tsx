import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Logo } from "./Brand";
const LottiePlayer = lazy(() => import("./LottiePlayer").then((module) => ({ default: module.LottiePlayer })));
import defaultAnimation from "../animations/login.json?url";

type AuthLayoutProps = {
  title: string; subtitle: string; animationSrc?: string;
  animationSegment?: readonly [number, number]; children: ReactNode; footer: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer, animationSrc = defaultAnimation, animationSegment }: AuthLayoutProps) {
  return (
    <main className="auth-screen auth-refined" id="main-content">
      <section className="auth-art" aria-label="Secure Examination Management">
        <a className="auth-brand verity-brand" href="/" aria-label="Verity home"><Logo variant="light" /></a>
        <div className="auth-art-copy">
          <p className="art-eyebrow">Prepare · Participate · Progress</p>
          <h2>A fair chance.<br /><em>A clear result.</em></h2>
          <p>Your examinations, answers and achievements, in one dependable workspace.</p>
        </div>
        <div className="auth-animation-stage">
          <Suspense fallback={<div className="auth-motion-placeholder" aria-hidden="true" />}><LottiePlayer key={animationSrc} src={animationSrc} segment={animationSegment} className="auth-lottie" /></Suspense>
        </div>
        <p className="auth-paper-footer">Verity · Secure Examination</p>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-inner">
          <p className="auth-context">Secure access <span aria-hidden="true">/</span> Examination workspace</p>
          <header className="form-heading">
            <p className="eyebrow">Your examination workspace</p>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </header>
          <div className="auth-card">{children}</div>
          <div className="auth-footer">{footer}</div>
        </div>
      </section>
    </main>
  );
}
