import shutil
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import requests
from cog import BasePredictor, Input, Path as CogPath
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "weights/best.pt"
TRACKER_CONFIG = ROOT / "botsort.yaml"
SPOTLIGHT_DARKEN = 0.3
TRAIL_LENGTH = 12


def _download_video(url: str, dest: Path) -> None:
    response = requests.get(url, stream=True, timeout=120)
    response.raise_for_status()
    with dest.open("wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


def _ensure_local_video(video: str) -> Path:
    video_path = Path(video)
    if video_path.exists():
        return video_path
    tmp_dir = Path(tempfile.mkdtemp())
    dest = tmp_dir / "input.mp4"
    _download_video(video, dest)
    return dest


def _spotlight_frame(
    frame: np.ndarray,
    box: Tuple[float, float, float, float],
    track_id: int,
    trail_history: Dict[int, List[Tuple[int, int]]],
) -> np.ndarray:
    x1, y1, x2, y2 = [int(v) for v in box]
    cx = int((x1 + x2) / 2)
    cy = int((y1 + y2) / 2)
    radius = int(max(x2 - x1, y2 - y1) * 0.75)

    overlay = (frame * SPOTLIGHT_DARKEN).astype(np.uint8)
    mask = np.zeros_like(frame, dtype=np.uint8)
    cv2.circle(mask, (cx, cy), max(radius, 1), (255, 255, 255), -1, lineType=cv2.LINE_AA)
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=max(radius / 2, 1))

    alpha = mask.astype(np.float32) / 255.0
    spotlighted = overlay + (frame * alpha).astype(np.uint8)

    # Glowing ring
    cv2.circle(
        spotlighted,
        (cx, cy),
        max(radius + 6, 2),
        (40, 220, 120),
        6,
        lineType=cv2.LINE_AA,
    )

    # Bold bounding box for the selected player
    cv2.rectangle(spotlighted, (x1, y1), (x2, y2), (50, 255, 160), thickness=4, lineType=cv2.LINE_AA)

    # Trail history
    history = trail_history.setdefault(track_id, [])
    history.append((cx, cy))
    if len(history) > TRAIL_LENGTH:
        history.pop(0)

    for i, (px, py) in enumerate(history):
        weight = (i + 1) / len(history)
        color = (50, int(220 * weight), 160)
        cv2.circle(spotlighted, (px, py), max(2, int(6 * weight)), color, -1, lineType=cv2.LINE_AA)

    return spotlighted


def _extract_primary_box(result, selected_player_id: Optional[int]) -> Optional[Tuple[Tuple[float, float, float, float], int]]:
    boxes = result.boxes
    if boxes is None or boxes.xyxy is None or len(boxes) == 0:
        return None

    track_ids = boxes.id.cpu().tolist() if boxes.id is not None else [None] * len(boxes)
    confs = boxes.conf.cpu().tolist() if boxes.conf is not None else [0.0] * len(boxes)
    coords = boxes.xyxy.cpu().tolist()

    best_idx = None
    if selected_player_id is not None and selected_player_id in track_ids:
        best_idx = track_ids.index(selected_player_id)
    else:
        # choose the most confident track if no specific selection is present
        best_idx = int(np.argmax(confs))

    if best_idx is None:
        return None

    track_id = track_ids[best_idx]
    if track_id is None:
        track_id = selected_player_id if selected_player_id is not None else 0
    return coords[best_idx], int(track_id)


class Predictor(BasePredictor):
    def setup(self) -> None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                "weights/best.pt is required. Train with train.py or provide a fine-tuned YOLOv11 checkpoint."
            )
        self.model = YOLO(str(MODEL_PATH))
        self.tracker_cfg = str(TRACKER_CONFIG)

    @Input("video", type=str, help="Public URL or uploaded video file")
    @Input(
        "selected_player_id",
        type=int,
        default=None,
        help="If set, return spotlight player-cam of only this ID",
    )
    @Input("conf", type=float, default=0.4)
    def predict(
        self, video: str, selected_player_id: Optional[int] = None, conf: float = 0.4
    ) -> CogPath:
        source_path = _ensure_local_video(video)
        tmp_dir = Path(tempfile.mkdtemp())
        output_path = tmp_dir / "player_cam.mp4"

        # Probe fps/size for the writer
        probe = cv2.VideoCapture(str(source_path))
        fps = probe.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT))
        probe.release()

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

        trail_history: Dict[int, List[Tuple[int, int]]] = {}
        stream = self.model.track(
            source=str(source_path),
            tracker=self.tracker_cfg,
            conf=conf,
            stream=True,
            verbose=False,
            persist=True,
        )

        for result in stream:
            primary = _extract_primary_box(result, selected_player_id)
            frame = result.orig_img
            if primary is None:
                writer.write(frame)
                continue

            box, track_id = primary
            spotlighted = _spotlight_frame(frame, box, track_id, trail_history)
            writer.write(spotlighted)

        writer.release()

        final_output = ROOT / "outputs/player_cam.mp4"
        final_output.parent.mkdir(exist_ok=True)
        shutil.copy(output_path, final_output)
        return CogPath(final_output)
