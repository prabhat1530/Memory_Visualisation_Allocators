# OS Memory Allocator Visualizer (Next.js)

Production-grade Next.js 14+ App Router port of the Memory Allocation Visualizer. Same UI and behavior as the original, with improved architecture and subtle UX polish.

## Architecture

- **App Router** – Single route `/`; layout and page in `app/`.
- **State** – All simulation state and timers live in `hooks/useMemorySimulation.ts` (refs for intervals, state for UI).
- **Components** – Feature-based under `components/memory-visualizer/`; no DOM manipulation, only React state/props.
- **Styling** – Global CSS in `app/globals.css` (same classes as original); fonts via `next/font` (Inter, JetBrains Mono).
- **Types** – Shared in `types/memory.ts`; utils in `lib/`.

## Folder structure

```
├── app/
│   ├── layout.tsx      # Root layout, fonts, metadata
│   ├── page.tsx        # Client page wiring hook + AppLayout
│   └── globals.css     # Global styles + animation tweaks
├── components/
│   └── memory-visualizer/
│       ├── AppLayout.tsx
│       ├── ConfigurationSidebar.tsx
│       ├── MemoryMap.tsx
│       ├── MemoryBlock.tsx
│       ├── ProcessQueueSection.tsx
│       ├── ProcessQueueBlock.tsx
│       ├── AlgorithmDetails.tsx
│       ├── SystemMonitor.tsx
│       ├── ToastContainer.tsx
│       └── index.ts
├── hooks/
│   ├── useMemorySimulation.ts   # All simulation logic
│   └── useToast.ts
├── lib/
│   ├── constants.ts
│   ├── memory-utils.ts
│   └── algorithm-descriptions.ts
├── types/
│   └── memory.ts
├── package.json
├── next.config.js
└── tsconfig.json
```

## Run

```bash
npm install
npm run dev    # http://localhost:3000
npm run build
npm run start
```

## Behaviour (unchanged)

- First / Best / Worst fit allocation, configurable memory and process queue.
- Auto Run, Stop/Continue, Reset, Compact Memory, manual deallocate by clicking blocks.
- Process lifetime and auto-deallocation, retry of failed processes when memory frees, pause/resume with timer freeze.

## UX tweaks (design preserved)

- Page and layout fade-in.
- Button hover and transition (ease-out-expo).
- Slightly smoother block and queue transitions.
- Legend and monitor card hover.
- Toast click to dismiss and hover.
