Synthetic media used by the real browser regression suite. No personal media is included.

- `preview.png`: 1024 × 768 color test pattern. The suite compares its original dimensions and bytes with the authenticated static thumbnail.
- `preview.webm`: four seconds of a 160 × 90 VP8 color test pattern at 10 fps. Chromium can decode this fixture without proprietary codecs.
- Audio is generated as four seconds of 8 kHz mono PCM WAV by `audioFixture()` in `support.mjs`.

The fixtures are checked in so test runs do not require FFmpeg. To regenerate the image and video with FFmpeg:

```sh
ffmpeg -f lavfi -i testsrc=size=1024x768:rate=1 -frames:v 1 -threads 1 -y preview.png
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 4 -c:v libvpx -b:v 40k -an -y preview.webm
```
