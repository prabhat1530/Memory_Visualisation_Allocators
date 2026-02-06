// Core State
let memoryBlocks = [];
let processQueue = [];
let isAutoRunning = false;
let isPaused = false;
let pauseStartTime = null; // Track when pause started
let isRetrying = false; // Prevent multiple simultaneous retries
let autoRunInterval = null;
let deallocationInterval = null;
let currentAlgorithm = 'first-fit';
let configDirty = false;
let resetAlertShown = false;
const PROCESS_LIFETIME_MS = 5000; // Process runs for 5 seconds before auto-deallocation (slower visualization)



// Constants
const MEMORY_OFFSET = 0x0000; // Starting address offset

// DOM Elements
const els = {
    totalMemoryIn: document.getElementById('totalMemory'),
    memoryBlocksIn: document.getElementById('memoryBlocks'),
    processSizesIn: document.getElementById('processSizes'),
    algorithmSelect: document.getElementById('algorithm'),
    btnReset: document.getElementById('btn-reset'),
    btnStop: document.getElementById('btn-stop'),
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
        this.status = 'waiting'; // waiting, allocated, failed, terminated
        this.allocatedAt = null; // Timestamp when allocated
        this.lifetime = PROCESS_LIFETIME_MS; // How long process runs before auto-deallocation
    }
}

// Initialization and Reset
function init() {
    setupEventListeners();
    resetSimulation();
}

function setupEventListeners() {
    els.btnReset.addEventListener('click', resetSimulation);
    els.btnStop.addEventListener('click', togglePause);
    els.btnAuto.addEventListener('click', toggleAutoRun);
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

function showResetAlertOnce() {
    if (!resetAlertShown) {
        resetAlertShown = true;
        showToast("Configuration has changed. Please click Reset to apply changes before running.");
    }
}


function resetSimulation() {
    stopAutoRun();
    stopDeallocationChecker();
    isPaused = false;
    pauseStartTime = null;
    isRetrying = false;
    updateStopButton();
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
    setStatus("System Ready. Memory Initialized. Click Auto Run to start simulation.");
    updateStopButton();
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
        if (block.isDeallocating) typeClass += ' deallocating';

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
        let tooltip = `Status: ${block.isAllocated ? 'Allocated' : 'Free'}\nAddress: ${toHex(currentAddr)} - ${toHex(currentAddr + block.size - 1)}\nSize: ${block.size}KB`;
        if (block.isAllocated) {
            const process = processQueue.find(p => p.id === block.processId);
            if (process && process.allocatedAt) {
                const elapsed = Date.now() - process.allocatedAt;
                const remaining = Math.max(0, process.lifetime - elapsed);
                const remainingSec = (remaining / 1000).toFixed(1);
                tooltip += `\nProcess P${block.processId} running...\nTime remaining: ${remainingSec}s`;
            }
            tooltip += '\n(Click to manually deallocate)';
        }
        blockEl.title = tooltip;

        // Add click handler for manual deallocation (optional - for educational purposes)
        if (block.isAllocated) {
            blockEl.style.cursor = 'pointer';
            blockEl.addEventListener('click', () => deallocateBlock(index, false));
        }

        els.memoryContainer.appendChild(blockEl);
        currentAddr += block.size;
    });
}

function renderQueue() {
    if (!els.processQueue) return;

    els.processQueue.innerHTML = '';
    // Only show processes that are not completed
    const activeProcesses = processQueue.filter(p => p.status !== 'completed');
    activeProcesses.forEach(p => {
        const pEl = document.createElement('div');
        
        // Set up base structure
        pEl.style.position = 'relative';
        pEl.style.overflow = 'hidden';
        
        const labelEl = document.createElement('span');
        labelEl.textContent = `P${p.id}`;
        const sizeEl = document.createElement('small');
        sizeEl.textContent = `${p.size}KB`;
        
        if (p.status === 'allocated') {
            pEl.className = 'queue-block allocated-process';
            pEl.style.background = 'linear-gradient(135deg, #3B82F6, #2563EB)';
            pEl.style.opacity = '0.9';
            // Show execution progress
            if (p.allocatedAt) {
                const elapsed = Date.now() - p.allocatedAt;
                const progress = Math.min(100, (elapsed / p.lifetime) * 100);
                const remaining = Math.max(0, p.lifetime - elapsed);
                const remainingSec = (remaining / 1000).toFixed(1);
                pEl.title = `Process P${p.id} running...\nTime remaining: ${remainingSec}s\n(Will auto-deallocate when complete)`;
                // Add visual progress indicator
                const progressBar = document.createElement('div');
                progressBar.style.position = 'absolute';
                progressBar.style.bottom = '0';
                progressBar.style.left = '0';
                progressBar.style.width = `${progress}%`;
                progressBar.style.height = '3px';
                progressBar.style.background = 'rgba(255, 255, 255, 0.6)';
                progressBar.style.transition = 'width 0.2s';
                progressBar.style.zIndex = '1';
                pEl.appendChild(progressBar);
            }
        } else if (p.status === 'terminated') {
            pEl.className = 'queue-block terminated-process';
            pEl.style.background = 'linear-gradient(135deg, #64748B, #475569)';
            pEl.style.opacity = '0.6';
            pEl.title = `Process P${p.id} terminated. Waiting to be re-allocated...`;
        } else if (p.status === 'failed') {
            pEl.className = 'queue-block failed-process';
            pEl.style.background = 'linear-gradient(135deg, #EF4444, #B91C1C)';
            pEl.style.animation = 'pulse-failed 2s ease-in-out infinite';
            const totalFree = memoryBlocks.filter(b => !b.isAllocated).reduce((sum, b) => sum + b.size, 0);
            pEl.title = `Process P${p.id} blocked - waiting for memory.\nRequired: ${p.size} KB\nFree memory: ${totalFree} KB\nWill retry automatically when memory becomes available.`;
        } else {
            pEl.className = 'queue-block';
            pEl.title = `Process P${p.id} waiting for allocation...`;
        }
        
        // Add content (z-index to appear above progress bar)
        labelEl.style.position = 'relative';
        labelEl.style.zIndex = '2';
        sizeEl.style.position = 'relative';
        sizeEl.style.zIndex = '2';
        pEl.appendChild(labelEl);
        pEl.appendChild(sizeEl);

        els.processQueue.appendChild(pEl);
    });
}

function updateStats() {
    const allocated = memoryBlocks.reduce((acc, b) => b.isAllocated ? acc + b.size : acc, 0);
    const free = memoryBlocks.reduce((acc, b) => !b.isAllocated ? acc + b.size : acc, 0);
    const allocatedCount = processQueue.filter(p => p.status === 'allocated').length;
    const completedCount = processQueue.filter(p => p.status === 'completed').length;
    const activeCount = processQueue.filter(p => p.status !== 'completed').length;

    // External fragmentation: Amount of free space that is NOT the single largest block (simplified definition for visualization)
    // Or strictly: Total Free Space (if we fail to allocate). 
    // Let's just show Free Space.
    let maxFreeBlock = 0;
    memoryBlocks.forEach(b => { if (!b.isAllocated && b.size > maxFreeBlock) maxFreeBlock = b.size });
    const extFrag = free - maxFreeBlock;

    if (els.statAllocated) els.statAllocated.textContent = `${allocated} KB`;
    if (els.statFragmentation) els.statFragmentation.textContent = `${extFrag} KB`;
    if (els.statProcesses) els.statProcesses.textContent = `${allocatedCount} / ${activeCount} (${completedCount} completed)`;
}

// OS Logic
function stepSimulation() {
    if (configDirty && !resetAlertShown) {
        showResetAlertOnce();
        return;
    }

    // First, try to allocate waiting processes
    let processIndex = processQueue.findIndex(p => p.status === 'waiting');
    
    // If no waiting processes, try to retry failed processes
    if (processIndex === -1) {
        processIndex = processQueue.findIndex(p => p.status === 'failed');
        if (processIndex !== -1) {
            // Retry failed process
            const failedProcess = processQueue[processIndex];
            failedProcess.status = 'waiting';
            setStatus(`Retrying failed Process P${failedProcess.id} (${failedProcess.size} KB)...`);
        }
    }
    
    if (processIndex === -1) {
        const hasAllocated = processQueue.some(p => p.status === 'allocated');
        const hasFailed = processQueue.some(p => p.status === 'failed');
        if (hasAllocated) {
            if (hasFailed) {
                setStatus("All processes allocated. Some processes are blocked. Waiting for memory to free...");
            } else {
                setStatus("All processes allocated. Waiting for processes to complete...");
            }
        } else if (hasFailed) {
            setStatus("All processes failed. Try Compact Memory or Reset.");
            stopAutoRun();
        } else {
            setStatus("All processes completed.");
            stopAutoRun();
        }
        return;
    }

    const process = processQueue[processIndex];
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
        const hasFreeMemory = memoryBlocks.some(b => !b.isAllocated);
        const totalFree = memoryBlocks.filter(b => !b.isAllocated).reduce((sum, b) => sum + b.size, 0);
        if (hasFreeMemory) {
            setStatus(`Allocation failed for P${process.id} (${process.size} KB). Insufficient contiguous memory. Free: ${totalFree} KB. Waiting for memory to free...`);
        } else {
            setStatus(`Allocation failed for P${process.id} (${process.size} KB). No free memory available. Try Compact Memory.`);
        }
        render();
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
    process.allocatedAt = Date.now(); // Track when process was allocated
    process.blockIndex = blockIndex; // Store reference for deallocation
    render();
    setStatus(`Process P${process.id} allocated to memory block at ${toHex(block.address)}. Running...`);
}

function deallocateBlock(blockIndex, isAutomatic = false) {
    const block = memoryBlocks[blockIndex];
    if (!block.isAllocated) return;

    const processId = block.processId;
    
    // Mark as deallocating for animation
    block.isDeallocating = true;
    render();
    
    // Find and update process status
    const process = processQueue.find(p => p.id === processId);
    if (process) {
        process.status = 'terminated';
        process.allocatedAt = null;
        delete process.blockIndex;
    }

    // Deallocate after animation delay
    setTimeout(() => {
        const originalAddress = block.address;
        block.isAllocated = false;
        block.processId = null;
        block.isDeallocating = false;
        block.isNew = true; // Trigger animation for free block
        
        // Merge adjacent free blocks
        mergeAdjacentFreeBlocks();
        
        render();
        const statusMsg = isAutomatic 
            ? `Process P${processId} completed execution and deallocated. Memory freed.`
            : `Process P${processId} deallocated. Memory freed (can be re-allocated).`;
        setStatus(statusMsg);
        
        // Mark process as completed and remove from queue
        if (process && isAutomatic) {
            process.status = 'completed';
            render();
        }
        
        // After deallocation, retry failed processes if memory is now available
        retryFailedProcesses();
    }, 400);
}

// Automatic deallocation checker - simulates OS process lifecycle
function startDeallocationChecker() {
    stopDeallocationChecker();
    deallocationInterval = setInterval(() => {
        if (isPaused) return; // Don't check if paused
        
        const now = Date.now();
        memoryBlocks.forEach((block, index) => {
            if (block.isAllocated && block.processId) {
                const process = processQueue.find(p => p.id === block.processId);
                if (process && process.allocatedAt && process.status === 'allocated') {
                    // Calculate elapsed time using the adjusted allocatedAt timestamp
                    const elapsed = now - process.allocatedAt;
                    if (elapsed >= process.lifetime) {
                        deallocateBlock(index, true); // Automatic deallocation
                    }
                }
            }
        });
    }, 300); // Check every 300ms (slower update rate)
}

function stopDeallocationChecker() {
    if (deallocationInterval) {
        clearInterval(deallocationInterval);
        deallocationInterval = null;
    }
}

function mergeAdjacentFreeBlocks() {
    let i = 0;
    while (i < memoryBlocks.length - 1) {
        const current = memoryBlocks[i];
        const next = memoryBlocks[i + 1];
        
        if (!current.isAllocated && !next.isAllocated) {
            // Merge blocks
            current.size += next.size;
            memoryBlocks.splice(i + 1, 1);
            current.isNew = true; // Animate merged block
        } else {
            i++;
        }
    }
}

// Retry failed processes when memory becomes available
function retryFailedProcesses() {
    if (isPaused || isRetrying) return;
    
    const failedProcesses = processQueue.filter(p => p.status === 'failed');
    if (failedProcesses.length === 0) return;
    
    isRetrying = true;
    
    // Check if any failed process can now be allocated (try one at a time)
    for (const process of failedProcesses) {
        let blockIndex = -1;
        
        // Use the same search logic as stepSimulation
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
            // Found memory, retry allocation
            const processIndex = processQueue.findIndex(p => p.id === process.id);
            if (processIndex !== -1) {
                process.status = 'waiting';
                setStatus(`Memory available! Retrying Process P${process.id}...`);
                // Small delay to show the retry message
                setTimeout(() => {
                    allocate(blockIndex, processIndex);
                    isRetrying = false;
                    // After allocation, check if there are more failed processes to retry
                    setTimeout(() => retryFailedProcesses(), 500);
                }, 300);
                return; // Only retry one at a time
            }
        }
    }
    
    isRetrying = false;
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

    // Re-check failed processes after compaction
    processQueue.forEach(p => {
        if (p.status === 'failed') p.status = 'waiting';
    });

    render();
    setStatus("Compaction Complete. Memory is contiguous. Retrying failed processes...");
    
    // Retry failed processes after compaction
    setTimeout(() => {
        retryFailedProcesses();
    }, 500);
}

// Auto Run
function toggleAutoRun() {
    if (configDirty && !resetAlertShown) {
        showResetAlertOnce();
        return;
    }
    // If paused, resume first
    if (isPaused) {
        resumeSimulation();
        return;
    }
    
    if (isAutoRunning) {
        endAutoRunAndReset();
    } else {
        startAutoRun();
    }
}

function startAutoRun() {
    isAutoRunning = true;
    isPaused = false;
    els.btnAuto.textContent = "End Auto Run";
    updateStopButton();
    startDeallocationChecker();
    stepSimulation();
    autoRunInterval = setInterval(() => {
        if (isPaused) return; // Don't run if paused
        
        // Continue allocating as long as there are waiting processes or failed processes that might be retried
        const hasWaiting = processQueue.some(p => p.status === 'waiting');
        const hasFailed = processQueue.some(p => p.status === 'failed');
        const hasAllocated = processQueue.some(p => p.status === 'allocated');
        
        if (hasWaiting) {
            stepSimulation();
        } else if (hasFailed && hasAllocated) {
            // There are failed processes but some are still running
            // They will be retried automatically when memory is freed
            // Don't call stepSimulation here, let deallocation trigger retry
        } else {
            // Check if all processes are done
            const allDone = processQueue.every(p => 
                p.status === 'completed' || 
                (p.status === 'failed' && !hasAllocated) // Only consider failed if nothing is running
            );
            if (allDone) {
                stopAutoRun();
                if (hasFailed) {
                    setStatus("All processes completed or failed. Some processes could not be allocated.");
                } else {
                    setStatus("All processes completed. Simulation finished.");
                }
            }
        }
    }, 2000); // Slower: 2 seconds between allocations
}

function stopAutoRun() {
    isAutoRunning = false;
    els.btnAuto.textContent = "Auto Run";
    clearInterval(autoRunInterval);
    stopDeallocationChecker();
    updateStopButton();
}

function endAutoRunAndReset() {
    // Stop auto-run and all timers
    stopAutoRun();
    isPaused = false;
    isRetrying = false;
    updateStopButton();
    
    // Deallocate all processes
    memoryBlocks.forEach((block) => {
        if (block.isAllocated) {
            block.isAllocated = false;
            block.processId = null;
            block.isNew = true;
        }
    });
    
    // Merge all free blocks to restore initial memory state
    mergeAdjacentFreeBlocks();
    
    // Clear the process queue (remove all processes)
    processQueue = [];
    
    // Re-render
    render();
    setStatus("Auto Run ended. All processes terminated. Memory reset and queue cleared.");
}

function togglePause() {
    if (isPaused) {
        resumeSimulation();
    } else {
        pauseSimulation();
    }
}

function pauseSimulation() {
    isPaused = true;
    pauseStartTime = Date.now(); // Record when pause started
    stopDeallocationChecker();
    
    // Store the elapsed time for each process when pausing
    // We'll use this to adjust timestamps when resuming
    processQueue.forEach(process => {
        if (process.status === 'allocated' && process.allocatedAt) {
            // Store how much time has elapsed before pause
            process.elapsedBeforePause = pauseStartTime - process.allocatedAt;
        }
    });
    
    updateStopButton();
    setStatus("Simulation paused. Process timers frozen. Click Continue to resume.");
}

function resumeSimulation() {
    if (!isPaused) return; // Already resumed
    
    const resumeTime = Date.now();
    
    // Adjust all allocated processes' timestamps so they continue from where they paused
    processQueue.forEach(process => {
        if (process.status === 'allocated' && process.allocatedAt && process.elapsedBeforePause !== undefined) {
            // Set allocatedAt to current time minus the elapsed time before pause
            // This makes the elapsed time calculation continue correctly
            process.allocatedAt = resumeTime - process.elapsedBeforePause;
            delete process.elapsedBeforePause; // Clean up
        }
    });
    
    isPaused = false;
    pauseStartTime = null;
    updateStopButton();
    
    // Always resume deallocation checker so processes can complete
    startDeallocationChecker();
    
    if (isAutoRunning) {
        setStatus("Simulation resumed. Process timers continue from paused state...");
    } else {
        setStatus("Simulation resumed. Process timers continue. Click Auto Run to continue allocation.");
    }
}

function updateStopButton() {
    if (els.btnStop) {
        if (isPaused) {
            els.btnStop.textContent = "Continue";
            els.btnStop.className = "btn btn-success";
        } else {
            els.btnStop.textContent = "Stop";
            els.btnStop.className = "btn btn-primary";
        }
    }
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
