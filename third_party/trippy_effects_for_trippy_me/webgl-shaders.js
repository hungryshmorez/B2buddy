/**
 * WebGL Shader Effects for Trippy Visual Experiences
 *
 * This module contains various WebGL shaders designed to create
 * advanced psychedelic visual effects on images and videos.
 */

// Main shader controller
class TrippyShaderController {
  constructor() {
    this.canvases = [];
    this.shaders = {};
    this.activeShaders = new Map();

    // Initialize shaders
    this.initShaders();

    // Setup on page load
    document.addEventListener('DOMContentLoaded', () => {
      this.setupShaderElements();
    });
  }

  initShaders() {
    // Liquid Distortion Shader
    this.shaders.liquidDistortion = {
      vertex: `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;

        varying vec2 vTexCoord;

        void main() {
          vTexCoord = aTexCoord;
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `,
      fragment: `
        precision mediump float;

        uniform sampler2D uTexture;
        uniform float uTime;
        uniform vec2 uResolution;

        varying vec2 vTexCoord;

        void main() {
          vec2 uv = vTexCoord;

          // Liquid distortion effect
          float distortionStrength = 0.05;
          float speed = 0.2;

          float distX = sin(uv.y * 10.0 + uTime * speed) * distortionStrength;
          float distY = cos(uv.x * 10.0 + uTime * speed) * distortionStrength;

          vec2 distortedUV = vec2(
            uv.x + distX,
            uv.y + distY
          );

          // Add chromatic aberration
          float r = texture2D(uTexture, distortedUV + vec2(0.01, 0.0)).r;
          float g = texture2D(uTexture, distortedUV).g;
          float b = texture2D(uTexture, distortedUV - vec2(0.01, 0.0)).b;

          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `
    };

    // Fractal Noise Shader
    this.shaders.fractalNoise = {
      vertex: `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;

        varying vec2 vTexCoord;

        void main() {
          vTexCoord = aTexCoord;
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `,
      fragment: `
        precision mediump float;

        uniform sampler2D uTexture;
        uniform float uTime;
        uniform vec2 uResolution;

        varying vec2 vTexCoord;

        // Simplex noise functions
        vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

        float snoise(vec2 v){
          const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                             -0.577350269189626, 0.024390243902439);
          vec2 i  = floor(v + dot(v, C.yy) );
          vec2 x0 = v -   i + dot(i, C.xx);
          vec2 i1;
          i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod(i, 289.0);
          vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
          + i.x + vec3(0.0, i1.x, 1.0 ));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
            dot(x12.zw,x12.zw)), 0.0);
          m = m*m ;
          m = m*m ;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 ox = floor(x + 0.5);
          vec3 a0 = x - ox;
          m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
          vec3 g;
          g.x  = a0.x  * x0.x  + h.x  * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        float fbm(vec2 uv) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 2.0;

          for (int i = 0; i < 5; i++) {
            value += amplitude * snoise(uv * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
          }

          return value;
        }

        void main() {
          vec2 uv = vTexCoord;

          // Fractal Brownian Motion distortion
          float noise = fbm(uv * 3.0 + uTime * 0.1);

          // Apply distortion
          uv += noise * 0.05;

          // Sample the original texture
          vec4 texColor = texture2D(uTexture, uv);

          // Add glow based on brightness
          float brightness = (texColor.r + texColor.g + texColor.b) / 3.0;
          vec4 glowColor = vec4(
            texColor.r + brightness * 0.2,
            texColor.g + brightness * 0.1,
            texColor.b + brightness * 0.3,
            texColor.a
          );

          gl_FragColor = glowColor;
        }
      `
    };
  }

  setupShaderElements() {
    // Find all elements with shader effect class
    const elements = document.querySelectorAll('.webgl-shader');

    elements.forEach(element => {
      // Get shader type from data attribute (default to liquidDistortion)
      const shaderType = element.dataset.shaderType || 'liquidDistortion';

      if (!this.shaders[shaderType]) {
        console.warn(`Shader type ${shaderType} not found`);
        return;
      }

      // Create canvas element to render shader
      const canvas = document.createElement('canvas');
      canvas.classList.add('shader-canvas');
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '1';

      // Position the element container relatively if not already
      if (getComputedStyle(element).position === 'static') {
        element.style.position = 'relative';
      }

      // Add canvas to element
      element.appendChild(canvas);

      // Initialize the shader
      this.initShaderCanvas(canvas, shaderType, element);
    });
  }

  initShaderCanvas(canvas, shaderType, targetElement) {
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    if (!gl) {
      console.warn('WebGL not supported');
      return;
    }

    // Create shader program
    const program = this.createShaderProgram(gl, this.shaders[shaderType].vertex, this.shaders[shaderType].fragment);

    // Create plane geometry
    const vertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
       1.0,  1.0
    ]);

    const texCoords = new Float32Array([
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0
    ]);

    // Create buffers
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    // Get attribute locations
    const positionLocation = gl.getAttribLocation(program, 'aPosition');
    const texCoordLocation = gl.getAttribLocation(program, 'aTexCoord');

    // Get uniform locations
    const textureLocation = gl.getUniformLocation(program, 'uTexture');
    const timeLocation = gl.getUniformLocation(program, 'uTime');
    const resolutionLocation = gl.getUniformLocation(program, 'uResolution');

    // Create texture from target element
    let texture;
    let sourceElement;

    // Identify the source element (image or video)
    if (targetElement.tagName === 'IMG') {
      sourceElement = targetElement;
    } else {
      sourceElement = targetElement.querySelector('img, video');
    }

    if (!sourceElement) {
      console.warn('No source image or video found for shader');
      return;
    }

    // Set crossOrigin attribute for images to handle CORS
    if (sourceElement.tagName === 'IMG' && !sourceElement.hasAttribute('crossorigin')) {
      sourceElement.crossOrigin = 'anonymous';
      
      // If the image is already loaded, we need to reload it with the crossorigin attribute
      if (sourceElement.complete) {
        const originalSrc = sourceElement.src;
        sourceElement.src = '';
        setTimeout(() => {
          sourceElement.src = originalSrc;
        }, 0);
      }
    }

    // Create and set up texture
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Store everything needed for rendering
    const shaderContext = {
      gl,
      program,
      vertexBuffer,
      texCoordBuffer,
      positionLocation,
      texCoordLocation,
      textureLocation,
      timeLocation,
      resolutionLocation,
      texture,
      sourceElement,
      canvas,
      startTime: performance.now()
    };

    // Store in the active shaders map
    this.activeShaders.set(canvas, shaderContext);

    // Setup resize handling
    this.resizeCanvas(shaderContext);
    window.addEventListener('resize', () => this.resizeCanvas(shaderContext));

    // Start animation loop
    this.animateShader(shaderContext);
  }

  createShaderProgram(gl, vertexShaderSource, fragmentShaderSource) {
    // Create shaders
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error('Vertex shader compilation failed:', gl.getShaderInfoLog(vertexShader));
      return null;
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error('Fragment shader compilation failed:', gl.getShaderInfoLog(fragmentShader));
      return null;
    }

    // Create program and link shaders
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader program linking failed:', gl.getProgramInfoLog(program));
      return null;
    }

    return program;
  }

  resizeCanvas(shaderContext) {
    const { canvas, gl, resolutionLocation } = shaderContext;

    // Get the device pixel ratio
    const pixelRatio = window.devicePixelRatio || 1;

    // Get the display size of the container
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    // Set the canvas size with the device pixel ratio taken into account
    canvas.width = displayWidth * pixelRatio;
    canvas.height = displayHeight * pixelRatio;

    // Set the viewport to match
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Update the resolution uniform if it exists
    if (resolutionLocation) {
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    }
  }

  animateShader(shaderContext) {
    const {
      gl, program, vertexBuffer, texCoordBuffer,
      positionLocation, texCoordLocation, textureLocation,
      timeLocation, texture, sourceElement, canvas, startTime
    } = shaderContext;

    // Use the shader program
    gl.useProgram(program);

    // Set up the position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Set up the texture coordinate attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    // Set up the texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceElement);
    } catch (error) {
      console.warn('WebGL texture error:', error.message);
      // Use a fallback color instead of failing
      const pixel = new Uint8Array([255, 0, 255, 255]);  // Magenta pixel as fallback
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    
    gl.uniform1i(textureLocation, 0);

    // Set time uniform
    if (timeLocation) {
      const currentTime = (performance.now() - startTime) / 1000.0; // Time in seconds
      gl.uniform1f(timeLocation, currentTime);
    }

    // Draw the quad
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Continue animation loop
    requestAnimationFrame(() => this.animateShader(shaderContext));
  }
}

// Initialize the shader controller
const trippyShaders = new TrippyShaderController();

// Export for use in other scripts
window.trippyShaders = trippyShaders;