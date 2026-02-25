'use client';

import { useCallback } from 'react';
import { toHex } from '@/lib/memory-utils';
import type { MemoryBlock as MemoryBlockType } from '@/types/memory';
import type { Process } from '@/types/memory';

interface MemoryBlockProps {
  block: MemoryBlockType;
  address: number;
  widthPct: number;
  process?: Process | null;
  onDeallocate?: () => void;
}

export function MemoryBlockComponent({
  block,
  address,
  widthPct,
  process: processInfo,
  onDeallocate,
}: MemoryBlockProps) {
  const typeClass = block.isAllocated ? 'allocated' : 'free';
  const fragmentClass =
    !block.isAllocated && block.size < 50 ? ' fragment' : '';
  const deallocatingClass = block.isDeallocating ? ' deallocating' : '';
  const animNewClass = block.isNew ? ' anim-new' : '';

  const hasPartialPage =
    block.isAllocated &&
    block.requestedSize != null &&
    block.requestedSize < block.size;

  const partialClass = hasPartialPage ? ' partial-page' : '';
  const className = `block-2d ${typeClass}${fragmentClass}${deallocatingClass}${animNewClass}${partialClass}`;

  const waste = hasPartialPage ? block.size - block.requestedSize! : 0;
  const usedPct = hasPartialPage
    ? Math.round((block.requestedSize! / block.size) * 100)
    : 100;

  let tooltip = `Status: ${block.isAllocated ? 'Allocated' : 'Free'}\nAddress: ${toHex(address)} - ${toHex(address + block.size - 1)}\nSize: ${block.size}KB`;
  if (hasPartialPage) {
    tooltip += `\nUsed: ${block.requestedSize}KB / ${block.size}KB\nInternal Fragmentation: ${waste}KB wasted`;
  }
  if (block.isAllocated && processInfo?.allocatedAt) {
    const elapsed = Date.now() - processInfo.allocatedAt;
    const remaining = Math.max(0, processInfo.lifetime - elapsed);
    const remainingSec = (remaining / 1000).toFixed(1);
    tooltip += `\nProcess P${block.processId} running...\nTime remaining: ${remainingSec}s`;
  }
  if (block.isAllocated) tooltip += '\n(Click to manually deallocate)';

  const handleClick = useCallback(() => {
    if (block.isAllocated && onDeallocate) onDeallocate();
  }, [block.isAllocated, onDeallocate]);

  const label = block.isAllocated ? `P-${block.processId}` : `${block.size}KB`;
  const subLabel = block.isAllocated
    ? hasPartialPage
      ? `${block.requestedSize}/${block.size}KB`
      : `${block.size}KB`
    : 'Free';

  const inlineStyle: React.CSSProperties = {
    width: `calc(${widthPct}% - 4px)`,
  };

  if (hasPartialPage) {
    inlineStyle.background = `linear-gradient(to right, var(--primary-blue) ${usedPct}%, var(--accent-purple) ${usedPct}%)`;
  }

  return (
    <div
      className={className}
      style={inlineStyle}
      title={tooltip}
      onClick={handleClick}
      role={block.isAllocated ? 'button' : undefined}
      tabIndex={block.isAllocated ? 0 : undefined}
      onKeyDown={(e) => {
        if (block.isAllocated && onDeallocate && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onDeallocate();
        }
      }}
    >
      <span>{label}</span>
      <small>{subLabel}</small>
    </div>
  );
}
