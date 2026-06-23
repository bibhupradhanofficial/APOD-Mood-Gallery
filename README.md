# 🌌 APOD Mood Gallery
![React](https://img.shields.io/badge/react-19.2.0-blue?logo=react)
![Vite](https://img.shields.io/badge/vite-7.2.4-purple?logo=vite)
![Tailwind](https://img.shields.io/badge/tailwindcss-3.4.19-38B2AC?logo=tailwind-css)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-MobileNet-FF6F00?logo=tensorflow)
![Three.js](https://img.shields.io/badge/Three.js-R3F-black?logo=three.js)

NASA Astronomy Pictures — Explore the cosmos through moods, palettes, and AI-powered collections.

APOD Mood Gallery takes NASA's iconic Astronomy Picture of the Day (APOD) archive and transforms it into an interactive, visually stunning, and intelligent experience. Using client-side machine learning and advanced 3D rendering, it analyzes celestial images to extract dominant color palettes, classify emotional moods, and provide personalized space discoveries.

---

## ✨ Features

### 🎨 Unified Glassmorphism Design System
- **Uniform Page Shell**: Every view adheres to a consistent, responsive outer wrapper (`max-w-6xl`) with integrated border separators and stats metrics.
- **Translucent Void Cards**: Standardized containers utilize a sleek `bg-space-void/45 backdrop-blur-md border-white/10` layout with dynamic neon shadow glows.
- **Micro-Animations**: Hover-triggered interactive buttons (neon aurora primary, soft glass secondary) and transitions elevate the user experience.
- **Animated Vector Logo**: Integrates the **"Cosmic Aperture & Mood Nebula"** logo — an animated React SVG header feature with dual spinning orbits, a pulsing focus star, and hover-morphing camera aperture lines.

### 🧠 Client-Side AI & Image Analysis
- **Private Machine Learning**: Runs client-side TensorFlow.js using the MobileNet classifier to instantly categorize celestial images by mood (e.g. calm, energetic, mysterious, inspiring, cosmic) inside the browser.
- **Parallel Pixel Processing**: Offloads pixel analysis and palette extraction to Web Workers, keeping the application UI buttery smooth.
- **Dynamic Swatches**: Displays extraction weights, hexadecimal markers, and a combined color gradient representing the transition of the curation deck.

### 🎮 Revamped Space Quiz Lab
- **Multiple Challenge Modes**:
  - *Guess the Mood*: Predict the emotional classification and compare results with the local AI.
  - *Name That Phenomenon*: Guess the astronomical subject based on APOD title clues.
  - *Color Match*: Match the extracted dominant color swatches to the correct celestial photograph.
  - *Before / After*: Order two random space images historically on a chronological timeline.
- **Gamified Progression**: Track points, accuracy rates, and compile learned topics with interactive tooltips describing color theory and camera techniques.

### 🪐 3D Solar System & Exoplanet Explorer
- **Real-Time Orbit Mapping**: Calculate precise planetary coordinates for any historical date using the mathematical formulas of `astronomy-engine` rendered in an interactive Three.js viewport (`react-three-fiber`).
- **Interactive Orbit Customization**: Adjust simulation speed, view Keplerian orbits, and read celestial fact sheets.
- **Exoplanet Habitable Zones**: Filter exoplanetary databases by stellar temperature, distance, and radius to discover twin-Earth candidates and read related APOD entries.

### 🗃️ Curated Mood Boards & Offline PWA
- **Drag-and-Drop Editor**: Reorder and organize custom collections on a timeline.
- **Offline Capabilities**: Full PWA support allows caching APOD assets, offline database read/writes, and background sync.
- **Multiple Exports**: Download your custom boards as structured JSON, complete media ZIP packages, or printable PDFs (`jspdf`).

---

## 🚀 Tech Stack

- **Core**: React 19, Vite
- **Styling**: Tailwind CSS, PostCSS, AutoPrefixer
- **3D Renderers**: Three.js, React Three Fiber, React Three Drei
- **Neural Networks**: TensorFlow.js, MobileNet V1
- **Astronomy Physics**: Astronomy Engine, NASA API Client
- **Parallel Workloads**: Vanilla Web Workers API
- **Exporting**: `html2canvas`, `jspdf`, `jszip`, `qrcode`

---

## 📦 Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd APOD-Mood-Gallery
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup Environment Variables:
   Create a `.env` file in the root directory and add your NASA API key:
   ```env
   VITE_NASA_API_KEY=your_nasa_api_key_here
   ```
   *Note: If no API key is specified, the application will run in rate-limited demo mode.*

4. Launch local dev server:
   ```bash
   npm run dev
   ```

5. Build for Production:
   ```bash
   npm run build
   ```

---

## 🏗️ Project Architecture

- `src/components/`: View-level page components (Gallery, Exoplanets, Solar System, Space Quiz, About, etc.)
- `src/services/`: API layer (`apodService.js`), offline index-db caching (`storageService.js`), and neural model managers (`imageAnalysis.js`).
- `src/utils/`: Color tools, mood classification formulas, and astronomical algorithms.
- `src/workers/`: Parallel workers processing pixel maps and calculating similarity scores.

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
