import type { StrategyType } from '@/types/memory';

export const ALGO_DESCRIPTIONS: Record<StrategyType, string> = {
  'first-fit':
    'First Fit allocates the first hole that is big enough. Searching starts from the beginning of the set of holes or where the previous first-fit search ended.',
  'best-fit':
    'Best Fit allocates the smallest hole that is big enough; must search the entire list, unless the list is ordered by size. Produces the smallest leftover hole.',
  'worst-fit':
    'Worst Fit allocates the largest hole; must also search the entire list. Produces the largest leftover hole, which may be more useful than the smaller leftover hole from best-fit.',
  'buddy':
    'Buddy System divides memory into power-of-2 sized blocks. When a process requests memory, the smallest power-of-2 block that fits is found (splitting larger blocks as needed). On deallocation, buddy blocks are recursively merged back together.',
  'paging-fifo':
    'Paging with FIFO (First-In, First-Out) replacement. Memory is divided into fixed-size frames. When all frames are full and a new page is needed, the oldest loaded page is evicted.',
  'paging-lru':
    'Paging with LRU (Least Recently Used) replacement. Memory is divided into fixed-size frames. When all frames are full and a new page is needed, the page that has not been used for the longest time is evicted.',
};

export interface AlgoOptionGroup {
  label: string;
  options: { value: StrategyType; label: string }[];
}

export const ALGO_OPTION_GROUPS: AlgoOptionGroup[] = [
  {
    label: 'Contiguous Allocation',
    options: [
      { value: 'first-fit', label: 'First Fit' },
      { value: 'best-fit', label: 'Best Fit' },
      { value: 'worst-fit', label: 'Worst Fit' },
    ],
  },
  {
    label: 'Buddy System',
    options: [{ value: 'buddy', label: 'Buddy System' }],
  },
  {
    label: 'Paging',
    options: [
      { value: 'paging-fifo', label: 'Paging (FIFO)' },
      { value: 'paging-lru', label: 'Paging (LRU)' },
    ],
  },
];

export const ALL_STRATEGY_OPTIONS: { value: StrategyType; label: string }[] =
  ALGO_OPTION_GROUPS.flatMap((g) => g.options);
