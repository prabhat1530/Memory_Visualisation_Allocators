'use client';

import { ConfigurationSidebar } from './ConfigurationSidebar';
import { MemoryMap } from './MemoryMap';
import { ProcessQueueSection } from './ProcessQueueSection';
import { AlgorithmDetails } from './AlgorithmDetails';
import { SystemMonitor } from './SystemMonitor';
import { ToastContainer } from './ToastContainer';
import { PageTable } from './PageTable';
import type { StrategyType, CompactionMode, SimulationStats, PageTableEntry } from '@/types/memory';
import type { MemoryBlock } from '@/types/memory';
import type { Process } from '@/types/memory';
import type { ToastItem } from '@/hooks/useToast';

interface AppLayoutProps {
  totalMemory: number;
  memoryBlocksStr: string;
  processSizesStr: string;
  algorithm: StrategyType;
  compactionMode: CompactionMode;
  pageSizeStr: string;
  pageTable: PageTableEntry[];
  memoryBlocks: MemoryBlock[];
  processQueue: Process[];
  status: string;
  stopButtonLabel: 'Stop' | 'Continue';
  stopButtonVariant: 'primary' | 'success';
  stats: SimulationStats;
  toasts: ToastItem[];
  onTotalMemoryChange: (v: number) => void;
  onMemoryBlocksStrChange: (v: string) => void;
  onProcessSizesStrChange: (v: string) => void;
  onAlgorithmChange: (v: StrategyType) => void;
  onCompactionModeChange: (v: CompactionMode) => void;
  onPageSizeChange: (v: string) => void;
  onMarkConfigDirty: () => void;
  onReset: () => void;
  onCompact: () => void;
  onStopClick: () => void;
  onAutoRunClick: () => void;
  onDeallocateBlock: (index: number) => void;
  dismissToast: (id: number) => void;
  autoRunButtonLabel: string;
}

export function AppLayout({
  totalMemory,
  memoryBlocksStr,
  processSizesStr,
  algorithm,
  compactionMode,
  pageSizeStr,
  pageTable,
  memoryBlocks,
  processQueue,
  status,
  stopButtonLabel,
  stopButtonVariant,
  stats,
  toasts,
  onTotalMemoryChange,
  onMemoryBlocksStrChange,
  onProcessSizesStrChange,
  onAlgorithmChange,
  onCompactionModeChange,
  onPageSizeChange,
  onMarkConfigDirty,
  onReset,
  onCompact,
  onStopClick,
  onAutoRunClick,
  onDeallocateBlock,
  dismissToast,
  autoRunButtonLabel,
}: AppLayoutProps) {
  const isPaging = algorithm === 'paging-fifo' || algorithm === 'paging-lru';

  return (
    <>
      <div className="app-layout">
        <ConfigurationSidebar
          totalMemory={totalMemory}
          memoryBlocksStr={memoryBlocksStr}
          processSizesStr={processSizesStr}
          algorithm={algorithm}
          compactionMode={compactionMode}
          pageSizeStr={pageSizeStr}
          stopButtonLabel={stopButtonLabel}
          stopButtonVariant={stopButtonVariant}
          onTotalMemoryChange={onTotalMemoryChange}
          onMemoryBlocksStrChange={onMemoryBlocksStrChange}
          onProcessSizesStrChange={onProcessSizesStrChange}
          onAlgorithmChange={onAlgorithmChange}
          onCompactionModeChange={onCompactionModeChange}
          onPageSizeChange={onPageSizeChange}
          onMarkConfigDirty={onMarkConfigDirty}
          onReset={onReset}
          onCompact={onCompact}
          onStopClick={onStopClick}
          onAutoRunClick={onAutoRunClick}
          autoRunButtonLabel={autoRunButtonLabel}
        />

        <main className="main-content">
          <header className="content-header">
            <h2>
              {isPaging ? 'Physical Memory Frames' : 'Physical Memory Map (RAM)'}
            </h2>
            <p id="status-text">{status}</p>
          </header>

          <section className="memory-map-section">
            <MemoryMap
              memoryBlocks={memoryBlocks}
              processQueue={processQueue}
              onDeallocateBlock={onDeallocateBlock}
            />
          </section>

          {isPaging && <PageTable pageTable={pageTable} />}

          <ProcessQueueSection
            processQueue={processQueue}
            memoryBlocks={memoryBlocks}
          />

          <AlgorithmDetails algorithm={algorithm} />

          <SystemMonitor stats={stats} strategy={algorithm} />
        </main>
      </div>

      <ToastContainer toasts={toasts} dismissToast={dismissToast} />
    </>
  );
}
