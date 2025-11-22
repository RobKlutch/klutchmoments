# Replicate Model (YOLOv11 + BoT-SORT for Klutch)

This folder is a self-contained Cog project for training and deploying the soccer-focused YOLOv11 + BoT-SORT tracker to Replicate. It is intentionally isolated from the Klutch web app; publish it separately and reference the resulting model ID from the app via `REPLICATE_YOLO_MODEL`.

## Contents
- `cog.yaml` – Cog build definition (GPU, Python/Torch versions, deps)
- `train.py` – Cog training predictor; fine-tunes YOLOv11x on a Roboflow ZIP and writes `weights/best.pt` during training (not committed)
- `predict.py` – Cog inference predictor implementing the expected Klutch signature
- `soccer.yaml` – Dataset template used by `train.py`
- `botsort.yaml` – BoT-SORT tracking parameters with Re-ID
- `docs/env-vars.md` – Model-side environment guidance

## Setup
```bash
# Install Cog (host machine)
pip install cog

# From this directory
cog build
```

## Training
```bash
cog predict -i roboflow_zip_url="<roboflow-zip-url>" -i epochs=50 -i imgsz=1280 -i batch=-1 -p train.py:Trainer
```
This command downloads the Roboflow export, composes a data YAML, trains YOLOv11x, and writes `weights/best.pt` under a generated `weights/` directory (ignored in git).

## Inference
```bash
cog predict -i video="https://example.com/clip.mp4" -i selected_player_id=1 -i conf=0.4
```
The predictor downloads/reads the video, runs YOLOv11 + BoT-SORT tracking, and returns a player-cam video with spotlight + vignette. The output path returned by Cog is relative to this directory.

## Deploy to Replicate
```bash
cog push r8.im/<owner>/<model-name>
```
After pushing, set `REPLICATE_YOLO_MODEL=<owner>/<model>:<version>` in the app environment so the Klutch backend calls the hosted model via Replicate's HTTP API.

## Environment
Model-side environment variables are typically not required beyond Cog defaults. If you add private weights or additional integrations, document them in `docs/env-vars.md` and use a separate `.env.example` in this folder.
