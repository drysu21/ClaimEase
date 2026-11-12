'use client';

export default function ErrorScreen({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page">
      <div className="empty-block" role="alert">
        <h1>Something went wrong</h1>
        <p>We could not load this screen. Nothing you submitted was lost.</p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
