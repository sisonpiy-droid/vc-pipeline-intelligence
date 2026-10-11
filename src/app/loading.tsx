/** Route-level skeleton shown while any page's data loads. Mirrors the real layout so nothing jumps. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <div className="skeleton h-3 w-20" />
          <div className="skeleton mt-4 h-10 w-full max-w-md" />
          <div className="skeleton mt-3 h-10 w-2/3 max-w-xs" />
          <div className="skeleton mt-5 h-4 w-full max-w-sm" />
        </div>
        <div className="divide-y divide-line border-y border-line">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="flex items-center justify-between py-4">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-7 w-10" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-14 space-y-4">
        {[0, 1, 2].map((n) => (
          <div key={n} className="flex gap-6 rounded-2xl border border-line bg-surface p-6">
            <div className="skeleton h-12 w-14 shrink-0" />
            <div className="flex-1 space-y-3">
              <div className="skeleton h-5 w-1/3" />
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading data…</span>
    </div>
  );
}
