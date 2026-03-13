# Codebase Overview

This repository is a static HTML5 canvas game called **SOAR: Touch the Sky**.

It is **not** a framework-based web app and it does **not** have a backend, package manager setup, or build pipeline. The project is intentionally lightweight and is primarily implemented as a **single-file browser game** in `index.html`, with supporting image assets in `resources/`.

## What This Codebase Is

- A 2D vertical platformer where the player jumps between moving clouds and tries to increase their score by climbing higher.
- A browser-based game designed to work on both desktop and mobile.
- A static site that can be opened directly in a browser or hosted on a simple static host such as GitHub Pages.

## Main Files And Responsibilities

- `index.html`
  - Contains the HTML structure for the title bar, music controls, canvas, start menu, game-over overlay, desktop instructions, and mobile controls.
  - Contains the CSS for layout, responsive behavior, menus, controls, and overall styling.
  - Contains the JavaScript for the full game loop and game systems.
- `resources/`
  - Holds the game art assets, including:
  - `resources/sprites/player/` for player animation frames
  - `resources/buttons/` for touch control button images
  - `resources/frame/` for menu framing art
  - `resources/tower/` for the background tower art
- `README.md`
  - High-level description of the project, controls, audio behavior, and local running notes.

## Core Technical Structure

The main game logic lives in `index.html` and follows the standard browser game pattern:

- `update(dt)`
  - Advances game state each frame.
  - Handles movement, gravity, jumping, collisions, cloud recycling, scoring, difficulty scaling, and game-over detection.
- `draw()`
  - Renders the current frame to the canvas.
  - Draws the sky, tower background, clouds, ground, player sprite, particles, HUD, and milestone popup.
- `frame(now)`
  - Drives the loop with `requestAnimationFrame`.

## Major Systems

- **Rendering**
  - Uses a single `<canvas>` for gameplay rendering.
  - Uses pixel-art-friendly drawing with image smoothing disabled.
  - Mixes canvas rendering for gameplay with DOM overlays for menus and UI panels.

- **Input**
  - Desktop uses keyboard controls.
  - Mobile uses on-screen touch controls with drag and slide handling.
  - The code explicitly switches UI behavior based on viewport width.

- **Physics and Feel**
  - Includes gravity, horizontal movement, collision with clouds and ground, and falling death checks.
  - Uses coyote time and jump buffering to make jumping feel more forgiving.
  - Includes a short jump wind-up before liftoff for animation timing and feel.

- **World Generation and Difficulty**
  - Clouds are procedurally spawned and recycled as the player climbs.
  - Difficulty ramps by increasing cloud speed and spacing based on score milestones.

- **Audio**
  - Background music is provided through the SoundCloud Widget API in a hidden iframe.
  - Sound effects are generated with the Web Audio API.
  - Music and SFX can be toggled independently.

- **Persistence**
  - Best score is stored locally in `localStorage` under the key `cloudjump_best`.
  - There is no current backend persistence.

## Important Architectural Notes

- The repo previously had leaderboard and Supabase-related functionality, but that has been removed.
- Comments in `index.html` still reference removed leaderboard/Supabase code in a few places as historical markers.
- The current codebase is self-contained except for external SoundCloud loading for music playback.

## Practical Mental Model

Treat this project as:

- a **single-page static game**
- with **all gameplay code in one file**
- and **assets organized in `resources/`**

When making changes, start by locating the relevant section inside `index.html`:

- layout/UI markup near the HTML body
- styling in the `<style>` block
- gameplay logic in the main `<script>` blocks
- asset references under `resources/`
