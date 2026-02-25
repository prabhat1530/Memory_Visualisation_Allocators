'use client';

import { useCallback } from 'react';
import { ALGO_OPTION_GROUPS } from '@/lib/algorithm-descriptions';
import type { StrategyType, CompactionMode } from '@/types/memory';

interface ConfigurationSidebarProps {
  totalMemory: number;
  memoryBlocksStr: string;
  processSizesStr: string;
  algorithm: StrategyType;
  compactionMode: CompactionMode;
  pageSizeStr: string;
  stopButtonLabel: 'Stop' | 'Continue';
  stopButtonVariant: 'primary' | 'success';
  onTotalMemoryChange: (value: number) => void;
  onMemoryBlocksStrChange: (value: string) => void;
  onProcessSizesStrChange: (value: string) => void;
  onAlgorithmChange: (value: StrategyType) => void;
  onCompactionModeChange: (value: CompactionMode) => void;
  onPageSizeChange: (value: string) => void;
  onMarkConfigDirty: () => void;
  onReset: () => void;
  onCompact: () => void;
  onStopClick: () => void;
  onAutoRunClick: () => void;
  autoRunButtonLabel: string;
}

export function ConfigurationSidebar({
  totalMemory,
  memoryBlocksStr,
  processSizesStr,
  algorithm,
  compactionMode,
  pageSizeStr,
  stopButtonLabel,
  stopButtonVariant,
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
  autoRunButtonLabel,
}: ConfigurationSidebarProps) {
  const isBuddy = algorithm === 'buddy';
  const isPaging = algorithm === 'paging-fifo' || algorithm === 'paging-lru';
  const disableBlockSizes = isBuddy || isPaging;
  const disableCompact = isPaging;

  const handleKeyDownComma = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, setValue: (v: string) => void) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      const target = e.currentTarget;
      const value = target.value;
      const cursorPos = target.selectionStart ?? 0;
      if (
        cursorPos === 0 ||
        value[cursorPos - 1] === ',' ||
        value[cursorPos - 1] === ' '
      )
        return;
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      const newValue = `${before}, ${after}`;
      setValue(newValue);
      onMarkConfigDirty();
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = cursorPos + 2;
      });
    },
    [onMarkConfigDirty]
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Configuration</h2>
      </div>

      <div className="config-group">
        <label htmlFor="totalMemory">Total Memory Size (KB)</label>
        <input
          type="number"
          id="totalMemory"
          value={totalMemory}
          onChange={(e) => {
            onTotalMemoryChange(parseInt(e.target.value, 10) || 1024);
            onMarkConfigDirty();
          }}
          onInput={() => onMarkConfigDirty()}
          className="dark-input"
        />
      </div>

      <div className="config-group">
        <label htmlFor="memoryBlocks">
          Initial Block Sizes (comma separated)
        </label>
        <input
          type="text"
          id="memoryBlocks"
          value={memoryBlocksStr}
          disabled={disableBlockSizes}
          onChange={(e) => {
            onMemoryBlocksStrChange(e.target.value);
            onMarkConfigDirty();
          }}
          onKeyDown={(e) => handleKeyDownComma(e, onMemoryBlocksStrChange)}
          className="dark-input"
          style={disableBlockSizes ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        />
        <small className="helper-text">
          {isBuddy
            ? 'Disabled — Buddy System auto-splits from total memory'
            : isPaging
            ? 'Disabled — Paging uses fixed-size frames'
            : 'Separate values with commas'}
        </small>
      </div>

      {isPaging && (
        <div className="config-group">
          <label htmlFor="pageSize">Page / Frame Size (KB)</label>
          <input
            type="number"
            id="pageSize"
            value={pageSizeStr}
            onChange={(e) => {
              onPageSizeChange(e.target.value);
              onMarkConfigDirty();
            }}
            className="dark-input"
          />
        </div>
      )}

      <div className="config-group">
        <label htmlFor="processSizes">Process Queue (comma separated)</label>
        <input
          type="text"
          id="processSizes"
          value={processSizesStr}
          onChange={(e) => {
            onProcessSizesStrChange(e.target.value);
            onMarkConfigDirty();
          }}
          onKeyDown={(e) => handleKeyDownComma(e, onProcessSizesStrChange)}
          className="dark-input"
        />
      </div>

      <div className="config-group">
        <label htmlFor="algorithm">Memory Strategy</label>
        <div className="select-wrapper">
          <select
            id="algorithm"
            className="dark-input"
            value={algorithm}
            onChange={(e) => {
              onAlgorithmChange(e.target.value as StrategyType);
              onMarkConfigDirty();
            }}
          >
            {ALGO_OPTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {!isPaging && (
        <div className="config-group">
          <label htmlFor="compactionMode">Compaction Mode</label>
          <div className="select-wrapper">
            <select
              id="compactionMode"
              className="dark-input"
              value={compactionMode}
              onChange={(e) =>
                onCompactionModeChange(e.target.value as CompactionMode)
              }
            >
              <option value="manual">Manual</option>
              <option value="auto">Auto on Allocation Failure</option>
            </select>
          </div>
        </div>
      )}

      <div className="action-grid">
        <button type="button" id="btn-reset" className="btn btn-dark" onClick={onReset}>
          Reset
        </button>
        <button
          type="button"
          id="btn-compact"
          className="btn btn-warning"
          onClick={onCompact}
          disabled={disableCompact}
          style={disableCompact ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        >
          Compact Memory
        </button>
        <button
          type="button"
          id="btn-stop"
          className={`btn btn-${stopButtonVariant}`}
          onClick={onStopClick}
        >
          {stopButtonLabel}
        </button>
        <button
          type="button"
          id="btn-auto"
          className="btn btn-accent"
          onClick={onAutoRunClick}
        >
          {autoRunButtonLabel}
        </button>
      </div>

      <div className="legend-panel">
        <h3>MAP LEGEND</h3>
        <div className="legend-item">
          <span className="dot free" />
          <div className="legend-info">
            <span className="l-title">Free Space</span>
            <span className="l-desc">Available memory</span>
          </div>
        </div>
        <div className="legend-item">
          <span className="dot allocated" />
          <div className="legend-info">
            <span className="l-title">Allocated</span>
            <span className="l-desc">Active Process</span>
          </div>
        </div>
        <div className="legend-item">
          <span className="dot fragment" />
          <div className="legend-info">
            <span className="l-title">Fragment</span>
            <span className="l-desc">Wasted space</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
