// GLSL copied VERBATIM from the supplied package "trippy_effects_for_trippy_me" (SOFAKINGSADBOI), file webgl-shaders.js,
// class TrippyShaderController: shaders.liquidDistortion and shaders.fractalNoise. Nothing in the shader text was edited.
// Licence: the archive contains no licence file. It was supplied by the project owner for this game; confirm terms before any public redistribution.

export const LIQUID_VERTEX = `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;

        varying vec2 vTexCoord;

        void main() {
          vTexCoord = aTexCoord;
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `;

export const LIQUID_FRAGMENT = `
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
      `;

export const FRACTAL_VERTEX = `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;

        varying vec2 vTexCoord;

        void main() {
          vTexCoord = aTexCoord;
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `;

export const FRACTAL_FRAGMENT = `
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
      `;

