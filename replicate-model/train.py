import shutil
import tempfile
import zipfile
from pathlib import Path

import requests
from cog import BasePredictor, Input, Path as CogPath
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
DATA_CONFIG = ROOT / "soccer.yaml"
DEFAULT_MODEL = "yolo11x.pt"


def _download_zip(url: str, dest: Path) -> None:
    response = requests.get(url, stream=True, timeout=120)
    response.raise_for_status()
    with dest.open("wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)


def _extract_dataset(zip_path: Path, workdir: Path) -> Path:
    with zipfile.ZipFile(zip_path, "r") as archive:
        archive.extractall(workdir)
    # Locate the directory that contains the train/valid/test splits
    for candidate in workdir.rglob("train"):
        if (candidate / "images").exists():
            return candidate.parent
    raise FileNotFoundError("Could not locate a train/images directory inside the dataset ZIP")


def _compose_data_yaml(dataset_root: Path, output_yaml: Path) -> None:
    # Use the provided soccer.yaml template but override the path dynamically
    output_yaml.write_text(
        DATA_CONFIG.read_text().replace("path: datasets/soccer", f"path: {dataset_root}")
    )


class Trainer(BasePredictor):
    def setup(self) -> None:
        self.weights_dir = ROOT / "weights"
        self.weights_dir.mkdir(parents=True, exist_ok=True)

    @Input(
        "roboflow_zip_url",
        type=str,
        help="Roboflow ZIP export URL for the soccer dataset (YOLOv11 format)",
    )
    @Input("epochs", type=int, default=50, help="Training epochs")
    @Input("imgsz", type=int, default=1280, help="Training image size")
    @Input("batch", type=int, default=-1, help="Batch size (-1 auto-tunes)")
    def predict(
        self,
        roboflow_zip_url: str,
        epochs: int = 50,
        imgsz: int = 1280,
        batch: int = -1,
    ) -> CogPath:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            zip_path = tmp_path / "dataset.zip"
            _download_zip(roboflow_zip_url, zip_path)
            dataset_root = _extract_dataset(zip_path, tmp_path)
            data_yaml = tmp_path / "soccer-data.yaml"
            _compose_data_yaml(dataset_root, data_yaml)

            model = YOLO(DEFAULT_MODEL)
            model.train(
                data=str(data_yaml),
                epochs=epochs,
                imgsz=imgsz,
                batch=batch,
                device=0,
                project="runs/train",
                name="soccer-yolo11x",
                exist_ok=True,
                optimizer="SGD",
                amp=True,
                cosine_lr=True,
                cache=True,
            )

        best_weight = ROOT / "runs/train/soccer-yolo11x/weights/best.pt"
        if not best_weight.exists():
            raise FileNotFoundError("Training finished but best.pt was not produced")

        output_weight = self.weights_dir / "best.pt"
        shutil.copy(best_weight, output_weight)
        return CogPath(output_weight)
