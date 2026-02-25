'use client';

import { useMemo } from 'react';
import { MEMORY_OFFSET } from '@/lib/constants';
import { MemoryBlockComponent } from './MemoryBlock';
import type { MemoryBlock as MemoryBlockType } from '@/types/memory';
import type { Process } from '@/types/memory';

interface MemoryMapProps {
  memoryBlocks: MemoryBlockType[];
  processQueue: Process[];
  onDeallocateBlock: (blockIndex: number) => void;
}

export function MemoryMap({
  memoryBlocks,
  processQueue,
  onDeallocateBlock,
}: MemoryMapProps) {
  const totalSize = useMemo(
    () => memoryBlocks.reduce((acc, b) => acc + b.size, 0),
    [memoryBlocks]
  );

  let currentAddr = MEMORY_OFFSET;

  return (
    <div className="memory-container-2d">
      <div className="memory-track-2d">
        {memoryBlocks.map((block, index) => {
          if (!block) return null;
          const addr = currentAddr;
          currentAddr += block.size;
          const widthPct = totalSize > 0 ? (block.size / totalSize) * 100 : 0;
          const process = block.processId
            ? processQueue.find((p) => p.id === block.processId)
            : null;
          return (
            <MemoryBlockComponent
              key={`${index}-${block.address}-${block.size}-${block.isAllocated ? block.processId : 'f'}`}
              block={block}
              address={addr}
              widthPct={widthPct}
              process={process ?? null}
              onDeallocate={
                block.isAllocated
                  ? () => onDeallocateBlock(index)
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}
