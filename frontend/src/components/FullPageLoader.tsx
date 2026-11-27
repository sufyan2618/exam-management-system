type FullPageLoaderProps = {
  message?: string;
};

export function FullPageLoader({ message = "Loading your account..." }: FullPageLoaderProps) {
  return (
    <div className="loader-screen" id="main-content" role="status" aria-live="polite" tabIndex={-1}>
      <span className="loader-spinner" />
      <p>{message}</p>
    </div>
  );
}
