'use client';

import { ALGO_DESCRIPTIONS, ALL_STRATEGY_OPTIONS } from '@/lib/algorithm-descriptions';
import type { StrategyType } from '@/types/memory';

interface AlgorithmDetailsProps {
  algorithm: StrategyType;
}

export function AlgorithmDetails({ algorithm }: AlgorithmDetailsProps) {
  const currentOption = ALL_STRATEGY_OPTIONS.find((o) => o.value === algorithm);
  const title = currentOption?.label ?? 'Algorithm Details';
  const description = ALGO_DESCRIPTIONS[algorithm] ?? 'Select a strategy to see how it works.';

  return (
    <section className="algo-details">
      <h4 id="algo-title">{title}</h4>
      <p id="algo-desc">{description}</p>
    </section>
  );
}
