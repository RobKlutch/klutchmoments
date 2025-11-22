# Model-side environment variables

The Cog project does not require additional environment variables by default. If you add private weights, third-party storage, or telemetry, declare them here and mirror them in `.env.example` within this directory.

Examples (if needed):
- `PRIVATE_WEIGHTS_URL` – URL to download weights before inference.
- `TRACKER_CONFIG_URL` – Remote tracker config override.

Keep these separate from the app-level variables defined in the repository root `.env.example`.
