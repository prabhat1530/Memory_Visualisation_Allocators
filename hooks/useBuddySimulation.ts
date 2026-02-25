'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemoryBlock, Process, SimulationStats, StrategyType, CompactionMode } from '@/types/memory';
import {
  DEALLOCATE_ANIMATION_MS,
  DEALLOCATION_CHECK_INTERVAL_MS,
  MEMORY_OFFSET,
  PROCESS_LIFETIME_MS,
  AUTO_RUN_INTERVAL_MS,
} from '@/lib/constants';
import { toHex, parseInputList } from '@/lib/memory-utils';

interface BuddyNode {
  size: number;
  address: number;
  isAllocated: boolean;
  processId: number | null;
  requestedSize: number | null;
  isSplit: boolean;
  left: BuddyNode | null;
  right: BuddyNode | null;
}

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function createBuddyTree(size: number, address: number): BuddyNode {
  return { size, address, isAllocated: false, processId: null, requestedSize: null, isSplit: false, left: null, right: null };
}

function buddyAllocate(node: BuddyNode, requestedSize: number, processId: number): boolean {
  const needed = nextPowerOf2(requestedSize);
  if (node.size < needed) return false;
  if (node.isAllocated) return false;
  if (node.isSplit) {
    return buddyAllocate(node.left!, requestedSize, processId) || buddyAllocate(node.right!, requestedSize, processId);
  }
  if (node.size === needed) {
    node.isAllocated = true;
    node.processId = processId;
    node.requestedSize = requestedSize;
    return true;
  }
  const half = node.size / 2;
  node.isSplit = true;
  node.left = createBuddyTree(half, node.address);
  node.right = createBuddyTree(half, node.address + half);
  return buddyAllocate(node.left, requestedSize, processId);
}

function buddyDeallocate(node: BuddyNode, processId: number): boolean {
  if (node.isAllocated && node.processId === processId) {
    node.isAllocated = false;
    node.processId = null;
    node.requestedSize = null;
    return true;
  }
  if (node.isSplit) {
    const found = buddyDeallocate(node.left!, processId) || buddyDeallocate(node.right!, processId);
    if (found) buddyMerge(node);
    return found;
  }
  return false;
}

function buddyMerge(node: BuddyNode): void {
  if (!node.isSplit) return;
  const l = node.left!;
  const r = node.right!;
  if (!l.isAllocated && !l.isSplit && !r.isAllocated && !r.isSplit) {
    node.isSplit = false;
    node.left = null;
    node.right = null;
  }
}

function flattenBuddyTree(node: BuddyNode): MemoryBlock[] {
  if (!node.isSplit) {
    return [{
      size: node.size,
      isAllocated: node.isAllocated,
      processId: node.processId,
      address: node.address,
      requestedSize: node.requestedSize ?? undefined,
      isNew: true,
      isBuddySplit: false,
    }];
  }
  const leftBlocks = flattenBuddyTree(node.left!);
  const rightBlocks = flattenBuddyTree(node.right!);
  return [...leftBlocks, ...rightBlocks];
}

function deepCloneTree(node: BuddyNode): BuddyNode {
  const clone: BuddyNode = { ...node, left: null, right: null };
  if (node.left) clone.left = deepCloneTree(node.left);
  if (node.right) clone.right = deepCloneTree(node.right);
  return clone;
}

function createProcess(id: number, size: number): Process {
  return { id, size, status: 'waiting', allocatedAt: null, lifetime: PROCESS_LIFETIME_MS };
}

export function useBuddySimulation(showToast: (msg: string) => void) {
  const [buddyRoot, setBuddyRoot] = useState<BuddyNode | null>(null);
  const [memoryBlocks, setMemoryBlocks] = useState<MemoryBlock[]>([]);
  const [processQueue, setProcessQueue] = useState<Process[]>([]);
  const [status, setStatus] = useState('System Ready. Buddy System Initialized.');
  const [algorithm] = useState<StrategyType>('buddy');
  const [totalMemory, setTotalMemory] = useState(1024);
  const [memoryBlocksStr, setMemoryBlocksStr] = useState('');
  const [processSizesStr, setProcessSizesStr] = useState('33, 120, 60, 250, 130, 200');
  const [configDirty, setConfigDirty] = useState(false);
  const [resetAlertShown, setResetAlertShown] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [stopButtonLabel, setStopButtonLabel] = useState<'Stop' | 'Continue'>('Stop');
  const [stopButtonVariant, setStopButtonVariant] = useState<'primary' | 'success'>('primary');
  const [compactionMode, setCompactionMode] = useState<CompactionMode>('manual');
  const [allocationFailures, setAllocationFailures] = useState(0);
  const [compactionCount] = useState(0);
  const initialMount = useRef(true);

  const autoRunIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deallocationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buddyRootRef = useRef<BuddyNode | null>(null);
  const processQueueRef = useRef<Process[]>([]);
  const isPausedRef = useRef(false);
  const stepSimulationRef = useRef<() => void>(() => {});

  processQueueRef.current = processQueue;
  isPausedRef.current = isPaused;
  buddyRootRef.current = buddyRoot;

  const syncBlocks = useCallback((root: BuddyNode) => {
    setMemoryBlocks(flattenBuddyTree(root));
  }, []);

  const setAlgorithm = useCallback((_val: StrategyType) => {
    setConfigDirty(true);
    setResetAlertShown(false);
  }, []);

  const stopDeallocationChecker = useCallback(() => {
    if (deallocationIntervalRef.current) { clearInterval(deallocationIntervalRef.current); deallocationIntervalRef.current = null; }
  }, []);

  const startDeallocationChecker = useCallback(() => {
    stopDeallocationChecker();
    deallocationIntervalRef.current = setInterval(() => {
      if (isPausedRef.current) return;
      const queue = processQueueRef.current;
      const root = buddyRootRef.current;
      if (!root) return;
      const now = Date.now();
      for (const process of queue) {
        if (process.status !== 'allocated' || process.allocatedAt == null || process.elapsedBeforePause !== undefined) continue;
        const elapsed = now - process.allocatedAt;
        if (elapsed >= process.lifetime) {
          const newRoot = deepCloneTree(root);
          buddyDeallocate(newRoot, process.id);
          setBuddyRoot(newRoot);
          buddyRootRef.current = newRoot;
          syncBlocks(newRoot);
          setProcessQueue((q) =>
            q.map((p) => p.id === process.id ? { ...p, status: 'completed' as const, allocatedAt: null } : p)
          );
          setStatus(`Process P${process.id} completed execution. Buddy blocks merged.`);
          break;
        }
      }
    }, DEALLOCATION_CHECK_INTERVAL_MS);
  }, [stopDeallocationChecker, syncBlocks]);

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
        setProcessQueue((q) => q.map((p, i) => i === processIndex ? { ...p, status: 'waiting' as const } : p));
      }
    }
    if (processIndex === -1) {
      const hasAllocated = queue.some((p) => p.status === 'allocated');
      const hasFailed = queue.some((p) => p.status === 'failed');
      if (hasAllocated) {
        setStatus(hasFailed ? 'Waiting for memory to free...' : 'All allocated. Waiting for completion...');
      } else if (hasFailed) {
        setStatus('All processes failed. Reset or wait.');
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
    processQueueRef.current = queue.map((p, i) =>
      i === processIndex ? { ...p, status: 'allocated' as const, allocatedAt: Date.now(), blockIndex: -1 } : p
    );
    setStatus(`Allocating P${process.id} (${process.size} KB) via Buddy System...`);
    const root = buddyRootRef.current;
    if (!root) return;
    const newRoot = deepCloneTree(root);
    const success = buddyAllocate(newRoot, process.size, process.id);
    if (success) {
      setBuddyRoot(newRoot);
      buddyRootRef.current = newRoot;
      syncBlocks(newRoot);
      setProcessQueue((q) =>
        q.map((p, i) => i === processIndex ? { ...p, status: 'allocated' as const, allocatedAt: Date.now() } : p)
      );
      setStatus(`P${process.id} allocated (block ${nextPowerOf2(process.size)} KB). Running...`);
    } else {
      setAllocationFailures((c) => c + 1);
      setProcessQueue((q) => q.map((p, i) => i === processIndex ? { ...p, status: 'failed' as const } : p));
      processQueueRef.current = processQueueRef.current.map((p, i) =>
        i === processIndex ? { ...p, status: 'failed' as const } : p
      );
      setStatus(`Allocation failed for P${process.id}. No suitable buddy block available.`);
    }
  }, [configDirty, resetAlertShown, showToast, stopDeallocationChecker, syncBlocks]);

  stepSimulationRef.current = stepSimulation;

  const resetSimulation = useCallback((overrides?: { totalMemory?: number; processSizesStr?: string }) => {
    if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
    stopDeallocationChecker();
    setIsAutoRunning(false);
    setIsPaused(false);
    setIsRetrying(false);
    setConfigDirty(false);
    setResetAlertShown(false);
    setAllocationFailures(0);

    const tm = overrides?.totalMemory ?? totalMemory;
    const pss = overrides?.processSizesStr ?? processSizesStr;

    if (overrides?.totalMemory != null) setTotalMemory(overrides.totalMemory);
    if (overrides?.processSizesStr != null) setProcessSizesStr(overrides.processSizesStr);

    const roundedMem = nextPowerOf2(tm);
    const root = createBuddyTree(roundedMem, MEMORY_OFFSET);
    setBuddyRoot(root);
    buddyRootRef.current = root;
    syncBlocks(root);
    const processSizesList = parseInputList(pss);
    setProcessQueue(processSizesList.map((size, i) => createProcess(i + 1, size)));
    setStatus(`Buddy System initialized. Memory: ${roundedMem} KB (power of 2).`);
    setStopButtonLabel('Stop');
    setStopButtonVariant('primary');
  }, [totalMemory, processSizesStr, stopDeallocationChecker, syncBlocks]);

  const compactMemory = useCallback(() => {
    showToast('Compaction is not applicable in Buddy System mode.');
  }, [showToast]);

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
      setStopButtonLabel('Stop');
      setStopButtonVariant('primary');
      startDeallocationChecker();
      setStatus('Simulation resumed.');
      return;
    }
    if (isAutoRunning) {
      if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
      stopDeallocationChecker();
      setIsAutoRunning(false);
      setStopButtonLabel('Stop');
      setStopButtonVariant('primary');
      const root = buddyRootRef.current;
      if (root) {
        const freshRoot = createBuddyTree(root.size, MEMORY_OFFSET);
        setBuddyRoot(freshRoot);
        buddyRootRef.current = freshRoot;
        syncBlocks(freshRoot);
      }
      setProcessQueue([]);
      setStatus('Auto Run ended. Memory reset.');
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
            /* wait for deallocation to free memory */
          } else if (hasFailed && !hasAllocated) {
            const blocks = flattenBuddyTree(buddyRootRef.current!);
            const totalFree = blocks.reduce((s, b) => (!b.isAllocated ? s + b.size : s), 0);
            const smallestFailed = q
              .filter((p) => p.status === 'failed')
              .reduce((min, p) => Math.min(min, p.size), Infinity);
            if (totalFree >= smallestFailed) {
              stepSimulationRef.current();
            } else {
              setIsAutoRunning(false);
              if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
              stopDeallocationChecker();
              setStatus('Some processes could not be allocated. Not enough memory.');
            }
          } else {
            const allDone = q.every((p) => p.status === 'completed');
            if (allDone) {
              setIsAutoRunning(false);
              if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
              stopDeallocationChecker();
              setStatus('All processes completed.');
            }
          }
          return q;
        });
      }, AUTO_RUN_INTERVAL_MS);
    }
  }, [configDirty, resetAlertShown, isPaused, isAutoRunning, showToast, startDeallocationChecker, stopDeallocationChecker, syncBlocks, stepSimulation]);

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
      setStopButtonLabel('Stop');
      setStopButtonVariant('primary');
      startDeallocationChecker();
      setStatus('Simulation resumed.');
    } else {
      isPausedRef.current = true;
      const now = Date.now();
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
      setStatus('Simulation paused.');
    }
  }, [isPaused, startDeallocationChecker, stopDeallocationChecker]);

  const handleDeallocateBlock = useCallback(
    (blockIndex: number) => {
      const block = memoryBlocks[blockIndex];
      if (!block || !block.isAllocated || !block.processId) return;
      const pid = block.processId;
      const root = buddyRootRef.current;
      if (!root) return;
      const newRoot = deepCloneTree(root);
      buddyDeallocate(newRoot, pid);
      setBuddyRoot(newRoot);
      buddyRootRef.current = newRoot;
      syncBlocks(newRoot);
      setProcessQueue((q) =>
        q.map((p) => p.id === pid ? { ...p, status: 'terminated' as const, allocatedAt: null } : p)
      );
      setStatus(`Process P${pid} deallocated. Buddy blocks merged.`);
    },
    [memoryBlocks, syncBlocks]
  );

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      resetSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markConfigDirty = useCallback(() => { setConfigDirty(true); setResetAlertShown(false); }, []);

  const stats: SimulationStats = (() => {
    const total = memoryBlocks.reduce((acc, b) => acc + b.size, 0);
    const allocated = memoryBlocks.reduce((acc, b) => (b.isAllocated ? acc + b.size : acc), 0);
    const free = total - allocated;
    let maxFree = 0;
    memoryBlocks.forEach((b) => { if (!b.isAllocated && b.size > maxFree) maxFree = b.size; });
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
      externalFragmentation: free - maxFree,
      largestFreeBlock: maxFree,
      allocationFailures,
      compactionCount,
      processesText: `${allocatedCount} / ${activeCount} (${completedCount} done)`,
    };
  })();

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
