"""
ByteTrack implementation for multi-object tracking.
Optimized for sports player tracking with stable IDs.
"""

import logging
import numpy as np
from typing import Dict, List, Optional, Tuple

from ..models.schemas import BoundingBox, TrackingData

logger = logging.getLogger(__name__)


class KalmanBoxTracker:
    """Kalman filter for 2D bounding box tracking."""
    
    count = 0
    
    def __init__(self, bbox: BoundingBox, timestamp: float):
        """Initialize tracker with initial bounding box."""
        self.id = KalmanBoxTracker.count
        KalmanBoxTracker.count += 1
        
        # State: [center_x, center_y, width, height, dx, dy, dw, dh]
        self.state = np.array([
            bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, 0, 0
        ], dtype=np.float32)
        
        # State covariance matrix
        self.covariance = np.eye(8, dtype=np.float32)
        self.covariance[4:, 4:] *= 1000.0  # High uncertainty for velocities
        
        # Process noise
        self.process_noise = np.eye(8, dtype=np.float32)
        self.process_noise[:4, :4] *= 0.01  # Position noise
        self.process_noise[4:, 4:] *= 0.01  # Velocity noise
        
        # Measurement noise
        self.measurement_noise = np.eye(4, dtype=np.float32) * 0.1
        
        # Transition matrix (constant velocity model)
        self.transition = np.eye(8, dtype=np.float32)
        self.transition[:4, 4:] = np.eye(4)  # Position += velocity
        
        # Measurement matrix (observe position and size)
        self.measurement = np.zeros((4, 8), dtype=np.float32)
        self.measurement[:4, :4] = np.eye(4)
        
        self.time_since_update = 0
        self.hit_streak = 0
        self.hits = 1
        self.age = 1
        self.last_timestamp = timestamp
        self.confidence = bbox.confidence
        
    def update(self, bbox: BoundingBox, timestamp: float):
        """Update tracker with new detection."""
        dt = timestamp - self.last_timestamp
        self.last_timestamp = timestamp
        
        # Adjust transition matrix for variable time step
        transition = self.transition.copy()
        transition[:4, 4:] *= dt
        
        # Prediction step
        self.state = transition @ self.state
        self.covariance = (
            transition @ self.covariance @ transition.T + 
            self.process_noise * dt
        )
        
        # Update step
        measurement = np.array([bbox.x, bbox.y, bbox.width, bbox.height])
        innovation = measurement - self.measurement @ self.state
        innovation_cov = (
            self.measurement @ self.covariance @ self.measurement.T + 
            self.measurement_noise
        )
        
        kalman_gain = (
            self.covariance @ self.measurement.T @ 
            np.linalg.inv(innovation_cov)
        )
        
        self.state += kalman_gain @ innovation
        self.covariance = (
            np.eye(8) - kalman_gain @ self.measurement
        ) @ self.covariance
        
        # Update tracking statistics
        self.time_since_update = 0
        self.hit_streak += 1
        self.hits += 1
        self.confidence = max(self.confidence * 0.9, bbox.confidence)
        
    def predict(self, timestamp: float) -> BoundingBox:
        """Predict current state."""
        dt = timestamp - self.last_timestamp
        
        # Predict state
        transition = self.transition.copy()
        transition[:4, 4:] *= dt
        predicted_state = transition @ self.state
        
        # Clamp to valid ranges
        x = np.clip(predicted_state[0], 0.0, 1.0)
        y = np.clip(predicted_state[1], 0.0, 1.0)
        w = np.clip(predicted_state[2], 0.01, 1.0)
        h = np.clip(predicted_state[3], 0.01, 1.0)
        
        self.age += 1
        self.time_since_update += 1
        
        return BoundingBox(
            x=float(x),
            y=float(y),
            width=float(w),
            height=float(h),
            confidence=self.confidence * 0.95  # Decay confidence
        )
    
    def get_state(self) -> BoundingBox:
        """Get current state as bounding box."""
        return BoundingBox(
            x=float(np.clip(self.state[0], 0.0, 1.0)),
            y=float(np.clip(self.state[1], 0.0, 1.0)),
            width=float(np.clip(self.state[2], 0.01, 1.0)),
            height=float(np.clip(self.state[3], 0.01, 1.0)),
            confidence=float(self.confidence)
        )


class ByteTracker:
    """ByteTrack multi-object tracker for sports players."""
    
    def __init__(
        self,
        track_thresh: float = 0.6,
        track_buffer: int = 30,
        match_thresh: float = 0.8,
        frame_rate: int = 30
    ):
        self.track_thresh = track_thresh
        self.track_buffer = track_buffer
        self.match_thresh = match_thresh
        self.frame_rate = frame_rate
        
        # Active trackers
        self.tracked_stracks: List[KalmanBoxTracker] = []
        self.lost_stracks: List[KalmanBoxTracker] = []
        self.removed_stracks: List[KalmanBoxTracker] = []
        
        # Frame counter
        self.frame_id = 0
        
        # Performance stats
        self.total_tracks = 0
        self.active_tracks = 0
        
    def update(
        self, 
        detections: List[BoundingBox], 
        timestamp: float
    ) -> List[TrackingData]:
        """
        Update tracker with new detections.
        
        Args:
            detections: List of detected bounding boxes
            timestamp: Current frame timestamp
            
        Returns:
            List of tracking data for active tracks
        """
        self.frame_id += 1
        
        # Separate high and low confidence detections
        high_conf_dets = [d for d in detections if d.confidence >= self.track_thresh]
        low_conf_dets = [d for d in detections if d.confidence < self.track_thresh]
        
        # Predict existing tracks
        for track in self.tracked_stracks:
            track.predict(timestamp)
        
        # First association with high confidence detections
        matches, unmatched_dets, unmatched_trks = self._associate(
            high_conf_dets, self.tracked_stracks, self.match_thresh
        )
        
        # Update matched tracks
        for m in matches:
            self.tracked_stracks[m[1]].update(high_conf_dets[m[0]], timestamp)
        
        # Second association with low confidence detections
        if len(low_conf_dets) > 0 and len(unmatched_trks) > 0:
            unmatched_low_trks = [self.tracked_stracks[i] for i in unmatched_trks]
            matches_low, unmatched_dets_low, unmatched_trks_low = self._associate(
                low_conf_dets, unmatched_low_trks, 0.5
            )
            
            # Update matched tracks with low confidence detections
            for m in matches_low:
                track_idx = unmatched_trks[m[1]]
                self.tracked_stracks[track_idx].update(low_conf_dets[m[0]], timestamp)
            
            # Update unmatched high confidence detections
            unmatched_dets = [high_conf_dets[i] for i in unmatched_dets]
        else:
            unmatched_dets = [high_conf_dets[i] for i in unmatched_dets]
        
        # Initialize new tracks for unmatched detections
        for det in unmatched_dets:
            if det.confidence >= self.track_thresh:
                new_track = KalmanBoxTracker(det, timestamp)
                self.tracked_stracks.append(new_track)
                self.total_tracks += 1
        
        # Handle lost tracks
        lost_stracks = []
        for i in reversed(range(len(self.tracked_stracks))):
            track = self.tracked_stracks[i]
            if track.time_since_update > self.track_buffer:
                lost_stracks.append(self.tracked_stracks.pop(i))
        
        self.lost_stracks.extend(lost_stracks)
        
        # Remove old lost tracks
        self.lost_stracks = [
            track for track in self.lost_stracks 
            if track.time_since_update <= self.track_buffer
        ]
        
        # Generate tracking data for active tracks
        tracking_data = []
        for track in self.tracked_stracks:
            if track.hit_streak >= 3:  # Only return stable tracks
                tracking_data.append(TrackingData(
                    track_id=track.id,
                    bounding_box=track.get_state(),
                    timestamp=timestamp
                ))
        
        self.active_tracks = len(tracking_data)
        
        logger.debug(
            f"🔗 Frame {self.frame_id}: {len(tracking_data)} active tracks, "
            f"{len(detections)} detections"
        )
        
        return tracking_data
    
    def _associate(
        self, 
        detections: List[BoundingBox], 
        trackers: List[KalmanBoxTracker], 
        iou_threshold: float
    ) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """Associate detections with trackers using IoU."""
        if len(trackers) == 0:
            return [], list(range(len(detections))), []
        
        # Compute IoU matrix
        iou_matrix = np.zeros((len(detections), len(trackers)))
        for d, det in enumerate(detections):
            for t, track in enumerate(trackers):
                pred_box = track.get_state()
                iou_matrix[d, t] = self._compute_iou(det, pred_box)
        
        # Hungarian algorithm for optimal assignment
        matched_indices = []
        
        # Simple greedy matching (can be replaced with Hungarian algorithm)
        used_det_indices = set()
        used_trk_indices = set()
        
        # Sort by IoU score (descending)
        coords = np.where(iou_matrix >= iou_threshold)
        scores = iou_matrix[coords]
        indices = np.argsort(-scores)
        
        for idx in indices:
            d, t = coords[0][idx], coords[1][idx]
            if d not in used_det_indices and t not in used_trk_indices:
                matched_indices.append((d, t))
                used_det_indices.add(d)
                used_trk_indices.add(t)
        
        # Get unmatched detections and trackers
        unmatched_detections = [
            d for d in range(len(detections)) 
            if d not in used_det_indices
        ]
        unmatched_trackers = [
            t for t in range(len(trackers)) 
            if t not in used_trk_indices
        ]
        
        return matched_indices, unmatched_detections, unmatched_trackers
    
    def _compute_iou(self, box1: BoundingBox, box2: BoundingBox) -> float:
        """Compute Intersection over Union (IoU) between two boxes."""
        # Convert center format to corner format
        x1_min = box1.x - box1.width / 2
        y1_min = box1.y - box1.height / 2
        x1_max = box1.x + box1.width / 2
        y1_max = box1.y + box1.height / 2
        
        x2_min = box2.x - box2.width / 2
        y2_min = box2.y - box2.height / 2
        x2_max = box2.x + box2.width / 2
        y2_max = box2.y + box2.height / 2
        
        # Compute intersection
        inter_x_min = max(x1_min, x2_min)
        inter_y_min = max(y1_min, y2_min)
        inter_x_max = min(x1_max, x2_max)
        inter_y_max = min(y1_max, y2_max)
        
        if inter_x_max <= inter_x_min or inter_y_max <= inter_y_min:
            return 0.0
        
        inter_area = (inter_x_max - inter_x_min) * (inter_y_max - inter_y_min)
        
        # Compute union
        area1 = box1.width * box1.height
        area2 = box2.width * box2.height
        union_area = area1 + area2 - inter_area
        
        if union_area <= 0:
            return 0.0
        
        return inter_area / union_area
    
    def get_track_by_id(self, track_id: int) -> Optional[KalmanBoxTracker]:
        """Get track by ID."""
        for track in self.tracked_stracks:
            if track.id == track_id:
                return track
        return None
    
    def get_performance_stats(self) -> dict:
        """Get tracking performance statistics."""
        return {
            "total_tracks": self.total_tracks,
            "active_tracks": self.active_tracks,
            "lost_tracks": len(self.lost_stracks),
            "frame_id": self.frame_id
        }
    
    def reset(self):
        """Reset tracker state."""
        self.tracked_stracks.clear()
        self.lost_stracks.clear()
        self.removed_stracks.clear()
        self.frame_id = 0
        KalmanBoxTracker.count = 0