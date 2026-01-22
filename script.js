const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.querySelector('.browse-btn');
const fileInfoSection = document.getElementById('file-info-section');
const removeBtn = document.getElementById('remove-file');
const filenameDisplay = document.getElementById('filename');
const originalSizeDisplay = document.getElementById('original-size');
const targetSizeInput = document.getElementById('target-size-input');
const presetBtns = document.querySelectorAll('.preset-btn');
const processBtn = document.getElementById('process-btn');
const processingState = document.getElementById('processing-state');
const resultSection = document.getElementById('result-section');
const statusText = document.getElementById('status-text');
const finalSizeDisplay = document.getElementById('final-size-display');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');
const randomToggle = document.getElementById('random-data-toggle');

let currentFile = null;
let generatedBlob = null;

// Format bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Handle Drag & Drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

// Handle Click
dropZone.addEventListener('click', () => fileInput.click()); // Make whole zone clickable
fileInput.addEventListener('change', function () {
    handleFiles(this.files);
});

function handleFiles(files) {
    if (files.length > 0) {
        const file = files[0];
        if (file.type === 'application/pdf') {
            currentFile = file;
            updateUIWithFile(file);
        } else {
            alert('Please upload a PDF file.');
        }
    }
}

function updateUIWithFile(file) {
    filenameDisplay.textContent = file.name;
    originalSizeDisplay.textContent = `Original: ${formatBytes(file.size)}`;

    // Set default target size suggestion (e.g. original + 50MB rounded up)
    const currentMB = file.size / (1024 * 1024);
    targetSizeInput.min = Math.ceil(currentMB);
    // If current is huge, default + 10MB, else +50
    targetSizeInput.value = Math.ceil(currentMB) + 50;

    dropZone.classList.add('hidden');
    resultSection.classList.add('hidden');
    fileInfoSection.classList.remove('hidden');
}

// Remove File
removeBtn.addEventListener('click', () => {
    currentFile = null;
    generatedBlob = null;
    fileInput.value = '';
    dropZone.classList.remove('hidden');
    fileInfoSection.classList.add('hidden');
    resultSection.classList.add('hidden');

    // Reset presets
    presetBtns.forEach(btn => btn.classList.remove('active'));
});

// Presets
presetBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Remove active class from all
        presetBtns.forEach(b => b.classList.remove('active'));
        // Add to clicked
        e.target.classList.add('active');

        // Set value
        const targetSize = parseInt(e.target.dataset.size);
        targetSizeInput.value = targetSize;
    });
});

// Process
processBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    const targetMB = parseFloat(targetSizeInput.value);
    if (!targetMB || targetMB <= 0) {
        alert('Please enter a valid target size.');
        return;
    }

    const targetBytes = targetMB * 1024 * 1024;
    const currentBytes = currentFile.size;

    if (targetBytes <= currentBytes) {
        alert(`Target size must be larger than the original file size (${formatBytes(currentBytes)}).`);
        return;
    }

    // Recommended limit check (Browser memory)
    // Updated to prompt only above 2.5GB as 2GB is now a feature
    if (targetBytes > 2.5 * 1024 * 1024 * 1024) {
        if (!confirm("Warning: Creating extremely large files (>2.5GB) may crash some browsers. Continue?")) {
            return;
        }
    }

    fileInfoSection.classList.add('hidden');
    processingState.classList.remove('hidden');

    const useRandomData = randomToggle.checked;

    setTimeout(async () => {
        try {
            await inflatePdf(currentFile, targetBytes, useRandomData);
        } catch (error) {
            console.error(error);
            alert('An error occurred during processing: ' + error.message);
            processingState.classList.add('hidden');
            fileInfoSection.classList.remove('hidden');
        }
    }, 100);
});

async function inflatePdf(originalFile, targetSizeBytes, useRandomData) {
    const paddingNeeded = targetSizeBytes - originalFile.size;

    // Create chunks to avoid massive single array allocation
    const chunks = [originalFile];
    let remaining = paddingNeeded;
    const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks

    statusText.innerText = useRandomData ? "Generating high-entropy data..." : "Allocating dummy data...";

    // Pre-allocate a buffer to reuse
    let dataBuffer;

    if (useRandomData) {
        // Create a 50MB random buffer effectively?
        // Crypto.getRandomValues only supports up to 65536 bytes at a time usually.
        // So we fill a 10MB buffer with random chunks.
        const randomChunkSize = 10 * 1024 * 1024; // 10MB
        dataBuffer = new Uint8Array(randomChunkSize);

        // Fill efficiently
        const cryptoScale = 65536;
        for (let i = 0; i < randomChunkSize; i += cryptoScale) {
            const subArray = dataBuffer.subarray(i, Math.min(i + cryptoScale, randomChunkSize));
            window.crypto.getRandomValues(subArray);
        }
    } else {
        // Zero buffer (lazy allocation by OS usually, very fast)
        // Actually, we can just pass size to Blob? No, Blob constructor needs content.
        // We will repurpose one array of zeros.
        dataBuffer = new Uint8Array(CHUNK_SIZE);
    }

    // For random data, we use a smaller repeated buffer (10MB) to vary it slightly?
    // No, reusing the EXACT SAME 10MB random block 200 times means it will compress to 10MB + pointers.
    // That defeats the purpose of "Prevent Compression" for smart algorithms (like 7zip dedupe).
    // BUT, standard "Fast" zip often only looks back 32KB or so.
    // DEFLATE window size is usually 32KB.
    // So reusing a 10MB chunk IS SAFE from standard zip compression collapsing it, because the distance to the repeat is > 32KB.
    // So 10MB reusable random buffer is perfect.

    const bufferToUse = dataBuffer;
    const bufferSize = bufferToUse.length;


    while (remaining > 0) {
        const currentChunkSize = Math.min(remaining, bufferSize);

        if (currentChunkSize === bufferSize) {
            chunks.push(bufferToUse);
        } else {
            // Partial last chunk
            chunks.push(bufferToUse.subarray(0, currentChunkSize));
        }

        remaining -= currentChunkSize;

        // Yield to UI thread
        if (remaining % (200 * 1024 * 1024) <= bufferSize) { // Update approx every 200MB
            const percent = Math.round(((targetSizeBytes - remaining) / targetSizeBytes) * 100);
            statusText.innerText = `Generating... ${percent}%`;
            await new Promise(r => setTimeout(r, 0));
        }
    }

    statusText.innerText = "Assembling PDF...";
    generatedBlob = new Blob(chunks, { type: 'application/pdf' });

    processingState.classList.add('hidden');
    resultSection.classList.remove('hidden');
    finalSizeDisplay.textContent = formatBytes(generatedBlob.size);
}

// Download
downloadBtn.addEventListener('click', () => {
    if (!generatedBlob) return;

    const url = URL.createObjectURL(generatedBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = "inflated_" + currentFile.name;
    document.body.appendChild(a);
    a.click();

    // Cleanup URL after small delay
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
});

// Reset
resetBtn.addEventListener('click', () => {
    resultSection.classList.add('hidden');
    dropZone.classList.remove('hidden');
    currentFile = null;
    generatedBlob = null;
    fileInput.value = '';
    presetBtns.forEach(btn => btn.classList.remove('active'));
    targetSizeInput.value = '';
    randomToggle.checked = false;
});
