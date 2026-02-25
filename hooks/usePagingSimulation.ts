'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemoryBlock, Process, SimulationStats, StrategyType, CompactionMode, PageTableEntry } from '@/types/memory';
import {
  DEALLOCATION_CHECK_INTERVAL_MS,
  MEMORY_OFFSET,
  PROCESS_LIFETIME_MS,
  AUTO_RUN_INTERVAL_MS,
  DEFAULT_PAGE_SIZE,
  THRASHING_THRESHOLD,
} from '@/lib/constants';
import { parseInputList } from '@/lib/memory-utils';

function createProcess(id: number, size: number): Process {
  return { id, size, status: 'waiting', allocatedAt: null, lifetime: PROCESS_LIFETIME_MS };
}

export function usePagingSimulation(
  showToast: (msg: string) => void,
  strategyProp: 'paging-fifo' | 'paging-lru'
) {
  const [frames, setFrames] = useState<MemoryBlock[]>([]);
  const [pageTable, setPageTable] = useState<PageTableEntry[]>([]);
  const [processQueue, setProcessQueue] = useState<Process[]>([]);
  const [status, setStatus] = useState('System Ready. Paging Mode Initialized.');
  const [algorithm] = useState<StrategyType>(strategyProp);
  const [totalMemory, setTotalMemory] = useState(1024);
  const [pageSizeState, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
  const [memoryBlocksStr, setMemoryBlocksStr] = useState('');
  const [processSizesStr, setProcessSizesStr] = useState('150, 200, 100, 180, 250, 130');
  const [configDirty, setConfigDirty] = useState(false);
  const [resetAlertShown, setResetAlertShown] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [stopButtonLabel, setStopButtonLabel] = useState<'Stop' | 'Continue'>('Stop');
  const [stopButtonVariant, setStopButtonVariant] = useState<'primary' | 'success'>('primary');
  const [compactionMode, setCompactionMode] = useState<CompactionMode>('manual');
  const [allocationFailures, setAllocationFailures] = useState(0);
  const [pageFaults, setPageFaults] = useState(0);
  const [totalAllocations, setTotalAllocations] = useState(0);
  const initialMount = useRef(true);

  const autoRunIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deallocationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const framesRef = useRef<MemoryBlock[]>([]);
  const pageTableRef = useRef<PageTableEntry[]>([]);
  const processQueueRef = useRef<Process[]>([]);
  const isPausedRef = useRef(false);
  const stepSimulationRef = useRef<() => void>(() => {});

  framesRef.current = frames;
  pageTableRef.current = pageTable;
  processQueueRef.current = processQueue;
  isPausedRef.current = isPaused;

  const isThrashing = totalAllocations > 0 && (pageFaults / totalAllocations) > THRASHING_THRESHOLD;

  const setAlgorithm = useCallback((_val: StrategyType) => { setConfigDirty(true); setResetAlertShown(false); }, []);

  const stopDeallocationChecker = useCallback(() => {
    if (deallocationIntervalRef.current) { clearInterval(deallocationIntervalRef.current); deallocationIntervalRef.current = null; }
  }, []);

  const startDeallocationChecker = useCallback(() => {
    stopDeallocationChecker();
    deallocationIntervalRef.current = setInterval(() => {
      if (isPausedRef.current) return;
      const queue = processQueueRef.current;
      const now = Date.now();
      for (const process of queue) {
        if (process.status !== 'allocated' || process.allocatedAt == null || process.elapsedBeforePause !== undefined) continue;
        const elapsed = now - process.allocatedAt;
        if (elapsed >= process.lifetime) {
          const pid = process.id;
          setFrames((f) =>
            f.map((frame) =>
              frame.processId === pid
                ? { ...frame, isAllocated: false, processId: null, requestedSize: undefined, isNew: true }
                : frame
            )
          );
          setPageTable((pt) => pt.filter((e) => e.processId !== pid));
          setProcessQueue((q) =>
            q.map((p) => p.id === pid ? { ...p, status: 'completed' as const, allocatedAt: null } : p)
          );
          setStatus(`Process P${pid} completed. Frames released.`);
          break;
        }
      }
    }, DEALLOCATION_CHECK_INTERVAL_MS);
  }, [stopDeallocationChecker]);

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
        setStatus('All allocated. Waiting for completion...');
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

    setTotalAllocations((c) => c + 1);
    const pagesNeeded = Math.ceil(process.size / pageSizeState);
    const currentFrames = [...framesRef.current];
    const currentPT = [...pageTableRef.current];
    let faultsThisAlloc = 0;

    for (let page = 0; page < pagesNeeded; page++) {
      let freeFrameIdx = currentFrames.findIndex((f) => !f.isAllocated);

      if (freeFrameIdx === -1) {
        faultsThisAlloc++;
        // Page replacement
        const processEntries = currentPT.filter((e) => {
          const proc = processQueueRef.current.find((p) => p.id === e.processId);
          return proc && proc.status === 'allocated';
        });
        if (processEntries.length === 0) break;

        let evictEntry: PageTableEntry;
        if (strategyProp === 'paging-fifo') {
          evictEntry = processEntries.reduce((oldest, e) => e.loadedAt < oldest.loadedAt ? e : oldest);
        } else {
          evictEntry = processEntries.reduce((lru, e) => e.lastAccessedAt < lru.lastAccessedAt ? e : lru);
        }
        freeFrameIdx = evictEntry.frameIndex;
        currentFrames[freeFrameIdx] = {
          ...currentFrames[freeFrameIdx],
          isAllocated: false,
          processId: null,
          requestedSize: undefined,
          isNew: true,
        };
        const evictIdx = currentPT.findIndex(
          (e) => e.processId === evictEntry.processId && e.pageIndex === evictEntry.pageIndex && e.frameIndex === evictEntry.frameIndex
        );
        if (evictIdx !== -1) currentPT.splice(evictIdx, 1);
      }

      const now = Date.now();
      currentFrames[freeFrameIdx] = {
        ...currentFrames[freeFrameIdx],
        isAllocated: true,
        processId: process.id,
        requestedSize: pageSizeState,
        isNew: true,
      };
      currentPT.push({
        processId: process.id,
        pageIndex: page,
        frameIndex: freeFrameIdx,
        loadedAt: now,
        lastAccessedAt: now,
      });
    }

    if (faultsThisAlloc > 0) setPageFaults((c) => c + faultsThisAlloc);

    setFrames(currentFrames);
    setPageTable(currentPT);
    setProcessQueue((q) =>
      q.map((p, i) => i === processIndex ? { ...p, status: 'allocated' as const, allocatedAt: Date.now() } : p)
    );
    setStatus(
      faultsThisAlloc > 0
        ? `P${process.id} allocated (${pagesNeeded} pages, ${faultsThisAlloc} page faults).`
        : `P${process.id} allocated (${pagesNeeded} pages). Running...`
    );
  }, [configDirty, resetAlertShown, showToast, stopDeallocationChecker, pageSizeState, strategyProp]);

  stepSimulationRef.current = stepSimulation;

  const resetSimulation = useCallback((overrides?: { totalMemory?: number; processSizesStr?: string; pageSize?: number }) => {
    if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
    stopDeallocationChecker();
    setIsAutoRunning(false);
    setIsPaused(false);
    setIsRetrying(false);
    setConfigDirty(false);
    setResetAlertShown(false);
    setAllocationFailures(0);
    setPageFaults(0);
    setTotalAllocations(0);

    const tm = overrides?.totalMemory ?? totalMemory;
    const pss = overrides?.processSizesStr ?? processSizesStr;
    const ps = overrides?.pageSize ?? pageSizeState;

    if (overrides?.totalMemory != null) setTotalMemory(overrides.totalMemory);
    if (overrides?.processSizesStr != null) setProcessSizesStr(overrides.processSizesStr);
    if (overrides?.pageSize != null) setPageSizeState(overrides.pageSize);

    const numFrames = Math.floor(tm / ps);
    const newFrames: MemoryBlock[] = Array.from({ length: numFrames }, (_, i) => ({
      size: ps,
      isAllocated: false,
      processId: null,
      address: MEMORY_OFFSET + i * ps,
      isNew: true,
    }));
    setFrames(newFrames);
    framesRef.current = newFrames;
    setPageTable([]);
    pageTableRef.current = [];
    const processSizesList = parseInputList(pss);
    setProcessQueue(processSizesList.map((size, i) => createProcess(i + 1, size)));
    setStatus(`Paging initialized. ${numFrames} frames of ${ps} KB each.`);
    setStopButtonLabel('Stop');
    setStopButtonVariant('primary');
  }, [totalMemory, pageSizeState, processSizesStr, stopDeallocationChecker]);

  const compactMemory = useCallback(() => {
    showToast('Compaction is not applicable in Paging mode.');
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
      setFrames((f) => f.map((frame) => ({ ...frame, isAllocated: false, processId: null, requestedSize: undefined, isNew: true })));
      setPageTable([]);
      setProcessQueue([]);
      setStatus('Auto Run ended. Frames cleared.');
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
            /* wait */
          } else {
            const allDone = q.every((p) => p.status === 'completed' || (p.status === 'failed' && !hasAllocated));
            if (allDone) {
              setIsAutoRunning(false);
              if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
              stopDeallocationChecker();
              setStatus(hasFailed ? 'Some processes failed.' : 'All processes completed.');
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
    (frameIndex: number) => {
      const frame = frames[frameIndex];
      if (!frame || !frame.isAllocated || !frame.processId) return;
      const pid = frame.processId;
      setFrames((f) =>
        f.map((fr, i) =>
          fr.processId === pid
            ? { ...fr, isAllocated: false, processId: null, requestedSize: undefined, isNew: true }
            : fr
        )
      );
      setPageTable((pt) => pt.filter((e) => e.processId !== pid));
      setProcessQueue((q) =>
        q.map((p) => p.id === pid ? { ...p, status: 'terminated' as const, allocatedAt: null } : p)
      );
      setStatus(`Process P${pid} deallocated. Frames released.`);
    },
    [frames]
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
    const total = frames.length * pageSizeState;
    const allocated = frames.filter((f) => f.isAllocated).length * pageSizeState;
    const free = total - allocated;
    const allocatedCount = processQueue.filter((p) => p.status === 'allocated').length;
    const completedCount = processQueue.filter((p) => p.status === 'completed').length;
    const activeCount = processQueue.filter((p) => p.status !== 'completed').length;
    return {
      allocatedKB: allocated,
      freeKB: free,
      totalKB: total,
      utilizationPct: total > 0 ? Math.round((allocated / total) * 100) : 0,
      internalFragmentation: 0,
      externalFragmentation: 0,
      largestFreeBlock: free,
      allocationFailures,
      compactionCount: 0,
      processesText: `${allocatedCount} / ${activeCount} (${completedCount} done)`,
      pageFaults,
      isThrashing,
    };
  })();

  return {
    memoryBlocks: frames,
    processQueue,
    status,
    algorithm,
    totalMemory,
    memoryBlocksStr,
    processSizesStr,
    compactionMode,
    pageTable,
    setTotalMemory,
    setMemoryBlocksStr,
    setProcessSizesStr,
    setAlgorithm,
    setCompactionMode,
    setPageSize: setPageSizeState,
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
