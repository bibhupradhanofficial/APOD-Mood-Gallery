import React from "react";

export default function Logo({ size = 48, className = "" }) {
  return (
    <div className={`relative inline-block select-none group ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        className="transition-transform duration-500 ease-out group-hover:scale-105"
      >
        <defs>
          <radialGradient id="logoSpaceGradient" cx="50%" cy="50%" r="50%" fx="30%" fy="30%">
            <stop offset="0%" stop-color="#0b1026" stop-opacity="0.9" />
            <stop offset="100%" stop-color="#050510" stop-opacity="0.95" />
          </radialGradient>
          
          <linearGradient id="logoNebulaGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#22d3ee" />
            <stop offset="50%" stop-color="#7c3aed" />
            <stop offset="100%" stop-color="#e9d5ff" />
          </linearGradient>
          
          <filter id="logoGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="logoStarGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1" result="blur1" />
            <feGaussianBlur stdDeviation="3" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <style>{`
          @keyframes logo-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes logo-spin-reverse {
            from { transform: rotate(360deg); }
            to { transform: rotate(0deg); }
          }
          @keyframes logo-pulse {
            0%, 100% { transform: scale(1); opacity: 0.9; }
            50% { transform: scale(1.08); opacity: 1; }
          }
          @keyframes logo-float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-1.5px) rotate(2deg); }
          }
          .logo-orbit-1 {
            transform-origin: 50px 50px;
            animation: logo-spin 28s linear infinite;
          }
          .logo-orbit-2 {
            transform-origin: 50px 50px;
            animation: logo-spin-reverse 20s linear infinite;
          }
          .logo-star-group {
            transform-origin: 50px 50px;
            animation: logo-pulse 4s ease-in-out infinite;
          }
          .logo-nebula-group {
            transform-origin: 50px 50px;
            animation: logo-spin 65s linear infinite;
          }
          .logo-nebula-group-2 {
            transform-origin: 50px 50px;
            animation: logo-spin-reverse 45s linear infinite;
          }
        `}</style>

        <circle
          cx="50"
          cy="50"
          r="46"
          fill="url(#logoSpaceGradient)"
          stroke="#22d3ee"
          stroke-width="1.5"
          stroke-opacity="0.25"
          className="transition-all duration-500 group-hover:stroke-opacity-40 group-hover:stroke-[#22d3ee]"
        />

        <g className="logo-nebula-group">
          <path
            d="M 32 40 C 25 20, 60 15, 75 35 C 90 55, 65 82, 45 78 C 25 74, 22 55, 32 40 Z"
            fill="url(#logoNebulaGradient)"
            opacity="0.4"
            filter="url(#logoGlow)"
          />
        </g>
          
        <g className="logo-nebula-group-2" transform="rotate(45 50 50)">
          <path
            d="M 42 28 C 62 18, 80 38, 72 62 C 64 86, 32 78, 26 55 C 20 32, 28 35, 42 28 Z"
            fill="url(#logoNebulaGradient)"
            opacity="0.2"
            filter="url(#logoGlow)"
          />
        </g>

        <g stroke="#22d3ee" stroke-width="0.8" stroke-opacity="0.35" fill="none" className="transition-opacity duration-500 group-hover:stroke-opacity-65">
          <circle cx="50" cy="50" r="38" stroke-dasharray="2 3" />
          <line x1="28" y1="28" x2="68" y2="18" />
          <line x1="68" y1="18" x2="82" y2="50" />
          <line x1="82" y1="50" x2="62" y2="82" />
          <line x1="62" y1="82" x2="22" y2="72" />
          <line x1="22" y1="72" x2="18" y2="38" />
          <line x1="18" y1="38" x2="28" y2="28" />
        </g>

        <g className="logo-orbit-1">
          <ellipse
            cx="50"
            cy="50"
            rx="34"
            ry="14"
            fill="none"
            stroke="#e9d5ff"
            stroke-width="0.75"
            stroke-opacity="0.4"
            transform="rotate(-25 50 50)"
          />
          <circle cx="28" cy="35" r="2.2" fill="#22d3ee" filter="url(#logoGlow)" className="animate-pulse" />
        </g>
             
        <g className="logo-orbit-2">
          <ellipse
            cx="50"
            cy="50"
            rx="26"
            ry="10"
            fill="none"
            stroke="#22d3ee"
            stroke-width="1"
            stroke-opacity="0.6"
            transform="rotate(35 50 50)"
          />
          <circle cx="68" cy="62" r="1.5" fill="#e9d5ff" />
        </g>

        <g opacity="0.8">
          <circle cx="26" cy="22" r="0.6" fill="#fff" />
          <circle cx="74" cy="24" r="0.8" fill="#fff" filter="url(#logoGlow)" />
          <circle cx="78" cy="72" r="0.7" fill="#fff" />
          <circle cx="22" cy="74" r="1" fill="#fff" />
        </g>

        <g className="logo-star-group">
          <circle
            cx="50"
            cy="50"
            r="8"
            fill="#e9d5ff"
            opacity="0.25"
            filter="url(#logoStarGlow)"
            className="transition-all duration-500 group-hover:scale-110 group-hover:opacity-40"
          />
          
          <path
            d="M 50 20 Q 50 50 20 50 Q 50 50 50 80 Q 50 50 80 50 Q 50 50 50 20 Z"
            fill="#ffffff"
            filter="url(#logoStarGlow)"
          />
          
          <circle cx="50" cy="50" r="2.5" fill="#ffffff" />
          
          <path d="M 50 38 L 50 62 M 38 50 L 62 50" stroke="#ffffff" stroke-width="1.25" opacity="0.8" />
          <path d="M 43 43 L 57 57 M 43 57 L 57 43" stroke="#ffffff" stroke-width="0.75" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}
