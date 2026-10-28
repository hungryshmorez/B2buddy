## 2024-05-22 - Serverless Input Validation Gap
**Vulnerability:** Netlify functions (`process-interaction.ts`, `mobile-api.ts`) were parsing `event.body` and accessing properties without validation, leading to potential crashes (500 errors) or bad data processing.
**Learning:** The project relies on manual parsing in each handler rather than a shared middleware. `tsc` excludes `netlify/`, so these files aren't type-checked during build.
**Prevention:** Always validate existence and type of expected properties from `JSON.parse(event.body)` before use.
