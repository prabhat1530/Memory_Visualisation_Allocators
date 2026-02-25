'use client';

import type { SimulationStats, StrategyType } from '@/types/memory';

interface SystemMonitorProps {
  stats: SimulationStats;
  strategy: StrategyType;
}

export function SystemMonitor({ stats, strategy }: SystemMonitorProps) {
  const isPaging = strategy === 'paging-fifo' || strategy === 'paging-lru';

  return (
    <section className="monitor-section">
      <h3>System Monitor</h3>
      <div className="monitor-grid">
        <div className="monitor-card">
          <span className="m-label">Memory Utilization</span>
          <div className="m-value">{stats.utilizationPct}%</div>
        </div>
        <div className="monitor-card">
          <span className="m-label">Internal Fragmentation</span>
          <div className="m-value">{stats.internalFragmentation} KB</div>
        </div>
        <div className="monitor-card">
          <span className="m-label">External Fragmentation</span>
          <div className="m-value">{stats.externalFragmentation} KB</div>
        </div>
        <div className="monitor-card">
          <span className="m-label">Largest Free Block</span>
          <div className="m-value">{stats.largestFreeBlock} KB</div>
        </div>
        <div className="monitor-card">
          <span className="m-label">Allocation Failures</span>
          <div className="m-value">{stats.allocationFailures}</div>
        </div>
        <div className="monitor-card">
          <span className="m-label">Processes</span>
          <div className="m-value">{stats.processesText}</div>
        </div>
        {isPaging && stats.pageFaults != null && (
          <div className="monitor-card">
            <span className="m-label">Page Faults</span>
            <div className="m-value">{stats.pageFaults}</div>
          </div>
        )}
        {isPaging && stats.isThrashing && (
          <div className="monitor-card monitor-card--danger">
            <span className="m-label">Warning</span>
            <div className="m-value m-value--danger">Thrashing Detected</div>
          </div>
        )}
        {stats.compactionCount > 0 && (
          <div className="monitor-card">
            <span className="m-label">Compactions</span>
            <div className="m-value">{stats.compactionCount}</div>
          </div>
        )}
      </div>
    </section>
  );
}
