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
  const [totalPageLoads, setTotalPageLoads] = useState(0);
  const initialMount = useRef(true);

  const autoRunIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deallocationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const framesRef = useRef<MemoryBlock[]>([]);
  const pageTableRef = useRef<PageTableEntry[]>([]);
  const processQueueRef = useRef<Process[]>([]);
  const isPausedRef = useRef(false);
  const stepSimulationRef = useRef<() => void>(() => {});
  const pageProgressRef = useRef<Record<number, number>>({});

  framesRef.current = frames;
  pageTableRef.current = pageTable;
  processQueueRef.current = processQueue;
  isPausedRef.current = isPaused;

  const isThrashing = totalPageLoads > 0 && (pageFaults / totalPageLoads) > THRASHING_THRESHOLD;

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
          processQueueRef.current = processQueueRef.current.map((p) =>
            p.id === pid ? { ...p, status: 'completed' as const, allocatedAt: null } : p
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

    let process: Process | undefined;
    let isNewProcess = false;

    process = queue.find((p) => p.status === 'loading');

    if (!process) {
      process = queue.find((p) => p.status === 'waiting');
      if (process) isNewProcess = true;
    }

    if (!process) {
      process = queue.find((p) => p.status === 'failed');
      if (process) isNewProcess = true;
    }

    if (!process) {
      const hasAllocated = queue.some((p) => p.status === 'allocated');
      const hasLoading = queue.some((p) => p.status === 'loading');
      if (hasAllocated || hasLoading) {
        setStatus('All processes being handled. Waiting for completion...');
      } else {
        setStatus('All processes completed.');
        setIsAutoRunning(false);
        if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
        stopDeallocationChecker();
      }
      return;
    }

    const pid = process.id;
    const pagesNeeded = Math.ceil(process.size / pageSizeState);

    if (isNewProcess) {
      pageProgressRef.current[pid] = 0;
      processQueueRef.current = queue.map((p) =>
        p.id === pid ? { ...p, status: 'loading' as const } : p
      );
      setProcessQueue([...processQueueRef.current]);
    }

    const currentPage = pageProgressRef.current[pid] ?? 0;

    const currentFrames = [...framesRef.current];
    const currentPT = [...pageTableRef.current];

    const existingEntry = currentPT.find(
      (e) => e.processId === pid && e.pageIndex === currentPage
    );
    if (existingEntry) {
      existingEntry.lastAccessedAt = Date.now();
      pageProgressRef.current[pid] = currentPage + 1;

      setPageTable([...currentPT]);
      framesRef.current = currentFrames;
      pageTableRef.current = currentPT;

      if (currentPage + 1 >= pagesNeeded) {
        processQueueRef.current = processQueueRef.current.map((p) =>
          p.id === pid ? { ...p, status: 'allocated' as const, allocatedAt: Date.now() } : p
        );
        setProcessQueue([...processQueueRef.current]);
        setStatus(`P${pid} Page ${currentPage}: Hit (already in F${existingEntry.frameIndex}). All ${pagesNeeded} pages loaded — P${pid} running.`);
      } else {
        setStatus(`P${pid} Page ${currentPage}: Hit (already in F${existingEntry.frameIndex}). ${currentPage + 1}/${pagesNeeded} pages loaded.`);
      }
      return;
    }

    let freeFrameIdx = currentFrames.findIndex((f) => !f.isAllocated);
    let evictionMsg = '';
    let hadFault = false;

    if (freeFrameIdx === -1) {
      hadFault = true;

      if (currentPT.length === 0) {
        processQueueRef.current = processQueueRef.current.map((p) =>
          p.id === pid ? { ...p, status: 'failed' as const } : p
        );
        setProcessQueue([...processQueueRef.current]);
        setAllocationFailures((c) => c + 1);
        setPageFaults((c) => c + 1);
        setStatus(`PAGE FAULT — P${pid} Page ${currentPage}: No pages in memory to evict. P${pid} blocked.`);
        return;
      }

      let evictEntry: PageTableEntry;
      let reason: string;

      if (strategyProp === 'paging-fifo') {
        evictEntry = currentPT.reduce((oldest, e) => e.loadedAt < oldest.loadedAt ? e : oldest);
        reason = 'FIFO — oldest loaded page';
      } else {
        evictEntry = currentPT.reduce((lru, e) => e.lastAccessedAt < lru.lastAccessedAt ? e : lru);
        reason = 'LRU — least recently used page';
      }

      freeFrameIdx = evictEntry.frameIndex;
      const isSelfEvict = evictEntry.processId === pid;

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

      evictionMsg = isSelfEvict
        ? `PAGE FAULT! Evicted own Page ${evictEntry.pageIndex} from F${freeFrameIdx} (${reason}). `
        : `PAGE FAULT! Evicted P${evictEntry.processId} Page ${evictEntry.pageIndex} from F${freeFrameIdx} (${reason}). `;
    }

    const now = Date.now();
    const isLastPage = currentPage === pagesNeeded - 1;
    const usedInFrame = isLastPage
      ? process.size - currentPage * pageSizeState
      : pageSizeState;

    currentFrames[freeFrameIdx] = {
      ...currentFrames[freeFrameIdx],
      isAllocated: true,
      processId: pid,
      requestedSize: usedInFrame,
      isNew: true,
    };

    currentPT.push({
      processId: pid,
      pageIndex: currentPage,
      frameIndex: freeFrameIdx,
      loadedAt: now,
      lastAccessedAt: now,
    });

    pageProgressRef.current[pid] = currentPage + 1;

    setFrames(currentFrames);
    framesRef.current = currentFrames;
    setPageTable([...currentPT]);
    pageTableRef.current = currentPT;
    setTotalPageLoads((c) => c + 1);
    if (hadFault) setPageFaults((c) => c + 1);

    if (isLastPage) {
      processQueueRef.current = processQueueRef.current.map((p) =>
        p.id === pid ? { ...p, status: 'allocated' as const, allocatedAt: Date.now() } : p
      );
      setProcessQueue([...processQueueRef.current]);
      setStatus(
        `${evictionMsg}P${pid} Page ${currentPage} → F${freeFrameIdx}. All ${pagesNeeded} pages loaded — P${pid} running.`
      );
    } else {
      setStatus(
        `${evictionMsg}P${pid} Page ${currentPage} → F${freeFrameIdx} (${currentPage + 1}/${pagesNeeded} pages loaded)`
      );
    }
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
    setTotalPageLoads(0);
    pageProgressRef.current = {};

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
    const newQueue = processSizesList.map((size, i) => createProcess(i + 1, size));
    setProcessQueue(newQueue);
    processQueueRef.current = newQueue;
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
          const hasLoading = q.some((p) => p.status === 'loading');
          const hasWaiting = q.some((p) => p.status === 'waiting');
          const hasFailed = q.some((p) => p.status === 'failed');
          const hasAllocated = q.some((p) => p.status === 'allocated');

          if (hasLoading || hasWaiting) {
            stepSimulationRef.current();
          } else if (hasFailed && hasAllocated) {
            /* wait for deallocation to free frames — then retry */
          } else if (hasFailed && !hasAllocated) {
            const freeFrames = framesRef.current.filter((f) => !f.isAllocated).length;
            const smallestFailedPages = q
              .filter((p) => p.status === 'failed')
              .reduce((min, p) => Math.min(min, Math.ceil(p.size / pageSizeState)), Infinity);
            if (freeFrames >= smallestFailedPages) {
              stepSimulationRef.current();
            } else {
              setIsAutoRunning(false);
              if (autoRunIntervalRef.current) { clearInterval(autoRunIntervalRef.current); autoRunIntervalRef.current = null; }
              stopDeallocationChecker();
              setStatus('Some processes could not be allocated. Not enough frames.');
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
  }, [configDirty, resetAlertShown, isPaused, isAutoRunning, showToast, startDeallocationChecker, stopDeallocationChecker, pageSizeState]);

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
        f.map((fr) =>
          fr.processId === pid
            ? { ...fr, isAllocated: false, processId: null, requestedSize: undefined, isNew: true }
            : fr
        )
      );
      setPageTable((pt) => pt.filter((e) => e.processId !== pid));
      setProcessQueue((q) =>
        q.map((p) => p.id === pid ? { ...p, status: 'terminated' as const, allocatedAt: null } : p)
      );
      processQueueRef.current = processQueueRef.current.map((p) =>
        p.id === pid ? { ...p, status: 'terminated' as const, allocatedAt: null } : p
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
    const intFrag = frames.reduce((acc, f) => {
      if (f.isAllocated && f.requestedSize != null) return acc + (f.size - f.requestedSize);
      return acc;
    }, 0);
    const allocatedCount = processQueue.filter((p) => p.status === 'allocated').length;
    const loadingCount = processQueue.filter((p) => p.status === 'loading').length;
    const completedCount = processQueue.filter((p) => p.status === 'completed').length;
    const activeCount = processQueue.filter((p) => p.status !== 'completed').length;
    return {
      allocatedKB: allocated,
      freeKB: free,
      totalKB: total,
      utilizationPct: total > 0 ? Math.round((allocated / total) * 100) : 0,
      internalFragmentation: intFrag,
      externalFragmentation: 0,
      largestFreeBlock: free,
      allocationFailures,
      compactionCount: 0,
      processesText: `${allocatedCount} running, ${loadingCount} loading / ${activeCount} active (${completedCount} done)`,
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
