// Core State
let memoryBlocks = [];
let processQueue = [];
let isAutoRunning = false;
let autoRunInterval = null;
let currentAlgorithm = 'first-fit';
let configDirty = false;
let resetAlertShown = false;
let runningToastEl = null;



// Constants
const MEMORY_OFFSET = 0x0000; // Starting address offset

// DOM Elements
const els = {
    totalMemoryIn: document.getElementById('totalMemory'),
    memoryBlocksIn: document.getElementById('memoryBlocks'),
    processSizesIn: document.getElementById('processSizes'),
    algorithmSelect: document.getElementById('algorithm'),
    btnReset: document.getElementById('btn-reset'),
    btnStep: document.getElementById('btn-step'),
    btnAuto: document.getElementById('btn-auto'),
    btnCompact: document.getElementById('btn-compact'),
    memoryContainer: document.getElementById('memory-container'),
    processQueue: document.getElementById('process-queue'),
    statusText: document.getElementById('status-text'),
    statAllocated: document.getElementById('stat-allocated'),
    statFragmentation: document.getElementById('stat-fragmentation'),
    statProcesses: document.getElementById('stat-processes')
};

// Classes
class MemoryBlock {
    constructor(size, isAllocated = false, processId = null) {
        this.size = size;
        this.isAllocated = isAllocated;
        this.processId = processId;
        this.address = 0; // Calculated on render
    }
}

class Process {
    constructor(id, size) {
        this.id = id;
        this.size = size;
        this.status = 'waiting'; // waiting, allocated, failed
    }
}

// Initialization and Reset
function init() {
    setupEventListeners();
    resetSimulation();
}

function setupEventListeners() {
    els.btnReset.addEventListener('click', resetSimulation);
    els.btnStep.addEventListener('click', stepSimulation);
    els.btnAuto.addEventListener('click', toggleAutoRun);
    els.btnCompact.addEventListener('click', compactMemory);
    els.btnCompact.addEventListener('click', compactMemory);
    els.algorithmSelect.addEventListener('change', (e) => {
        currentAlgorithm = e.target.value;
        updateAlgoInfo();
    });
    [
        els.totalMemoryIn,
        els.memoryBlocksIn,
        els.processSizesIn,
        els.algorithmSelect
    ].forEach(el => {
        if (!el) return;
        const markDirty = () => {
            configDirty = true;
            resetAlertShown = false; // allow alert again when config changes
        };
        el.addEventListener('change', markDirty);
        // Also mark dirty on input (typing) for text/number fields so we detect changes before blur
        if (el === els.algorithmSelect) return;
        el.addEventListener('input', markDirty);
    });
    // Initial call
    enableCommaOnSpace(els.memoryBlocksIn);
    enableCommaOnSpace(els.processSizesIn);
    updateAlgoInfo();
}

const algoDescriptions = {
    'first-fit': "First Fit allocates the first hole that is big enough. usage: Searching can start either from the beginning of the set of holes or where the previous first-fit search ended.",
    'best-fit': "Best Fit allocates the smallest hole that is big enough; must search the entire list, unless the list is ordered by size. Produces the smallest leftover hole.",
    'worst-fit': "Worst Fit allocates the largest hole; must also search the entire list. Produces the largest leftover hole, which may be more useful than the smaller leftover hole from best-fit."
};

function updateAlgoInfo() {
    const title = document.getElementById('algo-title');
    const desc = document.getElementById('algo-desc');
    const select = document.getElementById('algorithm');

    if (title && desc && select) {
        const val = select.value;
        title.textContent = select.options[select.selectedIndex].text;
        desc.textContent = algoDescriptions[val] || "";
    }
}

function parseInputList(value) {
    return value.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
}
function showToast(message, durationMs = 4500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    const remove = () => {
        toast.classList.add('toast--out');
        toast.addEventListener('animationend', () => toast.remove());
    };
    const t = setTimeout(remove, durationMs);
    toast.addEventListener('click', () => {
        clearTimeout(t);
        remove();
    });
}

function showRunningToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    dismissRunningToast();
    const toast = document.createElement('div');
    toast.className = 'toast toast--running';
    toast.textContent = message;
    container.appendChild(toast);
    runningToastEl = toast;
}

function dismissRunningToast() {
    if (runningToastEl && runningToastEl.parentNode) {
        const el = runningToastEl;
        runningToastEl = null;
        el.classList.add('toast--out');
        el.addEventListener('animationend', () => el.remove());
    }
}

function showRunSummaryToast() {
    const allocated = processQueue.filter(p => p.status === 'allocated').length;
    const failed = processQueue.filter(p => p.status === 'failed').length;
    const msg =`Run complete. Failed: ${failed}. Allocated: ${allocated}.`;
    showToast(msg);
}

function showResetAlertOnce() {
    if (!resetAlertShown) {
        resetAlertShown = true;
        showToast("Configuration has changed. Please click Reset to apply changes before running.");
    }
}


function resetSimulation() {
    stopAutoRun();
    dismissRunningToast();
    configDirty = false;
    resetAlertShown = false;
    // Safety check for inputs
    if (!els.memoryBlocksIn || !els.processSizesIn) return;

    const initialBlocksSizes = parseInputList(els.memoryBlocksIn.value);
    const processSizes = parseInputList(els.processSizesIn.value);
    currentAlgorithm = els.algorithmSelect.value;
    const totalMem = parseInt(els.totalMemoryIn.value);

    // Initialize Blocks
    memoryBlocks = initialBlocksSizes.map(size => {
        const b = new MemoryBlock(size);
        b.isNew = true; // Animate on load
        return b;
    });

    // Fill remainder
    const usedMem = initialBlocksSizes.reduce((a, b) => a + b, 0);
    if (totalMem > usedMem) {
        const remainder = new MemoryBlock(totalMem - usedMem);
        remainder.isNew = true;
        memoryBlocks.push(remainder);
    }

    // Initialize Queue
    processQueue = processSizes.map((size, index) => new Process(index + 1, size));

    render();
    setStatus("System Ready. Memory Initialized.");
}

function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text;
}

// Format number to Hex 0x....
function toHex(num) {
    return '0x' + num.toString(16).toUpperCase().padStart(4, '0');
}

// Render Functions (2D)
function render() {
    renderMemory2D();
    renderQueue();
    updateStats();
}

function renderMemory2D() {
    if (!els.memoryContainer) return;

    els.memoryContainer.innerHTML = '';
    const totalSize = memoryBlocks.reduce((acc, block) => acc + block.size, 0);
    let currentAddr = MEMORY_OFFSET;

    memoryBlocks.forEach((block, index) => {
        block.address = currentAddr;

        const blockEl = document.createElement('div');

        let typeClass = block.isAllocated ? 'allocated' : 'free';
        if (!block.isAllocated && block.size < 50) typeClass += ' fragment';

        blockEl.className = `block-2d ${typeClass} ${block.isNew ? 'anim-new' : ''}`;

        if (block.isNew) delete block.isNew;

        // Width logic
        const widthPct = (block.size / totalSize) * 100;
        blockEl.style.width = `calc(${widthPct}% - 4px)`; // -4px for gap

        // Labels (Simple Flat)
        const label = block.isAllocated ? `P-${block.processId}` : `${block.size}KB`;
        const subLabel = block.isAllocated ? `${block.size}KB` : 'Free';

        blockEl.innerHTML = `
            <span>${label}</span>
            <small>${subLabel}</small>
        `;

        // Tooltip
        blockEl.title = `Status: ${block.isAllocated ? 'Allocated' : 'Free'}\nAddress: ${toHex(currentAddr)} - ${toHex(currentAddr + block.size - 1)}\nSize: ${block.size}KB`;

        els.memoryContainer.appendChild(blockEl);
        currentAddr += block.size;
    });
}

function renderQueue() {
    if (!els.processQueue) return;

    els.processQueue.innerHTML = '';
    processQueue.forEach(p => {
        if (p.status === 'allocated') return;

        const pEl = document.createElement('div');
        pEl.className = 'queue-block'; // Changed class name

        // Add specific style for failed
        if (p.status === 'failed') {
            pEl.style.background = 'linear-gradient(135deg, #EF4444, #B91C1C)';
        }

        pEl.innerHTML = `
            <span>P${p.id}</span>
            <small>${p.size}KB</small>
        `;

        els.processQueue.appendChild(pEl);
    });
}

function updateStats() {
    const allocated = memoryBlocks.reduce((acc, b) => b.isAllocated ? acc + b.size : acc, 0);
    const free = memoryBlocks.reduce((acc, b) => !b.isAllocated ? acc + b.size : acc, 0);
    const allocatedCount = processQueue.filter(p => p.status === 'allocated').length;

    // External fragmentation: Amount of free space that is NOT the single largest block (simplified definition for visualization)
    // Or strictly: Total Free Space (if we fail to allocate). 
    // Let's just show Free Space.
    let maxFreeBlock = 0;
    memoryBlocks.forEach(b => { if (!b.isAllocated && b.size > maxFreeBlock) maxFreeBlock = b.size });
    const extFrag = free - maxFreeBlock;

    if (els.statAllocated) els.statAllocated.textContent = `${allocated} KB`;
    if (els.statFragmentation) els.statFragmentation.textContent = `${extFrag} KB`;
    if (els.statProcesses) els.statProcesses.textContent = `${allocatedCount} / ${processQueue.length}`;
}

// OS Logic
function stepSimulation() {
    if (configDirty && !resetAlertShown) {
        showResetAlertOnce();
        return;
    }

    const processIndex = processQueue.findIndex(p => p.status === 'waiting');
    if (processIndex === -1) {
        setStatus("All processes handled.");
        dismissRunningToast();
        showRunSummaryToast();
        stopAutoRun();
        return;
    }

    const process = processQueue[processIndex];
    showRunningToast(`Allocating P${process.id} (${process.size} KB)...`);
    setStatus(`Attempting to allocate Process P${process.id} (${process.size} KB)...`);

    let blockIndex = -1;

    // Search Logic
    if (currentAlgorithm === 'first-fit') {
        blockIndex = memoryBlocks.findIndex(b => !b.isAllocated && b.size >= process.size);
    } else if (currentAlgorithm === 'best-fit') {
        let bestDiff = Infinity;
        memoryBlocks.forEach((b, idx) => {
            if (!b.isAllocated && b.size >= process.size) {
                const diff = b.size - process.size;
                if (diff < bestDiff) {
                    bestDiff = diff;
                    blockIndex = idx;
                }
            }
        });
    } else if (currentAlgorithm === 'worst-fit') {
        let maxDiff = -1;
        memoryBlocks.forEach((b, idx) => {
            if (!b.isAllocated && b.size >= process.size) {
                const diff = b.size - process.size;
                if (diff > maxDiff) {
                    maxDiff = diff;
                    blockIndex = idx;
                }
            }
        });
    }

    if (blockIndex !== -1) {
        allocate(blockIndex, processIndex);
    } else {
        process.status = 'failed';
        setStatus(`Allocation failed for P${process.id}. Try Compact Memory.`);
        render();
    }

    if (processQueue.every(p => p.status !== 'waiting')) {
        dismissRunningToast();
        showRunSummaryToast();
        if (isAutoRunning) stopAutoRun();
    }
}

function allocate(blockIndex, processIndex) {
    const block = memoryBlocks[blockIndex];
    const process = processQueue[processIndex];

    if (block.size > process.size) {
        const newBlock = new MemoryBlock(block.size - process.size);
        block.size = process.size;
        block.isAllocated = true;
        block.processId = process.id;
        block.isNew = true; // Trigger animation

        // Insert fragment
        memoryBlocks.splice(blockIndex + 1, 0, newBlock);
    } else {
        block.isAllocated = true;
        block.processId = process.id;
        block.isNew = true;
    }

    process.status = 'allocated';
    render();
}

// ----------------------
// Advanced OS Logic: Compaction
// ----------------------
function compactMemory() {
    setStatus("Compacting Memory... Moving allocations...");

    // Separate allocated and free
    const allocated = memoryBlocks.filter(b => b.isAllocated);
    const freeBlocks = memoryBlocks.filter(b => !b.isAllocated);

    // Calculate total free space
    const totalFreeSize = freeBlocks.reduce((acc, b) => acc + b.size, 0);

    // Create one large free block if there is free space
    const newMemoryMap = allocated.map(b => {
        b.isNew = true; // Re-animate position
        return b;
    });

    if (totalFreeSize > 0) {
        const freeBlock = new MemoryBlock(totalFreeSize);
        freeBlock.isNew = true;
        newMemoryMap.push(freeBlock);
    }

    // Update state
    memoryBlocks = newMemoryMap;

    // Re-check failed processes
    processQueue.forEach(p => {
        if (p.status === 'failed') p.status = 'waiting';
    });

    render();
    setStatus("Compaction Complete. Memory is contiguous.");
}

// Auto Run
function toggleAutoRun() {
    if (configDirty && !resetAlertShown) {
        showResetAlertOnce();
        return;
    }   
    if (isAutoRunning) {
        stopAutoRun();
    } else {
        isAutoRunning = true;
        els.btnAuto.textContent = "Stop";
        stepSimulation();
        autoRunInterval = setInterval(() => {
            if (processQueue.every(p => p.status !== 'waiting')) {
                stopAutoRun();
            } else {
                stepSimulation();
            }
        }, 1200);
    }
}

function stopAutoRun() {
    isAutoRunning = false;
    els.btnAuto.textContent = "Auto Run";
    clearInterval(autoRunInterval);
}
function enableCommaOnSpace(inputEl) {
    inputEl.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();

            const value = inputEl.value;
            const cursorPos = inputEl.selectionStart;

            // Don't insert comma at start or after another comma
            if (
                cursorPos === 0 ||
                value[cursorPos - 1] === ',' ||
                value[cursorPos - 1] === ' '
            ) {
                return;
            }

            const before = value.slice(0, cursorPos);
            const after = value.slice(cursorPos);

            inputEl.value = `${before}, ${after}`;
            inputEl.selectionStart = inputEl.selectionEnd = cursorPos + 2;
        }
    });
}


// Start
init();
