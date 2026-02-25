'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { StrategyType, CompactionMode, PageTableEntry } from '@/types/memory';
import { useMemorySimulation } from './useMemorySimulation';
import { useBuddySimulation } from './useBuddySimulation';
import { usePagingSimulation } from './usePagingSimulation';
import { STRATEGY_DEFAULTS } from '@/lib/constants';

export function useSimulation(showToast: (msg: string) => void) {
  const [activeStrategy, setActiveStrategy] = useState<StrategyType>('first-fit');
  const [pageSizeStr, setPageSizeStr] = useState(
    String(STRATEGY_DEFAULTS['paging-fifo'].pageSize ?? 64)
  );
  const prevStrategyRef = useRef<StrategyType>(activeStrategy);

  const contiguous = useMemorySimulation(showToast);
  const buddy = useBuddySimulation(showToast);
  const pagingFifo = usePagingSimulation(showToast, 'paging-fifo');
  const pagingLru = usePagingSimulation(showToast, 'paging-lru');

  const isContiguous =
    activeStrategy === 'first-fit' ||
    activeStrategy === 'best-fit' ||
    activeStrategy === 'worst-fit';
  const isBuddy = activeStrategy === 'buddy';
  const isPagingFifo = activeStrategy === 'paging-fifo';
  const isPagingLru = activeStrategy === 'paging-lru';

  const active = isContiguous
    ? contiguous
    : isBuddy
    ? buddy
    : isPagingFifo
    ? pagingFifo
    : pagingLru;

  useEffect(() => {
    if (prevStrategyRef.current !== activeStrategy) {
      prevStrategyRef.current = activeStrategy;
      const defaults = STRATEGY_DEFAULTS[activeStrategy];

      if (
        activeStrategy === 'first-fit' ||
        activeStrategy === 'best-fit' ||
        activeStrategy === 'worst-fit'
      ) {
        contiguous.setAlgorithm(activeStrategy);
        contiguous.resetSimulation({
          totalMemory: defaults.totalMemory,
          memoryBlocksStr: defaults.memoryBlocks,
          processSizesStr: defaults.processSizes,
        });
      } else if (activeStrategy === 'buddy') {
        buddy.resetSimulation({
          totalMemory: defaults.totalMemory,
          processSizesStr: defaults.processSizes,
        });
      } else if (activeStrategy === 'paging-fifo') {
        if (defaults.pageSize) setPageSizeStr(String(defaults.pageSize));
        pagingFifo.resetSimulation({
          totalMemory: defaults.totalMemory,
          processSizesStr: defaults.processSizes,
          pageSize: defaults.pageSize,
        });
      } else if (activeStrategy === 'paging-lru') {
        if (defaults.pageSize) setPageSizeStr(String(defaults.pageSize));
        pagingLru.resetSimulation({
          totalMemory: defaults.totalMemory,
          processSizesStr: defaults.processSizes,
          pageSize: defaults.pageSize,
        });
      }
    }
  }, [activeStrategy, contiguous, buddy, pagingFifo, pagingLru]);

  const setAlgorithm = useCallback(
    (val: StrategyType) => {
      setActiveStrategy(val);
    },
    []
  );

  const onPageSizeChange = useCallback(
    (val: string) => {
      setPageSizeStr(val);
      const num = parseInt(val, 10);
      if (!isNaN(num) && num > 0) {
        if (isPagingFifo) pagingFifo.setPageSize(num);
        if (isPagingLru) pagingLru.setPageSize(num);
      }
      active.markConfigDirty();
    },
    [isPagingFifo, isPagingLru, pagingFifo, pagingLru, active]
  );

  const pageTable: PageTableEntry[] = isPagingFifo
    ? pagingFifo.pageTable
    : isPagingLru
    ? pagingLru.pageTable
    : [];

  return {
    memoryBlocks: active.memoryBlocks,
    processQueue: active.processQueue,
    status: active.status,
    algorithm: activeStrategy,
    totalMemory: active.totalMemory,
    memoryBlocksStr: active.memoryBlocksStr,
    processSizesStr: active.processSizesStr,
    compactionMode: active.compactionMode,
    pageSizeStr,
    pageTable,
    setTotalMemory: active.setTotalMemory,
    setMemoryBlocksStr: active.setMemoryBlocksStr,
    setProcessSizesStr: active.setProcessSizesStr,
    setAlgorithm,
    setCompactionMode: active.setCompactionMode,
    onPageSizeChange,
    markConfigDirty: active.markConfigDirty,
    configDirty: active.configDirty,
    isAutoRunning: active.isAutoRunning,
    isPaused: active.isPaused,
    stopButtonLabel: active.stopButtonLabel,
    stopButtonVariant: active.stopButtonVariant,
    stats: active.stats,
    resetSimulation: active.resetSimulation,
    stepSimulation: active.stepSimulation,
    compactMemory: active.compactMemory,
    toggleAutoRun: active.toggleAutoRun,
    togglePause: active.togglePause,
    handleDeallocateBlock: active.handleDeallocateBlock,
    isRetrying: active.isRetrying,
    autoRunButtonLabel: active.autoRunButtonLabel,
  };
}
