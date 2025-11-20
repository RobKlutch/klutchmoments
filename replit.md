# Klutch Moments

## Overview

Klutch Moments is a web application that transforms everyday sports clips into professional highlight videos with spotlight effects and player tracking. The platform allows users to upload sports videos, select specific time segments, choose a player to highlight, apply visual effects (like circular spotlights or foot disks), and download polished highlight reels suitable for social media sharing and recruitment purposes.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

**Frontend Architecture**
- Built with React 18 and TypeScript using Vite as the build tool
- Uses shadcn/ui component library built on top of Radix UI primitives
- Implements a workflow-based state management system for the video processing pipeline
- Styled with Tailwind CSS following a sports-themed design system with dark/light mode support
- Routing handled by wouter for client-side navigation

**Component Structure**
- Modular component architecture with clear separation of concerns
- Workflow components (VideoUpload, VideoTimeline, PlayerSelection, HighlightEffects, ProcessingStatus, VideoPreview)
- UI components built on Radix primitives for accessibility
- Theme provider for consistent dark/light mode switching

**State Management**
- React Query (@tanstack/react-query) for server state management and caching
- Local React state for UI interactions and workflow progression
- Context providers for theme and authentication state

**Backend Architecture**
- Express.js server with TypeScript
- Session-based authentication using Passport.js with local strategy
- Password hashing using Node.js crypto module with scrypt algorithm
- Modular route registration system with middleware for logging and error handling

**Authentication System**
- Local authentication strategy with username/password
- Session persistence using express-session
- Protected routes with authentication middleware
- User registration and login with proper password hashing

**Database Layer**
- Drizzle ORM for type-safe database operations
- PostgreSQL database configured via DATABASE_URL environment variable
- Schema defined with TypeScript types and Zod validation
- Database migrations managed through Drizzle Kit

**File Structure**
- Monorepo structure with separate client and server directories
- Shared schema definitions between client and server
- Asset management for generated images and static files

**Development Setup**
- Hot module replacement in development via Vite
- TypeScript strict mode enabled across the project
- Path aliases configured for clean imports (@/, @shared/, @assets/)
- ESM modules throughout the codebase

## External Dependencies

**UI and Styling**
- Radix UI primitives for accessible component building blocks
- Tailwind CSS for utility-first styling with custom design tokens
- Lucide React for consistent iconography
- Google Fonts (Inter and Nunito Sans) for typography

**Data Management**
- TanStack Query for server state management and caching
- React Hook Form with Zod resolvers for form validation
- Drizzle ORM with Neon Database serverless PostgreSQL

**Authentication**
- Passport.js for authentication strategies
- express-session for session management
- connect-pg-simple for PostgreSQL session store

**Development Tools**
- Vite for fast development and building
- ESBuild for server-side bundling
- TypeScript for type safety
- Various Replit-specific plugins for development environment integration

**Video Processing Pipeline**
- YOLOv8 detection service integrated directly into main application (port 5000)
- Persistent Python worker for real-time player detection with HOG fallback
- Eliminates external service dependencies to prevent tracking box jumping
- Spatial tracking system ensures consistent player IDs across frames
- Architecture supports timeline scrubbing, player selection, and effect application