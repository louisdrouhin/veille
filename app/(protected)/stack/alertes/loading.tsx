/** Loading state of Alertes (docs/design/3.0 § 6): card skeletons. */
export default function Loading() {
  const bar = "animate-pulse-soft rounded-sm bg-surface-alt motion-reduce:animate-none";
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className={`h-11 md:w-60 ${bar}`} />
      <ul className="grid gap-2 md:w-[440px]">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="grid gap-2 rounded-md border border-line bg-surface p-3">
            <span className={`h-[22px] w-24 ${bar}`} />
            <span className={`h-4 w-4/5 ${bar}`} />
            <span className={`h-3 w-3/5 ${bar}`} />
          </li>
        ))}
      </ul>
      <span className="sr-only" role="status">
        Chargement des alertes…
      </span>
    </div>
  );
}
