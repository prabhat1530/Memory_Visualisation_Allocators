'use client';

import type { Process } from '@/types/memory';

interface ProcessQueueBlockProps {
  process: Process;
  totalFreeKB: number;
}

export function ProcessQueueBlock({ process, totalFreeKB }: ProcessQueueBlockProps) {
  const isAllocated = process.status === 'allocated';
  const isTerminated = process.status === 'terminated';
  const isFailed = process.status === 'failed';

  let className = 'queue-block';
  let style: React.CSSProperties = {};
  let title = `Process P${process.id} waiting for allocation...`;

  if (isAllocated) {
    className += ' allocated-process';
    style = {
      background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
      opacity: 0.9,
      position: 'relative',
      overflow: 'hidden',
    };
    if (process.allocatedAt != null) {
      const elapsed = Date.now() - process.allocatedAt;
      const progress = Math.min(100, (elapsed / process.lifetime) * 100);
      const remaining = Math.max(0, process.lifetime - elapsed);
      const remainingSec = (remaining / 1000).toFixed(1);
      title = `Process P${process.id} running...\nTime remaining: ${remainingSec}s\n(Will auto-deallocate when complete)`;
      const progressBarStyle: React.CSSProperties = {
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: `${progress}%`,
        height: '3px',
        background: 'rgba(255, 255, 255, 0.6)',
        transition: 'width 0.2s',
        zIndex: 1,
      };
      return (
        <div className={className} style={style} title={title}>
          <div style={progressBarStyle} aria-hidden />
          <span style={{ position: 'relative', zIndex: 2 }}>P{process.id}</span>
          <small style={{ position: 'relative', zIndex: 2 }}>{process.size}KB</small>
        </div>
      );
    }
  } else if (isTerminated) {
    className += ' terminated-process';
    style = {
      background: 'linear-gradient(135deg, #64748B, #475569)',
      opacity: 0.6,
    };
    title = `Process P${process.id} terminated. Waiting to be re-allocated...`;
  } else if (isFailed) {
    className += ' failed-process';
    style = {
      background: 'linear-gradient(135deg, #EF4444, #B91C1C)',
      animation: 'pulse-failed 2s ease-in-out infinite',
    };
    title = `Process P${process.id} blocked - waiting for memory.\nRequired: ${process.size} KB\nFree memory: ${totalFreeKB} KB\nWill retry automatically when memory becomes available.`;
  }

  return (
    <div className={className} style={style} title={title}>
      <span>P{process.id}</span>
      <small>{process.size}KB</small>
    </div>
  );
}
