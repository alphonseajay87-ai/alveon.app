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
