/**
 * Shown the moment a tab or link is tapped while the server renders the next page
 * (every page is dynamic). Server component, no data, no client JS. Real content
 * replaces it as soon as it streams in.
 */
export default function HouseLoading() {
  const block = "rounded-md bg-surface-muted motion-safe:animate-pulse";
  return (
    <div data-loading-skeleton="" role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className={`h-8 w-40 ${block}`} />
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden="true" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className={`h-5 w-1/3 ${block}`} />
          <div className={`h-4 w-full ${block}`} />
          <div className={`h-4 w-2/3 ${block}`} />
        </div>
      ))}
    </div>
  );
}
