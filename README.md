# X-Ray Scanner

Point your phone camera at a hand, a body or a face and see realistic 3D bones inside it, moving with you. Tap any bone to learn about it, then test yourself with a quiz.

Everything runs in the browser on the device. No pictures are uploaded anywhere.

These are 3D models of one adult man's anatomy, stretched to fit the tracked joints. A camera cannot see through skin, so they are not the viewer's own bones, and this is not a medical X-ray or a diagnostic tool.

## What it does

| Mode | What you see | Tracking model |
|---|---|---|
| **Hand** | All 27 hand bones by name, plus the radius and ulna | MediaPipe Hand Landmarker (21 points per hand, up to 2 hands) |
| **Body** | Skull, spine, ribs, collarbones, shoulder blades, pelvis, arms, hands, legs and feet | MediaPipe Pose Landmarker (33 points) |
| **Skull** | Every skull bone by name, with individual teeth. The jaw opens when the mouth does | MediaPipe Face Landmarker (478 points) |

- **Two looks:** realistic ivory bone with lighting and shadows, or **X-ray film**, a simulated radiograph where bone edges glow and overlaps add up.
- **Tap a bone** for its name, what the name means and a fun fact.
- **Quiz me** asks 10 "Find your scaphoid!" questions, using only bones you can see and tap in the picture. You score a point for finding a bone first time; a wrong tap gives you a clue, and three wrong taps show you the answer. Your best score is remembered on that device.
- **Freeze** (big round button) holds the picture so you can tap calmly.
- **Timer** freezes the picture after 5 seconds, so you have time to step back. The quiz does this too (3 seconds for Hand and Skull, 5 for Body).
- **Photo** button: load a picture instead of using the camera.
- **Labels** and **Colours** change how the bones are shown. **Save** downloads a picture.

## How it works

1. **Camera** – the browser's `getUserMedia` gives us the live video.
2. **Tracking** – Google's [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/guide) models find key points on the hand, body or face, many times per second, including an estimate of how far each point is from the camera.
3. **Fitting** – each model knows where its joints sit in its original standing pose. Every frame, `rig.js` works out the movement that carries each bone from there to its place between the tracked joints. Each bone turns in 3D and stretches along its length to fit.
4. **Drawing** – `render3d.js` draws the bones with [three.js](https://threejs.org) on a see-through layer over the camera. The camera has no perspective, so each joint lands exactly on its tracked pixel. If a device can't keep up, the app drops shadows first and then sharpness.

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout: start screen, camera, buttons, cards |
| `style.css` | All the styling |
| `app.js` | Camera, tracking, modes, freeze/timer/save, tapping |
| `rig.js` | Fits the 3D bones to the tracked joints |
| `render3d.js` | The realistic and X-ray looks, and finding which bone was tapped |
| `overlay.js` | The soft flesh shading, labels and name tags |
| `facts.js` | Every bone's name, meaning, fun fact and quiz clue. Edit this to change the wording |
| `quiz.js` | Quiz rules and scoring |
| `models/` | The three 3D models (2.6 MB in total) and their credits |
| `server.mjs` | A tiny local web server for testing on this computer |
| `tools/` | Builds the models from the original bone files. Not needed to run the app |

## Run it on this computer

The camera only works when the page comes from a web server (not by double-clicking the file).

```bash
node server.mjs
```

Then open http://localhost:5173 in Chrome or Edge.

## Put it online with GitHub Pages

Phones only allow the camera on **https://** websites. GitHub Pages provides that for free, and the app needs no build step.

**In the browser:**

1. Create a new **public** repository on GitHub, for example `xray-scanner`.
2. Choose **uploading an existing file** and drag in `index.html`, `style.css`, `app.js`, `rig.js`, `render3d.js`, `overlay.js`, `facts.js`, `quiz.js` and the whole `models` folder. Commit them.
3. Go to **Settings → Pages**. Under "Build and deployment", pick **Deploy from a branch**, then branch **main** and folder **/ (root)**, and save.
4. After a minute or two the site is at `https://YOUR-USERNAME.github.io/xray-scanner/`. Open that on your phone and allow the camera.

To update it later, upload the changed files again. Changes can take a few minutes to appear.

The website address is public, but nothing a visitor films leaves their own device. The first visit downloads the tracker and bones, so it needs a good connection; after that the browser keeps a copy. It needs a reasonably recent browser (on iPhone, iOS 16.4 or later).

## Tips for best results

- Good light and a plain background.
- **Hand:** show the whole hand with your fingers slightly spread.
- **Body:** step back until your whole body fits, or ask a friend to hold the phone. Facing the camera works best.
- **Skull:** switch to the selfie camera to see your own, then try opening your mouth.

## Limits

- Everyone sees the same adult male skeleton, resized to fit. Its makers describe clinical-grade accuracy as a goal and warn that the data may still contain errors.
- Bone positions come from the tracker's estimate of the joints. Depth is its least reliable measurement, so bones can wobble or tilt a little.
- The fine surface texture is added by the app, not measured from real bone.
- In Hand mode the tracker can't see the elbow, so the forearm bones run straight on from the hand and fade out.
- In Body mode each hand and foot moves as one piece, because that tracker follows only a few points on them, and the head stays upright rather than nodding.
- The source model has no tailbone.

## Rebuilding the models

You only need this to change the models themselves.

1. Download `isa_BP3D_4.0_obj_99.zip` (136 MB) and `isa_element_parts.txt` from the [BodyParts3D site](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html), and unzip the archive.
2. In the `tools` folder:

```bash
npm install
```

```bash
node build-models.mjs "path/to/isa_BP3D_4.0_obj_99" "path/to/isa_element_parts.txt" ../models
```

`tools/viewer.html` shows the models in their standing pose, at http://localhost:5173/tools/viewer.html (run `show({ model: 'skull' })` in the browser console).

## Credits

- **3D bones:** BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International. Simplified and re-shaded for this app. See `models/CREDITS.txt`.
- **Tracking:** [MediaPipe](https://github.com/google-ai-edge/mediapipe) by Google (Apache 2.0).
- **3D drawing:** [three.js](https://threejs.org) (MIT).

## Ideas for next phases

- "Ask the skeleton" questions using EmbeddingGemma 2.
- Pinch to zoom, for tapping small bones on a far-away body.
