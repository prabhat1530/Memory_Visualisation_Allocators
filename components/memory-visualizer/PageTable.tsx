'use client';

import type { PageTableEntry } from '@/types/memory';

interface PageTableProps {
  pageTable: PageTableEntry[];
}

export function PageTable({ pageTable }: PageTableProps) {
  if (pageTable.length === 0) {
    return (
      <section className="page-table-section">
        <h3>Page Table</h3>
        <p className="page-table-empty">No pages mapped yet.</p>
      </section>
    );
  }

  const sorted = [...pageTable].sort((a, b) =>
    a.processId !== b.processId ? a.processId - b.processId : a.pageIndex - b.pageIndex
  );

  return (
    <section className="page-table-section">
      <h3>Page Table</h3>
      <div className="page-table-wrapper">
        <table className="page-table">
          <thead>
            <tr>
              <th>Process</th>
              <th>Page</th>
              <th>Frame</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => (
              <tr key={`${entry.processId}-${entry.pageIndex}-${i}`}>
                <td>P{entry.processId}</td>
                <td>{entry.pageIndex}</td>
                <td>F{entry.frameIndex}</td>
                <td className="page-table-status--mapped">Mapped</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
