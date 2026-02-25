'use client';

import { useCallback } from 'react';
import { AppLayout } from '@/components/memory-visualizer';
import { useToast } from '@/hooks/useToast';
import { useSimulation } from '@/hooks/useSimulation';
import type { StrategyType, CompactionMode } from '@/types/memory';

export default function HomePage() {
  const { toasts, showToast, dismissToast } = useToast(4500);
  const sim = useSimulation(showToast);

  const onTotalMemoryChange = useCallback((v: number) => sim.setTotalMemory(v), [sim]);
  const onMemoryBlocksStrChange = useCallback((v: string) => sim.setMemoryBlocksStr(v), [sim]);
  const onProcessSizesStrChange = useCallback((v: string) => sim.setProcessSizesStr(v), [sim]);
  const onAlgorithmChange = useCallback((v: StrategyType) => sim.setAlgorithm(v), [sim]);
  const onCompactionModeChange = useCallback((v: CompactionMode) => sim.setCompactionMode(v), [sim]);
  const onPageSizeChange = useCallback((v: string) => sim.onPageSizeChange(v), [sim]);

  return (
    <AppLayout
      totalMemory={sim.totalMemory}
      memoryBlocksStr={sim.memoryBlocksStr}
      processSizesStr={sim.processSizesStr}
      algorithm={sim.algorithm}
      compactionMode={sim.compactionMode}
      pageSizeStr={sim.pageSizeStr}
      pageTable={sim.pageTable}
      memoryBlocks={sim.memoryBlocks}
      processQueue={sim.processQueue}
      status={sim.status}
      stopButtonLabel={sim.stopButtonLabel}
      stopButtonVariant={sim.stopButtonVariant}
      stats={sim.stats}
      toasts={toasts}
      onTotalMemoryChange={onTotalMemoryChange}
      onMemoryBlocksStrChange={onMemoryBlocksStrChange}
      onProcessSizesStrChange={onProcessSizesStrChange}
      onAlgorithmChange={onAlgorithmChange}
      onCompactionModeChange={onCompactionModeChange}
      onPageSizeChange={onPageSizeChange}
      onMarkConfigDirty={sim.markConfigDirty}
      onReset={sim.resetSimulation}
      onCompact={sim.compactMemory}
      onStopClick={sim.togglePause}
      onAutoRunClick={sim.toggleAutoRun}
      onDeallocateBlock={sim.handleDeallocateBlock}
      dismissToast={dismissToast}
      autoRunButtonLabel={sim.autoRunButtonLabel}
    />
  );
}
