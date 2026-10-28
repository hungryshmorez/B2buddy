/**
 * Datamoshing Effects
 *
 * This script simulates datamoshing effects on videos and images,
 * creating the glitchy, corrupted digital look associated with
 * compression artifacts and data corruption.
 */

class DatamoshEffect {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.width = 0;
    this.height = 0;
    this.animationId = null;
    this.glitchIntensity = 0.5;
    this.initialized = false;
    this.frameCount = 0;
    this.lastFrameImageData = null;
    this.glitchInterval = null;
    this.activeElements = new Map(); // Map of elements to their state
    this.isRandomGlitching = true;

    // Glitch effect settings
    this.settings = {
      sliceMin: 1,
      sliceMax: 20,
      offsetMin: 5,
      offsetMax: 20,
      rgbSplitProb: 0.3,
      blockMoveProb: 0.4,
      pixelSortProb: 0.2,
      noiseProb: 0.3,
      compressionProb: 0.2,
      autoglitchInterval: [2000, 5000], // ms range between random glitches
      glitchDuration: [100, 500], // ms range for glitch duration
      heavyGlitchProb: 0.1 // probability of a more extreme glitch
    };

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
      this.initialize();
    });
  }

  initialize() {
    if (this.initialized) return;

    this.findDatamoshElements();
    this.setupEventListeners();
    this.setupAutoGlitch();

    this.initialized = true;
  }

  findDatamoshElements() {
    // Find all elements with the datamosh class
    const elements = document.querySelectorAll('.datamosh');

    elements.forEach(el => {
      // Skip elements already processed
      if (this.activeElements.has(el)) return;

      // Setup datamosh effect for this element
      this.setupElementForDatamosh(el);
    });
  }

  setupElementForDatamosh(element) {
    // Create a canvas for this element
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Position canvas over the element
    const rect = element.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '1';

    // Make the element position relative if it's not already
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.position === 'static') {
      element.style.position = 'relative';
    }

    // Create a wrapper for the canvas if necessary
    element.appendChild(canvas);

    // Store reference to the element and its state
    this.activeElements.set(element, {
      canvas,
      ctx,
      lastImageData: null,
      isGlitching: false,
      glitchTimeout: null,
      sourceElement: element.tagName === 'VIDEO' || element.tagName === 'IMG' ?
                    element : element.querySelector('video, img'),
      type: element.tagName === 'VIDEO' ? 'video' : 'image'
    });

    // Add click event to trigger manual glitch
    element.addEventListener('click', () => {
      this.triggerGlitch(element);
    });

    // For videos, draw the video frames to the canvas
    if (element.tagName === 'VIDEO') {
      element.addEventListener('play', () => {
        this.startVideoProcessing(element);
      });

      element.addEventListener('pause', () => {
        this.stopVideoProcessing(element);
      });

      element.addEventListener('ended', () => {
        this.stopVideoProcessing(element);
      });

      // Start processing immediately if the video is already playing
      if (element.paused === false) {
        this.startVideoProcessing(element);
      }
    } else {
      // For static images, just draw once and add interaction
      const sourceElement = element.tagName === 'IMG' ?
                           element : element.querySelector('img');

      if (sourceElement) {
        // Draw image to canvas once loaded
        if (sourceElement.complete) {
          this.drawInitialImage(element, sourceElement);
        } else {
          sourceElement.addEventListener('load', () => {
            this.drawInitialImage(element, sourceElement);
          });
        }
      }
    }
  }

  drawInitialImage(element, sourceElement) {
    const state = this.activeElements.get(element);
    if (!state) return;

    const { ctx, canvas } = state;

    // Draw image to canvas
    ctx.drawImage(sourceElement, 0, 0, canvas.width, canvas.height);

    // Store image data
    state.lastImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  startVideoProcessing(element) {
    const state = this.activeElements.get(element);
    if (!state) return;

    const processFrame = () => {
      if (!this.activeElements.has(element)) return;

      const { ctx, canvas, sourceElement } = state;

      // Draw video frame to canvas
      ctx.drawImage(sourceElement, 0, 0, canvas.width, canvas.height);

      // Store frame data
      state.lastImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Request next frame
      state.animationId = requestAnimationFrame(processFrame);
    };

    // Start processing frames
    state.animationId = requestAnimationFrame(processFrame);
  }

  stopVideoProcessing(element) {
    const state = this.activeElements.get(element);
    if (!state || !state.animationId) return;

    cancelAnimationFrame(state.animationId);
    state.animationId = null;
  }

  setupEventListeners() {
    // Watch for new elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          this.findDatamoshElements();
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.activeElements.forEach((state, element) => {
        const rect = element.getBoundingClientRect();
        state.canvas.width = rect.width;
        state.canvas.height = rect.height;

        // Redraw for static images
        if (state.type === 'image') {
          const sourceElement = state.sourceElement;
          if (sourceElement && sourceElement.complete) {
            this.drawInitialImage(element, sourceElement);
          }
        }
      });
    });
  }

  setupAutoGlitch() {
    if (this.glitchInterval) {
      clearInterval(this.glitchInterval);
    }

    // Set up random glitching
    this.glitchInterval = setInterval(() => {
      if (!this.isRandomGlitching) return;

      // Randomly choose an element to glitch
      const elements = Array.from(this.activeElements.keys());
      if (elements.length === 0) return;

      const randomElement = elements[Math.floor(Math.random() * elements.length)];
      this.triggerGlitch(randomElement);

    }, this.getRandomRange(this.settings.autoglitchInterval));
  }

  triggerGlitch(element) {
    const state = this.activeElements.get(element);
    if (!state || state.isGlitching) return;

    // Mark as glitching
    state.isGlitching = true;

    // Determine glitch duration
    const duration = this.getRandomRange(this.settings.glitchDuration);

    // Apply glitch effect
    this.applyGlitchEffect(element);

    // Set timeout to stop glitching
    state.glitchTimeout = setTimeout(() => {
      state.isGlitching = false;

      // For static images, restore the original
      if (state.type === 'image' && state.sourceElement) {
        this.drawInitialImage(element, state.sourceElement);
      }
    }, duration);
  }

  applyGlitchEffect(element) {
    const state = this.activeElements.get(element);
    if (!state || !state.lastImageData) return;

    const { ctx, canvas, lastImageData } = state;

    // Make a copy of the original image data
    const imageData = new ImageData(
      new Uint8ClampedArray(lastImageData.data),
      lastImageData.width,
      lastImageData.height
    );

    // Apply various glitch effects based on probabilities
    const heavyGlitch = Math.random() < this.settings.heavyGlitchProb;
    const intensity = heavyGlitch ? this.glitchIntensity * 2 : this.glitchIntensity;

    // Horizontal slices
    if (Math.random() < 0.8) {
      this.applyHorizontalSlices(imageData, intensity);
    }

    // RGB split
    if (Math.random() < this.settings.rgbSplitProb) {
      this.applyRGBSplit(imageData, intensity);
    }

    // Block movement
    if (Math.random() < this.settings.blockMoveProb) {
      this.applyBlockMovement(imageData, intensity);
    }

    // Pixel sorting
    if (Math.random() < this.settings.pixelSortProb) {
      this.applyPixelSorting(imageData, intensity);
    }

    // Add noise
    if (Math.random() < this.settings.noiseProb) {
      this.applyNoise(imageData, intensity);
    }

    // Compression artifacts
    if (Math.random() < this.settings.compressionProb) {
      this.applyCompressionArtifacts(imageData, intensity);
    }

    // Put the modified data back to the canvas
    ctx.putImageData(imageData, 0, 0);
  }

  applyHorizontalSlices(imageData, intensity) {
    const { width, height, data } = imageData;

    // Determine number of slices
    const sliceCount = Math.floor(this.getRandomRange([
      this.settings.sliceMin,
      this.settings.sliceMax * intensity
    ]));

    // Apply slices
    for (let i = 0; i < sliceCount; i++) {
      // Random slice position and height
      const sliceY = Math.floor(Math.random() * height);
      const sliceHeight = Math.floor(Math.random() * 10) + 1;

      // Random x offset
      const xOffset = Math.floor(this.getRandomRange([
        -this.settings.offsetMax * intensity,
        this.settings.offsetMax * intensity
      ]));

      // Process the slice
      for (let y = sliceY; y < Math.min(sliceY + sliceHeight, height); y++) {
        for (let x = 0; x < width; x++) {
          // Source position
          const srcX = (x - xOffset + width) % width;

          // Calculate indices
          const targetIdx = (y * width + x) * 4;
          const sourceIdx = (y * width + srcX) * 4;

          // Copy pixels with offset
          data[targetIdx] = data[sourceIdx];         // R
          data[targetIdx + 1] = data[sourceIdx + 1]; // G
          data[targetIdx + 2] = data[sourceIdx + 2]; // B
          // Keep alpha the same: data[targetIdx + 3] = data[sourceIdx + 3];
        }
      }
    }
  }

  applyRGBSplit(imageData, intensity) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);

    // Copy original data
    output.set(data);

    // RGB channel offsets
    const redOffset = Math.floor(intensity * this.settings.offsetMax * (Math.random() - 0.5));
    const greenOffset = Math.floor(intensity * this.settings.offsetMax * (Math.random() - 0.5));
    const blueOffset = Math.floor(intensity * this.settings.offsetMax * (Math.random() - 0.5));

    // Apply offset to each channel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Calculate source positions with offsets
        const redX = Math.max(0, Math.min(width - 1, x + redOffset));
        const greenX = Math.max(0, Math.min(width - 1, x + greenOffset));
        const blueX = Math.max(0, Math.min(width - 1, x + blueOffset));

        const redIdx = (y * width + redX) * 4;
        const greenIdx = (y * width + greenX) * 4;
        const blueIdx = (y * width + blueX) * 4;

        // Set new RGB values
        output[(y * width + x) * 4] = data[redIdx];     // R
        output[(y * width + x) * 4 + 1] = data[greenIdx + 1]; // G
        output[(y * width + x) * 4 + 2] = data[blueIdx + 2];  // B
        // Alpha stays the same
      }
    }

    // Update image data
    imageData.data.set(output);
  }

  applyBlockMovement(imageData, intensity) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);

    // Copy original data
    output.set(data);

    // Create random blocks and move them
    const blockCount = Math.floor(intensity * 5) + 1;

    for (let i = 0; i < blockCount; i++) {
      // Define random block
      const blockWidth = Math.floor(Math.random() * width * 0.3) + 10;
      const blockHeight = Math.floor(Math.random() * height * 0.3) + 10;
      const srcX = Math.floor(Math.random() * (width - blockWidth));
      const srcY = Math.floor(Math.random() * (height - blockHeight));

      // Define destination with offset
      const dstX = Math.floor(srcX + (Math.random() - 0.5) * width * 0.2);
      const dstY = Math.floor(srcY + (Math.random() - 0.5) * height * 0.2);

      // Copy block
      for (let y = 0; y < blockHeight; y++) {
        for (let x = 0; x < blockWidth; x++) {
          const targetX = dstX + x;
          const targetY = dstY + y;

          // Skip if outside bounds
          if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;

          const srcIdx = ((srcY + y) * width + (srcX + x)) * 4;
          const dstIdx = (targetY * width + targetX) * 4;

          // Copy pixel
          output[dstIdx] = data[srcIdx];     // R
          output[dstIdx + 1] = data[srcIdx + 1]; // G
          output[dstIdx + 2] = data[srcIdx + 2]; // B
          output[dstIdx + 3] = data[srcIdx + 3]; // A
        }
      }
    }

    // Update image data
    imageData.data.set(output);
  }

  applyPixelSorting(imageData, intensity) {
    const { width, height, data } = imageData;

    // Choose random horizontal segments to sort
    const segmentCount = Math.floor(intensity * 5) + 1;

    for (let i = 0; i < segmentCount; i++) {
      // Random row and segment length
      const row = Math.floor(Math.random() * height);
      const startCol = Math.floor(Math.random() * (width / 2));
      const length = Math.floor(Math.random() * (width / 2)) + width / 4;

      // Extract pixel values from the segment
      const pixels = [];

      for (let x = startCol; x < Math.min(startCol + length, width); x++) {
        const idx = (row * width + x) * 4;
        pixels.push({
          r: data[idx],
          g: data[idx + 1],
          b: data[idx + 2],
          a: data[idx + 3],
          brightness: (data[idx] + data[idx + 1] + data[idx + 2]) / 3
        });
      }

      // Sort pixels by brightness
      pixels.sort((a, b) => a.brightness - b.brightness);

      // Write sorted pixels back
      for (let j = 0; j < pixels.length; j++) {
        const x = startCol + j;
        const idx = (row * width + x) * 4;
        const pixel = pixels[j];

        data[idx] = pixel.r;     // R
        data[idx + 1] = pixel.g; // G
        data[idx + 2] = pixel.b; // B
        data[idx + 3] = pixel.a; // A
      }
    }
  }

  applyNoise(imageData, intensity) {
    const { width, height, data } = imageData;

    // Add random noise to pixels
    const noiseAmount = intensity * 50;

    for (let i = 0; i < data.length; i += 4) {
      if (Math.random() < intensity * 0.1) {
        // Add noise to RGB channels
        data[i] = Math.max(0, Math.min(255, data[i] + (Math.random() - 0.5) * noiseAmount));     // R
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + (Math.random() - 0.5) * noiseAmount)); // G
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + (Math.random() - 0.5) * noiseAmount)); // B
      }
    }
  }

  applyCompressionArtifacts(imageData, intensity) {
    const { width, height, data } = imageData;

    // Simulating compression artifacts by creating blocks of uniform color
    const blockSize = Math.floor(intensity * 8) + 2; // 2-10px blocks

    for (let y = 0; y < height; y += blockSize) {
      for (let x = 0; x < width; x += blockSize) {
        // Skip blocks randomly
        if (Math.random() > intensity * 0.3) continue;

        // Get a random pixel from the block
        const sampleX = Math.min(x + Math.floor(Math.random() * blockSize), width - 1);
        const sampleY = Math.min(y + Math.floor(Math.random() * blockSize), height - 1);

        const sampleIdx = (sampleY * width + sampleX) * 4;
        const r = data[sampleIdx];
        const g = data[sampleIdx + 1];
        const b = data[sampleIdx + 2];

        // Apply the color to the entire block
        for (let by = 0; by < blockSize && y + by < height; by++) {
          for (let bx = 0; bx < blockSize && x + bx < width; bx++) {
            const idx = ((y + by) * width + (x + bx)) * 4;

            data[idx] = r;     // R
            data[idx + 1] = g; // G
            data[idx + 2] = b; // B
            // Alpha stays the same
          }
        }
      }
    }
  }

  getRandomRange(range) {
    if (Array.isArray(range)) {
      return range[0] + Math.random() * (range[1] - range[0]);
    }
    return range;
  }

  setGlitchIntensity(value) {
    this.glitchIntensity = Math.max(0, Math.min(1, value));
  }

  toggleRandomGlitching(enabled) {
    this.isRandomGlitching = enabled;

    if (enabled && !this.glitchInterval) {
      this.setupAutoGlitch();
    } else if (!enabled && this.glitchInterval) {
      clearInterval(this.glitchInterval);
      this.glitchInterval = null;
    }
  }

  triggerGlitchAll() {
    this.activeElements.forEach((_, element) => {
      this.triggerGlitch(element);
    });
  }
}

// Initialize datamosh effect
const datamoshEffect = new DatamoshEffect();

// Export for use in other scripts
window.datamoshEffect = datamoshEffect;