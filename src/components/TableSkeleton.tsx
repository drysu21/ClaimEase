/** Loading state shaped like the table that is coming. */
export function TableSkeleton({ title }: { title: string }) {
  return (
    <div className="page" aria-busy="true">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">Loading</p>
        </div>
      </div>
      <div className="skeleton-tabs skeleton" />
      <div className="table-wrap" role="status" aria-label={`Loading ${title}`}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="skeleton-row">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
