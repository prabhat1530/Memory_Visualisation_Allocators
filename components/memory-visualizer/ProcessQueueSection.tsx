'use client';

import { ProcessQueueBlock } from './ProcessQueueBlock';
import type { Process } from '@/types/memory';
import type { MemoryBlock } from '@/types/memory';

interface ProcessQueueSectionProps {
  processQueue: Process[];
  memoryBlocks: MemoryBlock[];
}

export function ProcessQueueSection({
  processQueue,
  memoryBlocks,
}: ProcessQueueSectionProps) {
  const activeProcesses = processQueue.filter((p) => p.status !== 'completed');
  const totalFreeKB = memoryBlocks
    .filter((b) => !b.isAllocated)
    .reduce((sum, b) => sum + b.size, 0);

  return (
    <section className="queue-section">
      <h3>Process Scheduling Queue</h3>
      <div className="queue-container">
        {activeProcesses.map((p) => (
          <ProcessQueueBlock
            key={p.id}
            process={p}
            totalFreeKB={totalFreeKB}
          />
        ))}
      </div>
    </section>
  );
}
