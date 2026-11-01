# Music library — sources and licenses

Christian Prayer Live streams a locally stored, low-volume instrumental bed. The
active library holds **21 tracks**: 3 original recordings synthesised for this
project (CC0) and 18 downloaded from Mixkit's free stock-music catalogue.

All files live in `public/assets/christian/audio/` and are listed in
[`music-manifest.json`](../public/assets/christian/audio/music-manifest.json).

## Mixkit downloads

License for every track below: **Mixkit Stock Music Free License**
(<https://mixkit.co/license/#musicFree>) — free for commercial and
non-commercial use, no attribution required, the audio file may not be
redistributed or resold on its own. Courtesy credit to the artist is recorded in
the manifest.

| File | Title | Artist | Category | Length | Source |
| --- | --- | --- | --- | --- | --- |
| `deep-meditation.mp3` | Deep Meditation | Alejandro Magaña (A. M.) | Ambient | 2:27 | <https://assets.mixkit.co/music/109/109.mp3> |
| `charlotte.mp3` | Charlotte | Eugenio Mininni | Ambient | 3:45 | <https://assets.mixkit.co/music/586/586.mp3> |
| `opalescent.mp3` | Opalescent | Eugenio Mininni | Ambient | 4:44 | <https://assets.mixkit.co/music/593/593.mp3> |
| `vastness.mp3` | Vastness | Andrew Ev | Ambient | 3:50 | <https://assets.mixkit.co/music/184/184.mp3> |
| `rest-now.mp3` | Rest Now | Eugenio Mininni | Ambient | 5:00 | <https://assets.mixkit.co/music/584/584.mp3> |
| `smooth-meditation.mp3` | Smooth Meditation | Arulo | Ambient | 2:34 | <https://assets.mixkit.co/music/324/324.mp3> |
| `forest-mist-whispers.mp3` | Forest Mist Whispers | Alejandro Magaña (A. M.) | Ambient | 2:31 | <https://assets.mixkit.co/music/148/148.mp3> |
| `relaxation-07.mp3` | Relaxation 07 | Lily J | Ambient | 2:24 | <https://assets.mixkit.co/music/760/760.mp3> |
| `finding-myself.mp3` | Finding Myself | Michael Ramir C. | Ambient | 2:14 | <https://assets.mixkit.co/music/993/993.mp3> |
| `piano-reflections.mp3` | Piano Reflections | Ahjay Stelino | Piano | 3:19 | <https://assets.mixkit.co/music/22/22.mp3> |
| `tears-of-joy.mp3` | Tears of Joy | Michael Ramir C. | Piano | 2:20 | <https://assets.mixkit.co/music/839/839.mp3> |
| `skyline.mp3` | Skyline | Eugenio Mininni | Piano | 3:26 | <https://assets.mixkit.co/music/601/601.mp3> |
| `classical-7.mp3` | Classical 7 | Jonny S. | Piano | 2:36 | <https://assets.mixkit.co/music/714/714.mp3> |
| `staring-at-the-night-sky.mp3` | Staring at the Night Sky | Alejandro Magaña (A. M.) | Piano | 2:22 | <https://assets.mixkit.co/music/168/168.mp3> |
| `possible-dreams.mp3` | Possible Dreams | Eugenio Mininni | Piano | 2:39 | <https://assets.mixkit.co/music/599/599.mp3> |
| `river-flow.mp3` | River Flow | Eugenio Mininni | Cinematic | 4:30 | <https://assets.mixkit.co/music/594/594.mp3> |
| `drawing-the-sky.mp3` | Drawing the Sky | Eugenio Mininni | Cinematic | 3:27 | <https://assets.mixkit.co/music/606/606.mp3> |
| `moon-walk.mp3` | Moon Walk | Eugenio Mininni | Cinematic | 3:25 | <https://assets.mixkit.co/music/609/609.mp3> |

Catalogue pages: [Ambient](https://mixkit.co/free-stock-music/ambient/),
[Piano](https://mixkit.co/free-stock-music/piano/),
[Cinematic](https://mixkit.co/free-stock-music/cinematic/).

### Verification performed

- Every file was downloaded and exists on disk (checked with `ffprobe`); no
  entry exists in the manifest without a file.
- Durations are 2:14–5:00 and bitrates 256–320 kb/s MP3.
- A served file returned `200 audio/mpeg` and played in the dashboard preview
  player (playback position advanced past 5 seconds).
- The catalogue JSON-LD marks all 18 as Ambient/Piano/Cinematic instrumentals.
  They were selected from those instrumental categories; an automated vocal
  detector was not available, so vocal absence was not machine-audited.
- No copyrighted commercial worship recordings were downloaded or imitated.

## Original tracks (kept from earlier phases)

Synthesised locally by `scripts/generate_music.py`, dedicated to the public
domain (CC0 1.0), no samples:

| File | Title | Length |
| --- | --- | --- |
| `peaceful-prayer-01.ogg` | Peaceful Prayer | 3:28 |
| `piano-worship-01.ogg` | Piano Worship | 3:24 |
| `morning-prayer-01.ogg` | Morning Prayer | 3:20 |

## Removed on request

| Removed title | File | Backup |
| --- | --- | --- |
| Quiet Hour | `peaceful-prayer-02.ogg` | `docs/backups/music-removed/peaceful-prayer-02.ogg` |
| Cathedral Light | `cathedral-ambient-01.ogg` | `docs/backups/music-removed/cathedral-ambient-01.ogg` |

Both were removed from the manifest, playlist rotation, dashboard and the
generator's track list. The audio files were moved to the backup folder, not
deleted.
