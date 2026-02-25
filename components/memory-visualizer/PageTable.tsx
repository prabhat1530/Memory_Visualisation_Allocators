'use client';

import type { PageTableEntry } from '@/types/memory';
import type { StrategyType } from '@/types/memory';

interface PageTableProps {
  pageTable: PageTableEntry[];
  strategy?: StrategyType;
  totalFrames?: number;
}

export function PageTable({ pageTable, strategy, totalFrames }: PageTableProps) {
  if (pageTable.length === 0) {
    return (
      <section className="page-table-section">
        <h3>Page Table</h3>
        <p className="page-table-empty">No pages mapped yet.</p>
      </section>
    );
  }

  const isFIFO = strategy === 'paging-fifo';
  const allFramesFull = totalFrames != null && pageTable.length >= totalFrames;

  const sorted = [...pageTable].sort((a, b) =>
    a.processId !== b.processId ? a.processId - b.processId : a.pageIndex - b.pageIndex
  );

  const byLoad = [...pageTable].sort((a, b) => a.loadedAt - b.loadedAt);
  const byAccess = [...pageTable].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  const oldestLoadedAt = byLoad[0]?.loadedAt;
  const lruAccessedAt = byAccess[0]?.lastAccessedAt;

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
              <th>{isFIFO ? 'Load Order' : 'Last Access'}</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => {
              const isEvictCandidate = allFramesFull && (isFIFO
                ? entry.loadedAt === oldestLoadedAt
                : entry.lastAccessedAt === lruAccessedAt);

              const orderByLoad = byLoad.findIndex(
                (e) => e.processId === entry.processId && e.pageIndex === entry.pageIndex && e.frameIndex === entry.frameIndex
              ) + 1;

              const orderByAccess = byAccess.findIndex(
                (e) => e.processId === entry.processId && e.pageIndex === entry.pageIndex && e.frameIndex === entry.frameIndex
              ) + 1;

              return (
                <tr
                  key={`${entry.processId}-${entry.pageIndex}-${i}`}
                  className={isEvictCandidate ? 'page-table-evict-candidate' : ''}
                >
                  <td>P{entry.processId}</td>
                  <td>{entry.pageIndex}</td>
                  <td>F{entry.frameIndex}</td>
                  <td className="page-table-order">
                    {isFIFO ? `#${orderByLoad}` : `#${orderByAccess}`}
                  </td>
                  <td>
                    <span className={`page-table-status ${isEvictCandidate ? 'page-table-status--evict' : 'page-table-status--mapped'}`}>
                      {isEvictCandidate ? 'Next Evict' : 'Mapped'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
