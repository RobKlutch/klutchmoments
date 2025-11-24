# Klutch Moments Design Guidelines

## Design Approach
**Reference-Based Approach** - Drawing inspiration from modern sports and media platforms like ESPN, Nike Training, and Hudl. The interface should feel dynamic, energetic, and professional while remaining accessible to parents and young athletes.

## Core Design Elements

### A. Color Palette
**Primary Colors:**
- Brand Primary: 220 85% 25% (deep sports blue)
- Success/Action: 145 70% 45% (vibrant green for processing states)

**Dark Mode:**
- Background: 220 15% 8% (deep navy)
- Surface: 220 12% 12% (elevated cards)
- Text Primary: 0 0% 95% (high contrast white)

**Light Mode:**
- Background: 220 20% 97% (soft off-white)
- Surface: 0 0% 100% (pure white cards)
- Text Primary: 220 15% 20% (dark navy text)

### B. Typography
**Primary Font:** Inter (Google Fonts) - clean, modern, excellent readability
**Display Font:** Nunito Sans (Google Fonts) - friendly, approachable for headings
**Sizes:** Use consistent scale: text-sm, text-base, text-lg, text-xl, text-2xl, text-3xl

### C. Layout System
**Spacing Units:** Tailwind units of 2, 4, 6, 8, 12, 16
- Micro spacing: p-2, m-2
- Component spacing: p-4, gap-4
- Section spacing: py-8, mb-12
- Major layout: p-16

### D. Component Library

**Navigation:**
- Clean top navigation with logo and minimal menu items
- Mobile-first hamburger menu with slide-out panel
- Sticky header during video processing

**Video Interface:**
- Large, prominent upload zone with drag-and-drop visual cues
- Timeline scrubber with precise 1-second markers
- Video player with custom controls matching brand colors
- Highlight effect selector with visual previews

**Processing States:**
- Progress indicators with sports-themed animations
- Loading states that communicate what's happening ("Tracking player movement...")
- Success animations with celebration micro-interactions

**Forms & Controls:**
- Rounded input fields with subtle shadows
- Large, finger-friendly buttons for mobile use
- Toggle switches for highlight effect options
- Slider controls for video timeline selection

## Key User Experience Principles

**Simplicity First:** Every screen should have one primary action
**Visual Feedback:** Clear indication of processing states and user selections
**Mobile Optimization:** Touch-friendly controls, readable text on small screens
**Sports Aesthetic:** Use subtle motion graphics and energy without overwhelming functionality

## Images
**Hero Section:** Large background video/image showcasing a highlight reel in action. Should feature young athletes in various sports with the spotlight effect visible. The hero should span full viewport height.

**Feature Demonstrations:** Screenshots or short video previews showing the three-step process, placed in cards with subtle shadows and rounded corners.

**No Stock Photos:** Focus on authentic sports footage and UI screenshots rather than generic imagery.

## Special Considerations
- Ensure video preview areas have adequate contrast for visibility on various video backgrounds
- Use loading animations that feel fast and energetic, matching sports tempo
- Implement responsive video players that work seamlessly across devices
- Consider accessibility for colorblind users in highlight effect selections