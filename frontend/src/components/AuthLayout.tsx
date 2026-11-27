import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { Brand, InfinityMark } from "./Brand";

const LottiePlayer = lazy(() => import("./LottiePlayer").then((module) => ({
  default: module.LottiePlayer,
})));

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  animationSrc: string;
  animationSegment?: readonly [number, number];
  children: ReactNode;
  footer: ReactNode;
};

export function AuthLayout({
  title,
  subtitle,
  animationSrc,
  animationSegment,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <main className="auth-screen" id="main-content" tabIndex={-1}>
      <section className="auth-art" aria-label="Welcome to Infinity">
        <Brand />
        <div className="auth-animation-stage">
          <div className="animation-halo" aria-hidden="true" />
          <Suspense fallback={<div className="auth-lottie" aria-hidden="true"><div className="lottie-canvas" /></div>}>
            <LottiePlayer
              key={animationSrc}
              className="auth-lottie"
              src={animationSrc}
              segment={animationSegment}
            />
          </Suspense>
        </div>
        <div className="auth-art-copy">
          <p className="art-eyebrow">YOUR SPACE. YOUR POSSIBILITIES.</p>
          <h2>A fresh start.<br /><em>Endless possibility.</em></h2>
          <p>Whatever comes next, make it yours.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="form-symbol" aria-hidden="true"><InfinityMark /></div>
          <header className="form-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </header>
          {children}
          <div className="auth-footer">{footer}</div>
        </div>
      </section>
    </main>
  );
}
