# Klutch Moments

## Overview
Klutch Moments is a web application designed to transform raw sports footage into professional highlight videos. Users can upload video clips, select specific time segments, identify a player to highlight, apply visual effects, and download the polished highlight reels. The platform aims to create engaging content for social media and recruitment by simplifying the highlight creation process.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

**UI/UX:**
The frontend uses React 18, TypeScript, and Vite, featuring `shadcn/ui` (Radix UI) for components and Tailwind CSS for styling. It adopts a sports-themed design with dark/light mode and uses `wouter` for client-side routing. The architecture emphasizes modular components.

**System Design Choices:**
- **Logging & Diagnostics:** Features a resilient `StageLogger` with a memory buffer and remote logging to `/api/logs`, a `LogThrottler` to prevent UI freezes, and `VideoPreviewErrorBoundary` for crash recovery. Comprehensive state transition logging is implemented.
- **Frontend:** React 18, TypeScript, Vite, `shadcn/ui`, Tailwind CSS, `wouter`. State management utilizes React Query for server state and local React state for UI.
- **Backend:** Express.js server developed with TypeScript, featuring session-based authentication via Passport.js (local, Google OAuth, Apple OAuth) and a modular route system.
- **Database:** PostgreSQL with Drizzle ORM for type-safe operations, Drizzle Kit for migrations, and Zod for schema validation.
- **🚨 CRITICAL: Coordinate System & Anti-Flip Guards:**
    - **Canonical Coordinate System:** Origin (0,0) at TOP-LEFT, X increases LEFT→RIGHT, Y increases TOP→BOTTOM, normalized [0,1] range
    - **NO FLIPPING ALLOWED:** Coordinates must NEVER be horizontally flipped (no `x = 1 - x`, no `centerX = 1 - centerX`, no `scaleX(-1)`)
    - **Complete Coordinate Set:** All bounding boxes include: `x, y, width, height, centerX, centerY, topLeftX, topLeftY`
    - **1:1 Handshake:** Coordinates flow unchanged: Replicate Backend → Spatial Tracking → HighlightLock → useSpotlightTracker currentBoxState → SpotlightOverlay
    - **Mandatory Preservation:** When copying coordinates between pipeline stages, ALWAYS preserve `centerX` and `centerY` fields
    - **Runtime Guards:** `coordinateGuards.ts` provides `validateNoFlip()` and `assertCenterCoordinatesPresent()` functions that detect coordinate flipping and missing fields
    - **Guard Integration:** Guards are integrated at critical points: SpotlightOverlay.render(), useSpotlightTracker.handleDetections()
    - **See:** `client/src/utils/coordinateGuards.ts` for complete documentation
- **Video Processing Pipeline:**
    - **Player Detection:** Utilizes the Replicate API (YOLOv11 model) or a local Python worker for player detection, ensuring consistent `DetectionResponse` formatting.
    - **Tracking:** Implements keyframe-based continuous tracking with EMA filters (baseAlpha=0.4), ID-lock for consistent player identification, and anchor-based initialization for precise player selection. Detection frequency: 500ms prevents overlapping API calls that cause coordinate corruption. Coordinate handshake: Timeline → Backend → Video Preview with full canonical coordinates (topLeftX, topLeftY, centerX, centerY) to prevent re-normalization. **CRITICAL LEARNING**: Faster detection intervals (200ms) create race conditions where late-arriving stale results overwrite canonical coordinates, reintroducing horizontal flip bugs and random jumps. The 500ms interval prevents concurrent in-flight API calls.
    - **Smooth Interpolation System:** Spotlight rendering at 60fps using rVFC/RAF with velocity-based interpolation between detections. HighlightLock maintains a 4-detection timestamped history buffer and uses velocity-based extrapolation (up to 200ms ahead, capped at 2.5 screen units/second) with confidence easing (30% reduction over interpolation window). Falls back to legacy velocity prediction beyond 200ms. This enables smooth tracking even with 500ms-1400ms detection intervals while maintaining coordinate integrity and ID-lock systems.
- **Application Workflows:** Supports two workflows: an Admin Creator Dashboard with a `Video Preview` stage and a Customer Workflow that bypasses it. Both ensure identical output.
- **6-Stage Pipeline Contract:** Defines a clear progression: Upload -> Timeline -> Effects -> (Video Preview for admin) -> Processing -> Export, with strict data integrity and transition protocols.
- **Video Preview Architecture:** Redesigned for efficiency, utilizing `VideoPreviewSurface`, `usePreviewController` for centralized playback, session isolation via `localStorage`, and throttled debug logging.

## 🎯 CHECKPOINT: "TIGHT SPOTLIGHT" (October 21, 2025)

**Purpose:** Implements 1:1 backend-to-frontend coordinate tracking with time synchronization fixes for pixel-perfect spotlight alignment

**Coordinate Tracking Changes:**
1. **Backend Coordinate Trust:** `HighlightLock.ts` (line 370-371) now uses `detection.centerX` and `detection.centerY` directly from backend when available, eliminating frontend recalculation
2. **Coordinate Flow Verification:**
   - Python detection service (`replicateDetection.ts` lines 194-229) normalizes centerX/centerY to [0,1]
   - Canonicalization pipeline (`routes.ts` line 817) preserves all coordinate fields
   - Spatial tracking passes centerX/centerY through unchanged
   - Frontend trusts backend values completely (no re-derivation)
3. **Diagnostic Logging:** Active coordinate comparison logs (🔬 COORDINATE COMPARISON) show delta between backend vs recalculated values
4. **Fallback Protection:** If centerX/centerY undefined, falls back to calculation from topLeft + width/height

**Time Synchronization Fixes (NEW):**
1. **Eliminated Epoch Timestamps:** Removed all `Date.now()` fallbacks from `HighlightLock.ts` that mixed epoch time with video-relative milliseconds
   - `update()` method now requires valid video timestamps (allows 0 for video start)
   - Constructor initializes with 0 instead of `Date.now()`
2. **Tolerance Window:** Added 150ms tolerance in `SpotlightOverlay.tsx` to synchronize `sampleTime` with `realVideoTime`, preventing stale frame rejection
3. **Micro-jitter Smoothing:** Added exponential smoothing filter (alpha=0.25) in `SpotlightOverlay.tsx` for center position to eliminate visible micro-jitter
4. **Timestamp Validation:** Explicit validation allows `currentTime === 0` (video start) while rejecting undefined, null, NaN, or negative values

**Critical Files:**
- `client/src/hooks/HighlightLock.ts`: Backend coordinate usage, timestamp validation
- `client/src/components/SpotlightOverlay.tsx`: Tolerance window, exponential smoothing
- `server/services/replicateDetection.ts`: Python normalization
- `server/routes.ts`: Canonicalization application
- `server/utils/spatialTracking.ts`: Coordinate preservation

**Root Cause Solved:** Spotlight jitter was caused by mixing epoch timestamps (17xxxxxxxxx ms) with video-relative timestamps (0-6000 ms), causing `HighlightLock` to lose temporal context and produce incorrect velocity predictions

**User Requirement:** "Rely entirely on backend tracking rather than frontend predictions" + "Eliminate spotlight teleporting and jitter"

## External Dependencies

**UI/Styling:**
- Radix UI
- Tailwind CSS
- Lucide React
- Google Fonts

**Data Management:**
- TanStack Query
- React Hook Form
- Zod
- Drizzle ORM
- Neon Database (PostgreSQL)

**Authentication:**
- Passport.js
- `express-session`
- `connect-pg-simple`

**Video Processing:**
- Replicate API (for YOLOv11 object detection)