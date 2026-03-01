# 🌌 APOD Mood Gallery
![React](https://img.shields.io/badge/react-19.2.0-blue?logo=react)
![Vite](https://img.shields.io/badge/vite-7.2.4-purple?logo=vite)
![Tailwind](https://img.shields.io/badge/tailwindcss-3.4.19-38B2AC?logo=tailwind-css)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-MobileNet-FF6F00?logo=tensorflow)
![Three.js](https://img.shields.io/badge/Three.js-R3F-black?logo=three.js)

NASA Astronomy Pictures - Explore the cosmos through moods, palettes, and AI-powered collections.

APOD Mood Gallery takes NASA's iconic Astronomy Picture of the Day (APOD) archive and transforms it into an interactive, visually stunning, and intelligent experience. Using client-side machine learning and advanced 3D rendering, it analyzes celestial images to extract dominant color palettes, classify emotional moods, and provide personalized space discoveries.

## ✨ Features

- **PWA Support**: Installable Progressive Web App with offline capabilities and background APOD synchronization.
- **AI Image Analysis**: Completely private, in-browser image analysis using TensorFlow.js (MobileNet). Identifies visual characteristics and content to classify images by "mood".
- **Dynamic Color Palettes**: Automatically extracts and displays beautiful, harmonious color palettes from astronomical imagery using Web Workers to keep the UI snappy.
- **3D Solar System & Exoplanets**: Explore real-time planetary positions using `astronomy-engine` and `react-three-fiber`.
- **Personalized "For You" Feed**: A local recommendation engine that learns what types of space images you appreciate.
- **Mood Board Creator**: Curate your favorite images into a visual mood board and export it locally via PDF (`jspdf`) or ZIP.
- **Semantic Mood Search**: Find images based not just on keywords, but on the visual emotion and mood they convey.
- **Space Quiz**: Test your astronomical knowledge in an interactive quiz game.

## 🚀 Tech Stack

- **Frontend Framework**: React 19, Vite
- **Styling**: Tailwind CSS, PostCSS, AutoPrefixer
- **3D Rendering**: Three.js, React Three Fiber, React Three Drei
- **Machine Learning**: TensorFlow.js, MobileNet
- **Data & APIs**: NASA APOD API, Astronomy Engine, Axios
- **State & Utilities**: Custom local storage service, Web Workers, `date-fns`, `react-virtuoso`
- **Exports**: `html-to-image`, `jspdf`, `jszip`, `qrcode`

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
   Create a `.env` file in the root directory and add your NASA API key. If you don't have one, the app will run in a limited rate demo mode.
   ```env
   VITE_NASA_API_KEY=your_nasa_api_key_here
   ```
   You can get a free API key at [api.nasa.gov](https://api.nasa.gov/).

4. Start the Development Server:
   ```bash
   npm run dev
   ```

5. Build for Production:
   ```bash
   npm run build
   ```

## 🏗️ Project Architecture

- `src/components/`: View-level components mapping to the navigation (Gallery, Search, Daily, Solar System, etc.)
- `src/services/`: API wrappers (`apodService.js`), caching (`storageService.js`), and machine learning orchestration (`imageAnalysis.js`).
- `src/utils/`: Core utilities for ML processing (`moodClassifier.js`), astronomy math (`solarSystem.js`), and color handling (`colorTools.js`).
- `src/workers/`: Web Workers for parallel processing of image pixels and colors, preventing main-thread blocking.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
