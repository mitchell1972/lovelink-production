# LoveLink App Assets Guide

## Required Assets

Create the following image files in the `assets/` folder:

### 1. App Icon (icon.png)
- **Size:** 1024 x 1024 pixels
- **Format:** PNG (no transparency)
- **Purpose:** Main app icon for iOS and Android

### 2. Adaptive Icon (adaptive-icon.png)
- **Size:** 1024 x 1024 pixels
- **Format:** PNG with transparency
- **Purpose:** Android adaptive icon (foreground layer)
- **Note:** Design should have padding as Android crops to different shapes

### 3. Splash Screen (splash.png)
- **Size:** 1284 x 2778 pixels (or similar large size)
- **Format:** PNG
- **Background:** Should be transparent or #6C63FF
- **Purpose:** Loading screen when app opens

### 4. Notification Icon (notification-icon.png)
- **Size:** 96 x 96 pixels
- **Format:** PNG (white icon on transparent background)
- **Purpose:** Android notification icon

### 5. Favicon (favicon.png)
- **Size:** 48 x 48 pixels
- **Format:** PNG
- **Purpose:** Web browser tab icon

---

## Design Suggestions

### App Icon Design:
- Purple gradient background (#6C63FF to #A8A4FF)
- Two overlapping hearts emoji 💕 in white/pink
- Simple, recognizable at small sizes

### Quick Option - Use Canva:
1. Go to https://canva.com
2. Create new design: 1024x1024 px
3. Add purple gradient background
4. Add heart emoji or heart shapes
5. Download as PNG
6. Save as `assets/icon.png`

### For Splash Screen:
1. Create 1284x2778 px design
2. Purple background (#6C63FF)
3. Center the heart logo
4. Add "LoveLink" text below (optional)
5. Save as `assets/splash.png`

---

## Tools to Create Assets

1. **Canva** (free): https://canva.com - Easiest option
2. **Figma** (free): https://figma.com - More control
3. **Expo Icon Builder**: https://buildicon.netlify.app/

---

## Current Setup

Until you create custom icons:
- The app will use Expo's default icons
- Splash screen shows purple background (#6C63FF)
- You can test the app without custom icons
