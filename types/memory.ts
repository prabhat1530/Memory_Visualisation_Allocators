export type ProcessStatus = 'waiting' | 'allocated' | 'failed' | 'terminated' | 'completed';

export type StrategyType =
  | 'first-fit' | 'best-fit' | 'worst-fit'
  | 'buddy'
  | 'paging-fifo' | 'paging-lru';

export type CompactionMode = 'manual' | 'auto';

export interface MemoryBlock {
  size: number;
  isAllocated: boolean;
  processId: number | null;
  address: number;
  requestedSize?: number;
  isNew?: boolean;
  isDeallocating?: boolean;
  isBuddySplit?: boolean;
}

export interface Process {
  id: number;
  size: number;
  status: ProcessStatus;
  allocatedAt: number | null;
  lifetime: number;
  blockIndex?: number;
  elapsedBeforePause?: number;
}

export interface PageTableEntry {
  processId: number;
  pageIndex: number;
  frameIndex: number;
  loadedAt: number;
  lastAccessedAt: number;
}

export interface SimulationStats {
  allocatedKB: number;
  freeKB: number;
  totalKB: number;
  utilizationPct: number;
  internalFragmentation: number;
  externalFragmentation: number;
  largestFreeBlock: number;
  allocationFailures: number;
  compactionCount: number;
  processesText: string;
  pageFaults?: number;
  isThrashing?: boolean;
}
