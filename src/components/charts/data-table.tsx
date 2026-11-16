/** The text alternative every chart carries: the same numbers as a plain table behind a disclosure. */
export function DataTable({
  caption,
  columns,
  rows,
  summary = "View as table",
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
  summary?: string;
}) {
  return (
    <details className="text-sm">
      <summary className="flex h-11 w-fit cursor-pointer items-center text-muted-foreground underline decoration-gilt decoration-2 underline-offset-4 hover:text-foreground">{summary}</summary>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-xs text-muted-foreground">
              {columns.map((c, i) => (
                <th key={c} scope="col" className={i === 0 ? "py-1 pr-4 font-medium" : "px-2 py-1 text-right font-medium"}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {r.map((cell, j) => (j === 0 ? (
                  <th key={j} scope="row" className="py-1 pr-4 font-normal">
                    {cell}
                  </th>
                ) : (
                  <td key={j} className="px-2 py-1 text-right tabular-nums">
                    {cell}
                  </td>
                )))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
