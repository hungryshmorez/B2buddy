export const vsSource = `
    attribute vec4 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = a_position;
        v_texCoord = a_texCoord;
    }
`;

export const fsPassthroughSource = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_textureToDraw;
    void main() {
        gl_FragColor = texture2D(u_textureToDraw, v_texCoord);
    }
`;

export const datamoshShader = `
    precision highp float; varying vec2 v_texCoord;
    uniform sampler2D u_webcamTexture; uniform sampler2D u_previousFrameTexture;
    uniform float u_time; uniform float u_motionThreshold; uniform float u_trailPersistence;
    uniform float u_hueShiftSpeed; uniform float u_motionExtrapolation;
    uniform float u_intensity; uniform float u_displacement; uniform float u_feedback;
    uniform float u_brightness; uniform float u_contrast; uniform float u_saturation;

    float random (vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123 + u_time * 0.01); }
    float noise (vec2 st) { vec2 i = floor(st); vec2 f = fract(st); float a = random(i); float b = random(i + vec2(1.,0.)); float c = random(i + vec2(0.,1.)); float d = random(i + vec2(1.,1.)); vec2 u = f*f*(3.0-2.0*f); return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y; }
    vec3 rgb2hsl(vec3 color) { float r = color.r; float g = color.g; float b = color.b; float maxC = max(max(r, g), b); float minC = min(min(r, g), b); float h = 0.0, s = 0.0, l = (maxC + minC) / 2.0; if (maxC == minC) { h = s = 0.0; } else { float d = maxC - minC; s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC); if (maxC == r) { h = (g - b) / d + (g < b ? 6.0 : 0.0); } else if (maxC == g) { h = (b - r) / d + 2.0; } else if (maxC == b) { h = (r - g) / d + 4.0; } h /= 6.0; } return vec3(h, s, l); }
    float hue2rgb(float p, float q, float t) { if(t < 0.0) t += 1.0; if(t > 1.0) t -= 1.0; if(t < 1.0/6.0) return p + (q - p) * 6.0 * t; if(t < 1.0/2.0) return q; if(t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0; return p; }
    vec3 hsl2rgb(vec3 hsl) { float h = hsl.x; float s = hsl.y; float l = hsl.z; float r, g, b; if(s == 0.0){ r = g = b = l; } else { float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s; float p = 2.0 * l - q; r = hue2rgb(p, q, h + 1.0/3.0); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1.0/3.0); } return vec3(r, g, b); }

    vec3 adjustBrightnessContrast(vec3 color, float brightness, float contrast) {
        vec3 result = color + brightness;
        result = (result - 0.5) * contrast + 0.5;
        return clamp(result, 0.0, 1.0);
    }

    vec3 adjustSaturation(vec3 color, float saturation) {
        vec3 gray = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
        return mix(gray, color, saturation);
    }

    void main() {
        vec2 mirroredTexCoord = vec2(1.0 - v_texCoord.x, v_texCoord.y);
        vec4 currentWebcamColor = texture2D(u_webcamTexture, mirroredTexCoord);
        vec4 previousOrStaticColor = texture2D(u_previousFrameTexture, v_texCoord);
        float difference = length(currentWebcamColor.rgb - previousOrStaticColor.rgb);
        vec4 finalColor; vec4 motionDerivedColor; vec4 staticDerivedColor;

        // Enhanced displacement with intensity parameter
        float displacementAmount = u_displacement * (1.0 + u_intensity * 2.0);
        vec2 R_offset = vec2(random(mirroredTexCoord.yx + u_time * 0.1) - 0.5) * displacementAmount;
        vec2 B_offset = vec2(random(mirroredTexCoord.xy - u_time * 0.1) - 0.5) * displacementAmount;

        motionDerivedColor = vec4(
            texture2D(u_webcamTexture, mirroredTexCoord + R_offset).r,
            currentWebcamColor.g,
            texture2D(u_webcamTexture, mirroredTexCoord + B_offset).b,
            1.0
        );

        // Enhanced smear with feedback
        vec2 smearOffset = vec2(noise(v_texCoord*8.0 + u_time*0.05)-0.5) * 0.003 * (1.0 + u_feedback * 3.0);
        vec4 smearedPreviousOrStatic = texture2D(u_previousFrameTexture, v_texCoord + smearOffset);

        // Trail persistence adjusted by intensity
        float adjustedTrailPersistence = clamp(u_trailPersistence * (1.0 + u_intensity * 0.5), 0.0, 1.0);
        staticDerivedColor = mix(currentWebcamColor, smearedPreviousOrStatic, clamp(adjustedTrailPersistence, 0.0, 100.0));

        if (difference > u_motionThreshold) {
            finalColor = mix(staticDerivedColor, motionDerivedColor, 0.85 * (1.0 + u_intensity * 0.3));
        } else {
            finalColor = staticDerivedColor;
        }

        if (u_motionExtrapolation > 0.0) {
            vec2 pseudoVelocityOffset = vec2(noise(v_texCoord*8.0 + u_time*0.05)-0.5) * 0.003 * (1.0 + u_feedback);
            vec2 extrapolatedCoord = v_texCoord + pseudoVelocityOffset * u_motionExtrapolation;
            vec4 extrapolatedColor = texture2D(u_previousFrameTexture, extrapolatedCoord);
            float extrapolationMix = u_motionExtrapolation * smoothstep(u_motionThreshold + 0.05, u_motionThreshold - 0.05, difference);
            extrapolationMix = clamp(extrapolationMix, 0.0, 0.9);
            finalColor = mix(finalColor, extrapolatedColor, extrapolationMix);
        }

        if (u_hueShiftSpeed != 0.0) {
            vec3 hsl = rgb2hsl(finalColor.rgb);
            hsl.x = fract(hsl.x + u_time * u_hueShiftSpeed);
            if (hsl.y < 0.1) { hsl.y = 0.7; }
            finalColor.rgb = hsl2rgb(hsl);
        }

        // Apply brightness, contrast, and saturation adjustments
        finalColor.rgb = adjustSaturation(
            adjustBrightnessContrast(finalColor.rgb, u_brightness, u_contrast),
            u_saturation
        );

        finalColor = clamp(finalColor, 0.0, 1.0);
        if (finalColor.a < 0.01) discard;
        gl_FragColor = finalColor;
    }
`;

export const pixelSortShader = `
    precision highp float; varying vec2 v_texCoord;
    uniform sampler2D u_webcamTexture; uniform sampler2D u_previousFrameTexture;
    uniform float u_time; uniform float u_motionThreshold; uniform float u_trailPersistence;
    uniform float u_hueShiftSpeed; uniform float u_motionExtrapolation;
    uniform float u_intensity; uniform float u_displacement; uniform float u_feedback;
    uniform float u_threshold; uniform float u_brightness; uniform float u_contrast; uniform float u_saturation;

    float random (vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123 + u_time * 0.01); }
    float noise (vec2 st) { vec2 i = floor(st); vec2 f = fract(st); float a = random(i); float b = random(i + vec2(1.,0.)); float c = random(i + vec2(0.,1.)); float d = random(i + vec2(1.,1.)); vec2 u = f*f*(3.0-2.0*f); return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y; }
    vec3 rgb2hsl(vec3 color) { float r = color.r; float g = color.g; float b = color.b; float maxC = max(max(r, g), b); float minC = min(min(r, g), b); float h = 0.0, s = 0.0, l = (maxC + minC) / 2.0; if (maxC == minC) { h = s = 0.0; } else { float d = maxC - minC; s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC); if (maxC == r) { h = (g - b) / d + (g < b ? 6.0 : 0.0); } else if (maxC == g) { h = (b - r) / d + 2.0; } else if (maxC == b) { h = (r - g) / d + 4.0; } h /= 6.0; } return vec3(h, s, l); }
    float hue2rgb(float p, float q, float t) { if(t < 0.0) t += 1.0; if(t > 1.0) t -= 1.0; if(t < 1.0/6.0) return p + (q - p) * 6.0 * t; if(t < 1.0/2.0) return q; if(t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0; return p; }
    vec3 hsl2rgb(vec3 hsl) { float h = hsl.x; float s = hsl.y; float l = hsl.z; float r, g, b; if(s == 0.0){ r = g = b = l; } else { float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s; float p = 2.0 * l - q; r = hue2rgb(p, q, h + 1.0/3.0); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1.0/3.0); } return vec3(r, g, b); }

    vec3 adjustBrightnessContrast(vec3 color, float brightness, float contrast) {
        vec3 result = color + brightness;
        result = (result - 0.5) * contrast + 0.5;
        return clamp(result, 0.0, 1.0);
    }

    vec3 adjustSaturation(vec3 color, float saturation) {
        vec3 gray = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
        return mix(gray, color, saturation);
    }

    void main() {
        vec2 mirroredTexCoord = vec2(1.0 - v_texCoord.x, v_texCoord.y);
        vec4 currentWebcamColor = texture2D(u_webcamTexture, mirroredTexCoord);
        vec4 previousOrStaticColor = texture2D(u_previousFrameTexture, v_texCoord);

        float brightness = dot(currentWebcamColor.rgb, vec3(0.299, 0.587, 0.114));

        // Pixel sort based on brightness threshold and direction
        vec2 sortDir = vec2(0.0, 1.0); // Sort vertically
        if (sin(u_time * 0.1) > 0.0) {
            sortDir = vec2(1.0, 0.0); // Sometimes sort horizontally
        }

        // Adjust threshold based on intensity
        float adjustedThreshold = u_threshold * (1.0 + u_intensity * 0.5);

        // Sort pixel if brightness meets threshold
        vec2 sortedCoord = mirroredTexCoord;
        if (brightness > adjustedThreshold) {
            // Offset in the sort direction
            sortedCoord += sortDir * u_displacement * 10.0 * (brightness - adjustedThreshold);
            sortedCoord = fract(sortedCoord); // Wrap around
        }

        vec4 sortedColor = texture2D(u_webcamTexture, sortedCoord);

        // Mix with previous frame for trails
        vec4 finalColor = mix(sortedColor, previousOrStaticColor, u_trailPersistence);

        // Apply feedback effect
        if (u_feedback > 0.0) {
            vec2 feedbackOffset = vec2(noise(v_texCoord*3.0 + u_time*0.1)-0.5) * 0.01 * u_feedback;
            vec4 feedbackColor = texture2D(u_previousFrameTexture, v_texCoord + feedbackOffset);
            finalColor = mix(finalColor, feedbackColor, u_feedback * 0.5);
        }

        // Apply hue shift if enabled
        if (u_hueShiftSpeed != 0.0) {
            vec3 hsl = rgb2hsl(finalColor.rgb);
            hsl.x = fract(hsl.x + u_time * u_hueShiftSpeed);
            finalColor.rgb = hsl2rgb(hsl);
        }

        // Apply brightness, contrast, and saturation adjustments
        finalColor.rgb = adjustSaturation(
            adjustBrightnessContrast(finalColor.rgb, u_brightness, u_contrast),
            u_saturation
        );

        finalColor = clamp(finalColor, 0.0, 1.0);
        gl_FragColor = finalColor;
    }
`;

export const feedbackShader = `
    precision highp float; varying vec2 v_texCoord;
    uniform sampler2D u_webcamTexture; uniform sampler2D u_previousFrameTexture;
    uniform float u_time; uniform float u_motionThreshold; uniform float u_trailPersistence;
    uniform float u_hueShiftSpeed; uniform float u_motionExtrapolation;
    uniform float u_intensity; uniform float u_displacement; uniform float u_feedback;
    uniform float u_threshold; uniform float u_brightness; uniform float u_contrast; uniform float u_saturation;

    float random (vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123 + u_time * 0.01); }
    float noise (vec2 st) { vec2 i = floor(st); vec2 f = fract(st); float a = random(i); float b = random(i + vec2(1.,0.)); float c = random(i + vec2(0.,1.)); float d = random(i + vec2(1.,1.)); vec2 u = f*f*(3.0-2.0*f); return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y; }
    vec3 rgb2hsl(vec3 color) { float r = color.r; float g = color.g; float b = color.b; float maxC = max(max(r, g), b); float minC = min(min(r, g), b); float h = 0.0, s = 0.0, l = (maxC + minC) / 2.0; if (maxC == minC) { h = s = 0.0; } else { float d = maxC - minC; s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC); if (maxC == r) { h = (g - b) / d + (g < b ? 6.0 : 0.0); } else if (maxC == g) { h = (b - r) / d + 2.0; } else if (maxC == b) { h = (r - g) / d + 4.0; } h /= 6.0; } return vec3(h, s, l); }
    float hue2rgb(float p, float q, float t) { if(t < 0.0) t += 1.0; if(t > 1.0) t -= 1.0; if(t < 1.0/6.0) return p + (q - p) * 6.0 * t; if(t < 1.0/2.0) return q; if(t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0; return p; }
    vec3 hsl2rgb(vec3 hsl) { float h = hsl.x; float s = hsl.y; float l = hsl.z; float r, g, b; if(s == 0.0){ r = g = b = l; } else { float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s; float p = 2.0 * l - q; r = hue2rgb(p, q, h + 1.0/3.0); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1.0/3.0); } return vec3(r, g, b); }

    vec3 adjustBrightnessContrast(vec3 color, float brightness, float contrast) {
        vec3 result = color + brightness;
        result = (result - 0.5) * contrast + 0.5;
        return clamp(result, 0.0, 1.0);
    }

    vec3 adjustSaturation(vec3 color, float saturation) {
        vec3 gray = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
        return mix(gray, color, saturation);
    }

    void main() {
        vec2 mirroredTexCoord = vec2(1.0 - v_texCoord.x, v_texCoord.y);

        // Create feedback effect by rotating/zooming coordinates
        float angle = u_time * 0.05 * u_intensity;
        float zoom = 1.0 + sin(u_time * 0.1) * 0.01 * u_intensity;

        vec2 center = vec2(0.5, 0.5);
        vec2 fbCoord = v_texCoord - center;
        fbCoord = vec2(
            fbCoord.x * cos(angle) - fbCoord.y * sin(angle),
            fbCoord.x * sin(angle) + fbCoord.y * cos(angle)
        );
        fbCoord = fbCoord * zoom + center;

        // Add displacement/warp for more organic feel
        fbCoord += vec2(
            noise(fbCoord * 5.0 + u_time * 0.1) - 0.5,
            noise(fbCoord * 5.0 - u_time * 0.1) - 0.5
        ) * u_displacement * 0.1;

        vec4 currentWebcamColor = texture2D(u_webcamTexture, mirroredTexCoord);
        vec4 feedbackColor = texture2D(u_previousFrameTexture, fbCoord);

        // Blend webcam with feedback based on our parameters
        float feedbackAmount = clamp(u_feedback * (1.0 + u_intensity), 0.0, 0.95);
        vec4 finalColor = mix(currentWebcamColor, feedbackColor, feedbackAmount);

        // Add some motion-reactive glow
        float difference = length(currentWebcamColor.rgb - feedbackColor.rgb);
        if (difference > u_motionThreshold) {
            // Enhance colors where motion is detected
            vec3 hsl = rgb2hsl(finalColor.rgb);
            hsl.y = min(hsl.y + 0.2 * u_intensity, 1.0);  // Increase saturation
            hsl.z = min(hsl.z + 0.1 * u_intensity, 0.9);  // Increase lightness
            finalColor.rgb = hsl2rgb(hsl);
        }

        // Apply hue shift if enabled
        if (u_hueShiftSpeed != 0.0) {
            vec3 hsl = rgb2hsl(finalColor.rgb);
            hsl.x = fract(hsl.x + u_time * u_hueShiftSpeed);
            finalColor.rgb = hsl2rgb(hsl);
        }

        // Apply brightness, contrast, and saturation adjustments
        finalColor.rgb = adjustSaturation(
            adjustBrightnessContrast(finalColor.rgb, u_brightness, u_contrast),
            u_saturation
        );

        finalColor = clamp(finalColor, 0.0, 1.0);
        gl_FragColor = finalColor;
    }
`;

export const colorShiftShader = `
    precision highp float; varying vec2 v_texCoord;
    uniform sampler2D u_webcamTexture; uniform sampler2D u_previousFrameTexture;
    uniform float u_time; uniform float u_motionThreshold; uniform float u_trailPersistence;
    uniform float u_hueShiftSpeed; uniform float u_motionExtrapolation;
    uniform float u_intensity; uniform float u_displacement; uniform float u_feedback;
    uniform float u_threshold; uniform float u_brightness; uniform float u_contrast; uniform float u_saturation;

    float random (vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123 + u_time * 0.01); }
    float noise (vec2 st) { vec2 i = floor(st); vec2 f = fract(st); float a = random(i); float b = random(i + vec2(1.,0.)); float c = random(i + vec2(0.,1.)); float d = random(i + vec2(1.,1.)); vec2 u = f*f*(3.0-2.0*f); return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y; }
    vec3 rgb2hsl(vec3 color) { float r = color.r; float g = color.g; float b = color.b; float maxC = max(max(r, g), b); float minC = min(min(r, g), b); float h = 0.0, s = 0.0, l = (maxC + minC) / 2.0; if (maxC == minC) { h = s = 0.0; } else { float d = maxC - minC; s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC); if (maxC == r) { h = (g - b) / d + (g < b ? 6.0 : 0.0); } else if (maxC == g) { h = (b - r) / d + 2.0; } else if (maxC == b) { h = (r - g) / d + 4.0; } h /= 6.0; } return vec3(h, s, l); }
    float hue2rgb(float p, float q, float t) { if(t < 0.0) t += 1.0; if(t > 1.0) t -= 1.0; if(t < 1.0/6.0) return p + (q - p) * 6.0 * t; if(t < 1.0/2.0) return q; if(t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0; return p; }
    vec3 hsl2rgb(vec3 hsl) { float h = hsl.x; float s = hsl.y; float l = hsl.z; float r, g, b; if(s == 0.0){ r = g = b = l; } else { float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s; float p = 2.0 * l - q; r = hue2rgb(p, q, h + 1.0/3.0); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1.0/3.0); } return vec3(r, g, b); }

    vec3 adjustBrightnessContrast(vec3 color, float brightness, float contrast) {
        vec3 result = color + brightness;
        result = (result - 0.5) * contrast + 0.5;
        return clamp(result, 0.0, 1.0);
    }

    vec3 adjustSaturation(vec3 color, float saturation) {
        vec3 gray = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
        return mix(gray, color, saturation);
    }

    void main() {
        vec2 mirroredTexCoord = vec2(1.0 - v_texCoord.x, v_texCoord.y);

        // Create color channel separation effect
        float channelShift = u_displacement * 0.2 * (1.0 + u_intensity);
        vec2 rOffset = vec2(sin(u_time * 0.3) * channelShift, cos(u_time * 0.2) * channelShift);
        vec2 gOffset = vec2(sin(u_time * 0.2 + 2.0) * channelShift, cos(u_time * 0.3 + 1.0) * channelShift);
        vec2 bOffset = vec2(sin(u_time * 0.1 + 4.0) * channelShift, cos(u_time * 0.4 + 3.0) * channelShift);

        // Sample each color channel with offset
        float r = texture2D(u_webcamTexture, mirroredTexCoord + rOffset).r;
        float g = texture2D(u_webcamTexture, mirroredTexCoord + gOffset).g;
        float b = texture2D(u_webcamTexture, mirroredTexCoord + bOffset).b;

        vec4 currentColor = vec4(r, g, b, 1.0);
        vec4 previousColor = texture2D(u_previousFrameTexture, v_texCoord);

        // Add trail/persistence
        vec4 finalColor = mix(currentColor, previousColor, u_trailPersistence);

        // Add some dynamic hue rotation
        float dynamicHueShift = u_hueShiftSpeed + sin(u_time * 0.1) * 0.02 * u_intensity;
        vec3 hsl = rgb2hsl(finalColor.rgb);

        // Make the hue shift more dramatic with intensity
        hsl.x = fract(hsl.x + u_time * dynamicHueShift);

        // Enhance saturation based on intensity
        hsl.y = min(hsl.y + u_intensity * 0.3, 1.0);

        finalColor.rgb = hsl2rgb(hsl);

        // Blend with feedback for more visual complexity
        if (u_feedback > 0.0) {
            // Apply a slight zoom and rotation to the feedback
            vec2 center = vec2(0.5, 0.5);
            vec2 fbCoord = v_texCoord - center;
            float angle = u_time * 0.02 * u_feedback;
            fbCoord = vec2(
                fbCoord.x * cos(angle) - fbCoord.y * sin(angle),
                fbCoord.x * sin(angle) + fbCoord.y * cos(angle)
            );
            fbCoord = fbCoord * (1.0 + u_feedback * 0.03) + center;

            vec4 feedbackColor = texture2D(u_previousFrameTexture, fbCoord);
            finalColor = mix(finalColor, feedbackColor, u_feedback * 0.5);
        }

        // Apply brightness, contrast, and saturation adjustments
        finalColor.rgb = adjustSaturation(
            adjustBrightnessContrast(finalColor.rgb, u_brightness, u_contrast),
            u_saturation
        );

        finalColor = clamp(finalColor, 0.0, 1.0);
        gl_FragColor = finalColor;
    }
`;
