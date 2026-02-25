import type { StrategyType } from '@/types/memory';

export const MEMORY_OFFSET = 0x0000;
export const PROCESS_LIFETIME_MS = 5000;
export const AUTO_RUN_INTERVAL_MS = 2000;
export const DEALLOCATION_CHECK_INTERVAL_MS = 300;
export const DEALLOCATE_ANIMATION_MS = 400;
export const COMPACTION_DELAY_MS = 400;
export const DEFAULT_PAGE_SIZE = 64;
export const THRASHING_THRESHOLD = 0.5;

export interface StrategyDefaults {
  totalMemory: number;
  memoryBlocks: string;
  processSizes: string;
  pageSize?: number;
}

/**
 * Each strategy ships with a curated default workload (6+ processes) that
 * naturally exposes the algorithm's strengths and limitations when run.
 *
 * Contiguous strategies share the same block layout (1024 KB split into
 * 200, 100, 300, 50, 150, 224) so the user can switch between First/Best/Worst
 * Fit and compare behaviour on the same memory map.
 */
export const STRATEGY_DEFAULTS: Record<StrategyType, StrategyDefaults> = {
  /* ── First Fit ──────────────────────────────────────────────────────
   * P1-P5 fill scattered holes; P6 (200 KB) cannot find a contiguous
   * block even though 159 KB total is free → classic external fragmentation.
   * Compaction merges the fragments and allows P6 to allocate.          */
  'first-fit': {
    totalMemory: 1024,
    memoryBlocks: '200, 100, 300, 50, 150, 224',
    processSizes: '120, 280, 45, 180, 90, 200',
  },

  /* ── Best Fit ───────────────────────────────────────────────────────
   * Best fit packs processes into the tightest holes, leaving tiny
   * unusable fragments (5, 5, 20, 2, 5 KB).  P6 (250 KB) fails because
   * no single hole ≥ 250 exists, yet 261 KB total is free — illustrating
   * how best-fit produces many small fragments.  Compaction helps.      */
  'best-fit': {
    totalMemory: 1024,
    memoryBlocks: '200, 100, 300, 50, 150, 224',
    processSizes: '95, 145, 48, 195, 280, 250',
  },

  /* ── Worst Fit ──────────────────────────────────────────────────────
   * Worst fit deliberately uses the largest hole each time, keeping
   * remaining holes more uniform.  P6 (200 KB) fails because after
   * spreading allocations across the biggest blocks, the largest
   * remaining hole is only ~160 KB.  Shows that worst fit can still
   * fragment memory when the workload is aggressive.                    */
  'worst-fit': {
    totalMemory: 1024,
    memoryBlocks: '200, 100, 300, 50, 150, 224',
    processSizes: '60, 80, 30, 150, 100, 200',
  },

  /* ── Buddy System ───────────────────────────────────────────────────
   * Each process is rounded up to the next power-of-2 block, causing
   * visible internal fragmentation:
   *   33→64(+31), 120→128(+8), 60→64(+4), 250→256(+6), 130→256(+126),
   *   200→256 — but only one free 256 remains after the first 5, so
   * P6 can still squeeze in.  The user can see buddy splitting/merging
   * as processes complete and blocks coalesce.                          */
  'buddy': {
    totalMemory: 1024,
    memoryBlocks: '',
    processSizes: '33, 120, 60, 250, 130, 200',
  },

  /* ── Paging (FIFO) ─────────────────────────────────────────────────
   * 1024 KB / 64 KB = 16 frames.  The six processes need
   * 3+4+2+3+4+3 = 19 pages — more than the 16 available frames.
   * FIFO replacement evicts the oldest page first, and the page-fault
   * counter climbs.  With aggressive load, thrashing may be detected.  */
  'paging-fifo': {
    totalMemory: 1024,
    memoryBlocks: '',
    processSizes: '150, 200, 100, 180, 250, 130',
    pageSize: 64,
  },

  /* ── Paging (LRU) ──────────────────────────────────────────────────
   * Same frame layout as FIFO.  LRU evicts the least-recently-used
   * page instead, which often keeps "hotter" pages resident longer.
   * Compare the page-fault count with FIFO on the same workload.      */
  'paging-lru': {
    totalMemory: 1024,
    memoryBlocks: '',
    processSizes: '150, 200, 100, 180, 250, 130',
    pageSize: 64,
  },
};
