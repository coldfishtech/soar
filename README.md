<p align="center">
  <img src="soar_title.png" alt="SOAR" width="420" />
</p>

# SOAR: Touch the Sky

SOAR is a tiny, fast, and focused canvas platformer built for mobile and desktop. Hop between drifting clouds, rack up distance for score, and chase your personal best. On mobile, the game provides sleek on-screen controls; on desktop, use the arrow keys and Space to jump. Sound effects are lightweight and always available after your first tap.

- Play online: https://coldfishtech.github.io/soar/
- Code: https://github.com/coldfishtech/soar (single-file `index.html`)

Note: The game no longer includes an online leaderboard or any Supabase integration. Previous leaderboard setup instructions have been removed.

## What’s included

- Responsive controls: on-screen mobile controls and desktop keyboard support
- SoundCloud soundtrack with clickable track title (Artist – Song)
- Music/SFX toggles (ON/OFF) in the top bar and start menu
- Start and Game Over overlays with simplified, readable layout
- Instagram link (icon) to the project feed (@soar.wav)

## Controls

- Mobile: on-screen Left/Right arrows + Jump button (sliding interaction supported)
- Desktop: Left/Right arrows to move, Space to jump

## Audio

- Music
  - The music uses the SoundCloud Widget API. The current track title displays as “Artist – Song” and links to the original SoundCloud page.
  - Default music volume is initialized to 50%.
  - Due to mobile autoplay policies, music begins only after you press “Play Game”.
  - Music can be toggled ON/OFF via the Music button.
- Sound Effects (SFX)
  - Lightweight Web Audio beeps for jumps/landings and small cues.
  - Can be toggled ON/OFF independently of music.

## Save Data

- Best score persists via `localStorage` under the key `cloudjump_best`.

## Running locally

This is a static site. You can open `index.html` directly in a browser or serve the folder via any static server (recommended for mobile testing). The SoundCloud widget requires network access to load the track.

## License

See `LICENSE` for details.
