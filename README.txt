ALVéON - offline music player for iPhone

1. Put this whole folder on any https web host (Netlify Drop, GitHub Pages, Cloudflare Pages, your own server).
2. Open the address once in Safari on your iPhone while online.
3. Tap Share, then "Add to Home Screen".
4. After that ALVéON opens from its icon and works with no connection.
   Your music, albums and covers are stored on the phone itself.

Import music with the + button (Files app). MP3 and M4A files bring their own name, album and cover.

BACKUP: + button > "Back up library" saves one .alveon file with every album, cover, song and detail.
        + button > "Restore from backup" brings it back ("Add to my library" or "Replace my library").
        Keep the file in the Files app or iCloud Drive. Do this before deleting the app icon.

SOUND: + button > "Sound & equalizer" (or the sliders button on the player). Bass, treble, 5-band equalizer, presets
        (save your own), auto-adjust per album, volume levelling and crossfade (needs "Sound effects" on).
        IMPORT: + > Import music. Songs from Files, a whole folder, or an album from a .zip. A progress card shows the import; Cancel keeps what is done and "Resume" continues.
        Songs you already have (same size, length and title) are skipped, so picking the same folder again is safe.
        SPATIAL SOUND (for headphones): Wide (wider stereo), 8D (the sound circles your head, orbit time adjustable) and
        7.1 (virtual front/centre/side/back speakers). It is a binaural simulation: it needs headphones to be convincing,
        and it is not Dolby Atmos or head-tracked spatial audio.
        TRANSITIONS: Off / Smooth (plain fade) / DJ. DJ measures every song's tempo and beat positions once on the phone
        (a few seconds per song, in the background), then for each pair of songs it picks the beat where the old song
        should hand over, starts the new song exactly on its own beat, matches the tempo (up to 8% apart, pitch kept),
        fades them against each other over 8-32 beats and swaps the bass halfway so the two kick drums never fight.
        Songs without a steady beat, or tempos too far apart, get a smooth fade instead. Beat detection is an estimate:
        it is very good on steady electronic/pop/hip-hop and weaker on live or tempo-changing music.

SCREEN DIAGNOSTICS: tap the ALVéON logo 5 times. The panel lists the sizes the phone reports
(window.innerHeight, documentElement.clientHeight, visualViewport.height, screen, pixel ratio, safe-area insets,
the top bar's box) and the Home Screen setup (viewport meta, manifest, Apple web-app meta, CSS height rules).
"Copy report" copies it all. The three Test buttons change only the app's height, one at a time, and show a red
line at the bottom of the app; "Reset test" undoes them.

MIX MODE: the MIX switch on the player. Each song is followed by the best next song, chosen from tempo, key (Camelot wheel),
energy, mood and your own listening (plays, skips). The song after that is quietly chosen and measured in advance.
Sound page > "Mix style": Smooth, Beatmatching, Harmonic or Energy. The playing song is never interrupted while the next
one is searched for or prepared: analysis pauses while a song loads or a blend runs, and if the next song fails to start
the current one carries on at full volume.

MIXES FOR YOU: + button > "Mixes for you": Daily, Discovery, Artists, Genres (grouped by how songs sound), Moods,
Energy, Late Night and Throwback mixes. They learn from what you play and skip, starting from the day you installed.

MIX STUDIO (hidden): long-press the MIX switch.
  Blend tab: pick two songs, see both waveforms with the blend window. Drag the green handle for where song 1 leaves, the
  white handle for the length, drag a waveform to choose where each song sits, pinch to zoom. Presets, and Volume / EQ /
  Filter / Effects lists (each has "Custom": drag the points of the curve, tap the line to add a point, double-tap a point
  to remove it). Fine tune: blend length, song levels, bass/mid/treble per song, low-pass and high-pass, BPM match on/off,
  Align beats, Undo / Redo / Reset. Preview always starts just before the blend. Save keeps the settings for that pair.
  Decks tab: two decks with waveforms, cue, loops, sync, tempo, bass cut, crossfader, Auto mix and cut pads (Only A,
  A + B, Only B, Flip) to switch which song sounds instantly.

PLAYBACK LOG: tap the ALVéON logo 5 times; the report ends with a PLAYBACK LOG listing any stall, quiet moment,
paused song or failed blend. Use "Copy report" if something goes wrong.

LIMITS: tempo and key are estimates (weaker on live or tempo-changing music). Everything runs on the phone, no internet.

v43: the song no longer stops by itself - if it is stopped by the phone or a hiccup, the player wakes the sound engine and keeps retrying; a frozen song is reloaded at the same spot. (Continues from v42; v47 was dropped.)

v44: when another app (TikTok, a call) takes the sound the music stops and starts again when you come back; stopping from the lock screen keeps it stopped.
