'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StrategyType, CompactionMode, MemoryBlock, Process, SimulationStats } from '@/types/memory';
import {
  DEALLOCATE_ANIMATION_MS,
  DEALLOCATION_CHECK_INTERVAL_MS,
  MEMORY_OFFSET,
  PROCESS_LIFETIME_MS,
  AUTO_RUN_INTERVAL_MS,
} from '@/lib/constants';
import { toHex, parseInputList } from '@/lib/memory-utils';

function createMemoryBlock(
  size: number,
  isAllocated = false,
  processId: number | null = null
): MemoryBlock {
  return { size, isAllocated, processId, address: 0 };
}

function createProcess(id: number, size: number): Process {
  return {
    id,
    size,
    status: 'waiting',
    allocatedAt: null,
    lifetime: PROCESS_LIFETIME_MS,
  };
}

function mergeAdjacentFreeBlocksInPlace(blocks: MemoryBlock[]): void {
  let i = 0;
  while (i < blocks.length - 1) {
    const current = blocks[i];
    const next = blocks[i + 1];
    if (!current || !next) { i++; continue; }
    if (!current.isAllocated && !next.isAllocated) {
      current.size += next.size;
      current.isNew = true;
      blocks.splice(i + 1, 1);
    } else {
      i++;
    }
  }
}

function findBlockForProcess(
  blocks: MemoryBlock[],
  processSize: number,
  algo: StrategyType
): number {
  let blockIndex = -1;
  if (algo === 'first-fit') {
    blockIndex = blocks.findIndex((b) => b && !b.isAllocated && b.size >= processSize);
  } else if (algo === 'best-fit') {
    let bestDiff = Infinity;
    blocks.forEach((b, idx) => {
      if (b && !b.isAllocated && b.size >= processSize) {
        const diff = b.size - processSize;
        if (diff < bestDiff) { bestDiff = diff; blockIndex = idx; }
      }
    });
  } else if (algo === 'worst-fit') {
    let maxDiff = -1;
    blocks.forEach((b, idx) => {
      if (b && !b.isAllocated && b.size >= processSize) {
        const diff = b.size - processSize;
        if (diff > maxDiff) { maxDiff = diff; blockIndex = idx; }
      }
    });
  }
  return blockIndex;
}

function compactBlocksInPlace(blocks: MemoryBlock[]): MemoryBlock[] {
  const allocated = blocks.filter((b) => b.isAllocated);
  const freeBlocks = blocks.filter((b) => !b.isAllocated);
  const totalFreeSize = freeBlocks.reduce((acc, b) => acc + b.size, 0);
  const newMap: MemoryBlock[] = allocated.map((b) => ({ ...b, isNew: true }));
  if (totalFreeSize > 0) {
    const freeBlock = createMemoryBlock(totalFreeSize);
    freeBlock.isNew = true;
    newMap.push(freeBlock);
  }
  return newMap;
}

export function useMemorySimulation(showToast: (msg: string) => void) {
  const [memoryBlocks, setMemoryBlocks] = useState<MemoryBlock[]>([]);
  const [processQueue, setProcessQueue] = useState<Process[]>([]);
  const [status, setStatus] = useState('System Ready. Memory Initialized.');
  const [algorithm, setAlgorithmState] = useState<StrategyType>('first-fit');
  const [totalMemory, setTotalMemory] = useState(1024);
  const [memoryBlocksStr, setMemoryBlocksStr] = useState('200, 100, 300, 50, 150, 224');
  const [processSizesStr, setProcessSizesStr] = useState('120, 280, 45, 180, 90, 200');
  const [configDirty, setConfigDirty] = useState(false);
  const [resetAlertShown, setResetAlertShown] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [pauseStartTime, setPauseStartTime] = useState<number | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [stopButtonLabel, setStopButtonLabel] = useState<'Stop' | 'Continue'>('Stop');
  const [stopButtonVariant, setStopButtonVariant] = useState<'primary' | 'success'>('primary');
  const [compactionMode, setCompactionMode] = useState<CompactionMode>('manual');
  const [allocationFailures, setAllocationFailures] = useState(0);
  const [compactionCount, setCompactionCount] = useState(0);
  const initialMount = useRef(true);

  const autoRunIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deallocationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memoryBlocksRef = useRef<MemoryBlock[]>([]);
  const processQueueRef = useRef<Process[]>([]);
  const isPausedRef = useRef(false);
  const deallocateBlockRef = useRef<(index: number, auto: boolean) => void>(() => {});
  const retryFailedProcessesRef = useRef<() => void>(() => {});
  const allocateRef = useRef<(blockIndex: number, processIndex: number) => void>(() => {});
  const stepSimulationRef = useRef<() => void>(() => {});
  const algorithmRef = useRef<StrategyType>(algorithm);
  const compactionModeRef = useRef<CompactionMode>(compactionMode);

  memoryBlocksRef.current = memoryBlocks;
  processQueueRef.current = processQueue;
  isPausedRef.current = isPaused;
  algorithmRef.current = algorithm;
  compactionModeRef.current = compactionMode;

  const setAlgorithm = useCallback((val: StrategyType) => {
    setAlgorithmState(val);
    setConfigDirty(true);
    setResetAlertShown(false);
  }, []);

  const stopDeallocationChecker = useCallback(() => {
    if (deallocationIntervalRef.current) {
      clearInterval(deallocationIntervalRef.current);
      deallocationIntervalRef.current = null;
    }
  }, []);

  const startDeallocationChecker = useCallback(() => {
    stopDeallocationChecker();
    deallocationIntervalRef.current = setInterval(() => {
      if (isPausedRef.current) return;
      const blocks = memoryBlocksRef.current;
      const queue = processQueueRef.current;
      const now = Date.now();
      for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        if (!block || !block.isAllocated || !block.processId) continue;
        const process = queue.find((p) => p.id === block.processId);
        if (
          process &&
          process.allocatedAt != null &&
          process.status === 'allocated' &&
          process.elapsedBeforePause === undefined
        ) {
          const elapsed = now - process.allocatedAt;
          if (elapsed >= process.lifetime) {
            deallocateBlockRef.current(index, true);
            break;
          }
        }
      }
    }, DEALLOCATION_CHECK_INTERVAL_MS);
  }, [stopDeallocationChecker]);

  const deallocateBlock = useCallback(
    (blockIndex: number, isAutomatic: boolean) => {
      setMemoryBlocks((blocks) => {
        const block = blocks[blockIndex];
        if (!block || !block.isAllocated) return blocks;
        const processId = block.processId!;
        setProcessQueue((q) =>
          q.map((p) =>
            p.id === processId
              ? { ...p, status: 'terminated' as const, allocatedAt: null, blockIndex: undefined }
              : p
          )
        );
        setTimeout(() => {
          setMemoryBlocks((blocks) => {
            const next = blocks.map((b, i) =>
              i === blockIndex
                ? { ...b, isAllocated: false, processId: null, requestedSize: undefined, isDeallocating: false, isNew: true }
                : { ...b }
            );
            const merged = [...next];
            mergeAdjacentFreeBlocksInPlace(merged);
            return merged;
          });
          setProcessQueue((q) => {
            if (isAutomatic) {
              return q.map((p) => (p.id === processId ? { ...p, status: 'completed' as const } : p));
            }
            return q;
          });
          setStatus(
            isAutomatic
              ? `Process P${processId} completed execution and deallocated. Memory freed.`
              : `Process P${processId} deallocated. Memory freed (can be re-allocated).`
          );
          retryFailedProcessesRef.current();
        }, DEALLOCATE_ANIMATION_MS);
        return blocks.map((b, i) =>
          i === blockIndex ? { ...b, isDeallocating: true } : { ...b }
        );
      });
    },
    []
  );

  const retryFailedProcesses = useCallback(() => {
    if (isPausedRef.current || isRetrying) return;
    setIsRetrying(true);
    const blocks = memoryBlocksRef.current;
    const queue = processQueueRef.current;
    const algo = algorithmRef.current;
    const failed = queue.filter((p) => p.status === 'failed');
    if (failed.length === 0) { setIsRetrying(false); return; }
    const process = failed[0];
    const blockIndex = findBlockForProcess(blocks, process.size, algo);
    if (blockIndex === -1) { setIsRetrying(false); return; }
    const processIndex = queue.findIndex((p) => p.id === process.id);
    if (processIndex === -1) { setIsRetrying(false); return; }
    setStatus(`Memory available! Retrying Process P${process.id}...`);
    setProcessQueue((q) =>
      q.map((p) => (p.id === process.id ? { ...p, status: 'waiting' as const } : p))
    );
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    retryTimeoutRef.current = setTimeout(() => {
      allocateRef.current(blockIndex, processIndex);
      setIsRetrying(false);
      retryTimeoutRef.current = setTimeout(() => retryFailedProcesses(), 500);
    }, 300);
  }, [isRetrying]);

  retryFailedProcessesRef.current = retryFailedProcesses;

  const allocate = useCallback(
    (blockIndex: number, processIndex: number) => {
      const process = processQueueRef.current[processIndex];
      if (!process) return;
      setMemoryBlocks((blocks) => {
        const block = blocks[blockIndex];
        if (!block) return blocks;
        const next = [...blocks];
        if (block.size > process.size) {
          const newBlock = createMemoryBlock(block.size - process.size);
          next[blockIndex] = {
            ...block,
            size: process.size,
            isAllocated: true,
            processId: process.id,
            requestedSize: process.size,
            isNew: true,
          };
          next.splice(blockIndex + 1, 0, { ...newBlock, address: 0 });
        } else {
          next[blockIndex] = {
            ...block,
            isAllocated: true,
            processId: process.id,
            requestedSize: process.size,
            isNew: true,
          };
        }
        let addr = MEMORY_OFFSET;
        next.forEach((b) => { b.address = addr; addr += b.size; });
        return next;
      });
      setProcessQueue((q) =>
        q.map((p, i) =>
          i === processIndex
            ? { ...p, status: 'allocated' as const, allocatedAt: Date.now(), blockIndex }
            : p
        )
      );
      const block = memoryBlocksRef.current[blockIndex];
      setStatus(
        `Process P${process.id} allocated to memory block at ${toHex(block?.address ?? 0)}. Running...`
      );
    },
    []
  );

  const stepSimulation = useCallback(() => {
    if (configDirty && !resetAlertShown) {
      showToast('Configuration has changed. Please click Reset to apply changes before running.');
      setResetAlertShown(true);
      return;
    }

    const queue = processQueueRef.current;
    let processIndex = queue.findIndex((p) => p.status === 'waiting');
    if (processIndex === -1) {
      processIndex = queue.findIndex((p) => p.status === 'failed');
      if (processIndex !== -1) {
        const failedProcess = queue[processIndex];
        setProcessQueue((q) =>
          q.map((p, i) => (i === processIndex ? { ...p, status: 'waiting' as const } : p))
        );
        setStatus(`Retrying failed Process P${failedProcess.id} (${failedProcess.size} KB)...`);
      }
    }

    if (processIndex === -1) {
      const hasAllocated = queue.some((p) => p.status === 'allocated');
      const hasFailed = queue.some((p) => p.status === 'failed');
      if (hasAllocated) {
        setStatus(
          hasFailed
            ? 'All processes allocated. Some processes are blocked. Waiting for memory to free...'
            : 'All processes allocated. Waiting for processes to complete...'
        );
      } else if (hasFailed) {
        setStatus('All processes failed. Try Compact Memory or Reset.');
        setIsAutoRunning(false);
        if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
        stopDeallocationChecker();
      } else {
        setStatus('All processes completed.');
        setIsAutoRunning(false);
        if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
        stopDeallocationChecker();
      }
      return;
    }

    const process = queue[processIndex];
    setStatus(`Attempting to allocate Process P${process.id} (${process.size} KB)...`);

    processQueueRef.current = queue.map((p, i) =>
      i === processIndex
        ? { ...p, status: 'allocated' as const, allocatedAt: Date.now(), blockIndex: -1 }
        : p
    );

    const algo = algorithmRef.current;
    const cMode = compactionModeRef.current;

    setMemoryBlocks((blocks) => {
      let blockIndex = findBlockForProcess(blocks, process.size, algo);

      // Auto-compaction: if allocation fails and compaction mode is auto, compact and retry
      if (blockIndex === -1 && cMode === 'auto') {
        const compacted = compactBlocksInPlace(blocks);
        blockIndex = findBlockForProcess(compacted, process.size, algo);
        if (blockIndex !== -1) {
          setCompactionCount((c) => c + 1);
          setStatus(`Auto-compacted memory. Allocating Process P${process.id}...`);
          const block = compacted[blockIndex];
          if (!block) return blocks;
          const next = [...compacted];
          if (block.size > process.size) {
            const newBlock = createMemoryBlock(block.size - process.size);
            next[blockIndex] = {
              ...block, size: process.size, isAllocated: true,
              processId: process.id, requestedSize: process.size, isNew: true,
            };
            next.splice(blockIndex + 1, 0, { ...newBlock, address: 0 });
          } else {
            next[blockIndex] = {
              ...block, isAllocated: true,
              processId: process.id, requestedSize: process.size, isNew: true,
            };
          }
          setProcessQueue((q) =>
            q.map((p, i) =>
              i === processIndex
                ? { ...p, status: 'allocated' as const, allocatedAt: Date.now(), blockIndex }
                : p
            )
          );
          setStatus(`Process P${process.id} allocated after auto-compaction. Running...`);
          return next;
        }
      }

      if (blockIndex !== -1) {
        const block = blocks[blockIndex];
        if (!block) return blocks;
        const blockCopy = { ...block };
        const next = [...blocks];
        if (blockCopy.size > process.size) {
          const newBlock = createMemoryBlock(blockCopy.size - process.size);
          next[blockIndex] = {
            ...blockCopy, size: process.size, isAllocated: true,
            processId: process.id, requestedSize: process.size, isNew: true,
          };
          next.splice(blockIndex + 1, 0, { ...newBlock, address: 0 });
        } else {
          next[blockIndex] = {
            ...blockCopy, isAllocated: true,
            processId: process.id, requestedSize: process.size, isNew: true,
          };
        }
        setProcessQueue((q) =>
          q.map((p, i) =>
            i === processIndex
              ? { ...p, status: 'allocated' as const, allocatedAt: Date.now(), blockIndex }
              : p
          )
        );
        setStatus(`Process P${process.id} allocated to memory block at ${toHex(blockCopy.address)}. Running...`);
        return next;
      }

      // Allocation failed
      setAllocationFailures((c) => c + 1);
      setProcessQueue((q) =>
        q.map((p, i) => (i === processIndex ? { ...p, status: 'failed' as const } : p))
      );
      processQueueRef.current = processQueueRef.current.map((p, i) =>
        i === processIndex ? { ...p, status: 'failed' as const } : p
      );
      const totalFree = blocks.filter((b) => !b.isAllocated).reduce((s, b) => s + b.size, 0);
      const hasFree = blocks.some((b) => !b.isAllocated);
      setStatus(
        hasFree
          ? `Allocation failed for P${process.id} (${process.size} KB). Insufficient contiguous memory. Free: ${totalFree} KB.`
          : `Allocation failed for P${process.id} (${process.size} KB). No free memory available. Try Compact Memory.`
      );
      return blocks;
    });
  }, [configDirty, resetAlertShown, showToast, stopDeallocationChecker]);

  const resetSimulation = useCallback((overrides?: { totalMemory?: number; memoryBlocksStr?: string; processSizesStr?: string }) => {
    if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
    stopDeallocationChecker();
    setIsAutoRunning(false);
    setIsPaused(false);
    setPauseStartTime(null);
    setIsRetrying(false);
    setConfigDirty(false);
    setResetAlertShown(false);
    setAllocationFailures(0);
    setCompactionCount(0);

    const tm = overrides?.totalMemory ?? totalMemory;
    const mbs = overrides?.memoryBlocksStr ?? memoryBlocksStr;
    const pss = overrides?.processSizesStr ?? processSizesStr;

    if (overrides?.totalMemory != null) setTotalMemory(overrides.totalMemory);
    if (overrides?.memoryBlocksStr != null) setMemoryBlocksStr(overrides.memoryBlocksStr);
    if (overrides?.processSizesStr != null) setProcessSizesStr(overrides.processSizesStr);

    const initialBlocksSizes = parseInputList(mbs);
    const processSizesList = parseInputList(pss);
    const totalMem = tm;

    const blocks: MemoryBlock[] = initialBlocksSizes.map((size) => createMemoryBlock(size));
    const usedMem = initialBlocksSizes.reduce((a, b) => a + b, 0);
    if (totalMem > usedMem) {
      blocks.push(createMemoryBlock(totalMem - usedMem));
    }
    let addr = MEMORY_OFFSET;
    blocks.forEach((b) => { b.address = addr; addr += b.size; b.isNew = true; });

    setMemoryBlocks(blocks);
    setProcessQueue(processSizesList.map((size, index) => createProcess(index + 1, size)));
    setStatus('System Ready. Memory Initialized. Click Auto Run to start simulation.');
    setStopButtonLabel('Stop');
    setStopButtonVariant('primary');
  }, [memoryBlocksStr, processSizesStr, totalMemory, stopDeallocationChecker]);

  const compactMemory = useCallback(() => {
    setStatus('Compacting Memory... Moving allocations...');
    setCompactionCount((c) => c + 1);
    setMemoryBlocks((blocks) => compactBlocksInPlace(blocks));
    setProcessQueue((q) =>
      q.map((p) => (p.status === 'failed' ? { ...p, status: 'waiting' as const } : p))
    );
    setStatus('Compaction Complete. Memory is contiguous. Retrying failed processes...');
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    retryTimeoutRef.current = setTimeout(retryFailedProcesses, 500);
  }, [retryFailedProcesses]);

  const toggleAutoRun = useCallback(() => {
    if (configDirty && !resetAlertShown) {
      showToast('Configuration has changed. Please click Reset to apply changes before running.');
      setResetAlertShown(true);
      return;
    }
    if (isPaused) {
      isPausedRef.current = false;
      const resumeTime = Date.now();
      setProcessQueue((q) =>
        q.map((p) =>
          p.status === 'allocated' && p.allocatedAt != null && p.elapsedBeforePause !== undefined
            ? { ...p, allocatedAt: resumeTime - p.elapsedBeforePause, elapsedBeforePause: undefined }
            : p
        )
      );
      setIsPaused(false);
      setPauseStartTime(null);
      setStopButtonLabel('Stop');
      setStopButtonVariant('primary');
      startDeallocationChecker();
      setStatus('Simulation resumed. Process timers continue from paused state...');
      return;
    }

    if (isAutoRunning) {
      if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
      stopDeallocationChecker();
      setIsAutoRunning(false);
      setStopButtonLabel('Stop');
      setStopButtonVariant('primary');
      setMemoryBlocks((blocks) =>
        blocks.map((b) => (b.isAllocated ? { ...b, isAllocated: false, processId: null, requestedSize: undefined, isNew: true } : b))
      );
      setMemoryBlocks((blocks) => {
        const merged = [...blocks];
        mergeAdjacentFreeBlocksInPlace(merged);
        return merged;
      });
      setProcessQueue([]);
      setStatus('Auto Run ended. All processes terminated. Memory reset and queue cleared.');
    } else {
      setIsAutoRunning(true);
      setIsPaused(false);
      setStopButtonLabel('Stop');
      setStopButtonVariant('primary');
      startDeallocationChecker();
      stepSimulationRef.current();
      autoRunIntervalRef.current = setInterval(() => {
        if (isPausedRef.current) return;
        setProcessQueue((q) => {
          const hasWaiting = q.some((p) => p.status === 'waiting');
          const hasFailed = q.some((p) => p.status === 'failed');
          const hasAllocated = q.some((p) => p.status === 'allocated');
          if (hasWaiting) {
            stepSimulationRef.current();
          } else if (hasFailed && hasAllocated) {
            /* wait for deallocation */
          } else {
            const allDone = q.every(
              (p) => p.status === 'completed' || (p.status === 'failed' && !hasAllocated)
            );
            if (allDone) {
              setIsAutoRunning(false);
              if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
              stopDeallocationChecker();
              setStatus(
                hasFailed
                  ? 'All processes completed or failed. Some processes could not be allocated.'
                  : 'All processes completed. Simulation finished.'
              );
            }
          }
          return q;
        });
      }, AUTO_RUN_INTERVAL_MS);
    }
  }, [configDirty, resetAlertShown, isPaused, isAutoRunning, showToast, startDeallocationChecker, stopDeallocationChecker, stepSimulation]);

  const togglePause = useCallback(() => {
    if (isPaused) {
      isPausedRef.current = false;
      const resumeTime = Date.now();
      setProcessQueue((q) =>
        q.map((p) =>
          p.status === 'allocated' && p.allocatedAt != null && p.elapsedBeforePause !== undefined
            ? { ...p, allocatedAt: resumeTime - p.elapsedBeforePause, elapsedBeforePause: undefined }
            : p
        )
      );
      setIsPaused(false);
      setPauseStartTime(null);
      setStopButtonLabel('Stop');
      setStopButtonVariant('primary');
      startDeallocationChecker();
      setStatus('Simulation resumed. Process timers continue from paused state...');
    } else {
      isPausedRef.current = true;
      const now = Date.now();
      setPauseStartTime(now);
      setProcessQueue((q) =>
        q.map((p) =>
          p.status === 'allocated' && p.allocatedAt != null
            ? { ...p, elapsedBeforePause: now - p.allocatedAt }
            : p
        )
      );
      setIsPaused(true);
      stopDeallocationChecker();
      setStopButtonLabel('Continue');
      setStopButtonVariant('success');
      setStatus('Simulation paused. Process timers frozen. Click Continue to resume.');
    }
  }, [isPaused, startDeallocationChecker, stopDeallocationChecker]);

  deallocateBlockRef.current = deallocateBlock;
  allocateRef.current = allocate;
  stepSimulationRef.current = stepSimulation;

  const handleDeallocateBlock = useCallback(
    (blockIndex: number) => { deallocateBlock(blockIndex, false); },
    [deallocateBlock]
  );

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      resetSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats: SimulationStats = (() => {
    const total = memoryBlocks.reduce((acc, b) => acc + b.size, 0);
    const allocated = memoryBlocks.reduce((acc, b) => (b.isAllocated ? acc + b.size : acc), 0);
    const free = total - allocated;
    let maxFreeBlock = 0;
    memoryBlocks.forEach((b) => { if (!b.isAllocated && b.size > maxFreeBlock) maxFreeBlock = b.size; });
    const extFrag = free - maxFreeBlock;
    const intFrag = memoryBlocks.reduce((acc, b) => {
      if (b.isAllocated && b.requestedSize != null) return acc + (b.size - b.requestedSize);
      return acc;
    }, 0);
    const allocatedCount = processQueue.filter((p) => p.status === 'allocated').length;
    const completedCount = processQueue.filter((p) => p.status === 'completed').length;
    const activeCount = processQueue.filter((p) => p.status !== 'completed').length;
    return {
      allocatedKB: allocated,
      freeKB: free,
      totalKB: total,
      utilizationPct: total > 0 ? Math.round((allocated / total) * 100) : 0,
      internalFragmentation: intFrag,
      externalFragmentation: extFrag,
      largestFreeBlock: maxFreeBlock,
      allocationFailures,
      compactionCount,
      processesText: `${allocatedCount} / ${activeCount} (${completedCount} done)`,
    };
  })();

  const markConfigDirty = useCallback(() => {
    setConfigDirty(true);
    setResetAlertShown(false);
  }, []);

  return {
    memoryBlocks,
    processQueue,
    status,
    algorithm,
    totalMemory,
    memoryBlocksStr,
    processSizesStr,
    compactionMode,
    setTotalMemory,
    setMemoryBlocksStr,
    setProcessSizesStr,
    setAlgorithm,
    setCompactionMode,
    markConfigDirty,
    configDirty,
    isAutoRunning,
    isPaused,
    stopButtonLabel,
    stopButtonVariant,
    stats,
    resetSimulation,
    stepSimulation,
    compactMemory,
    toggleAutoRun,
    togglePause,
    handleDeallocateBlock,
    isRetrying,
    autoRunButtonLabel: isAutoRunning ? 'End Auto Run' : 'Auto Run',
  };
}
