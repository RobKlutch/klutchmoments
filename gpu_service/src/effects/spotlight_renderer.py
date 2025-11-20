"""
OpenCV-based spotlight effect renderer for video overlays.
Supports various spotlight effects including circles, beams, and gradients.
"""

import logging
import numpy as np
import cv2
from typing import Tuple, Optional

from ..models.schemas import BoundingBox, EffectConfig, EffectType

logger = logging.getLogger(__name__)


class SpotlightRenderer:
    """Renders spotlight effects on video frames using OpenCV."""
    
    def __init__(self, frame_width: int, frame_height: int):
        self.frame_width = frame_width
        self.frame_height = frame_height
        
        # Pre-computed gradient cache for performance
        self._gradient_cache = {}
        
    def render_effect(
        self,
        frame: np.ndarray,
        tracking_box: BoundingBox,
        effect_config: EffectConfig,
        frame_index: int = 0
    ) -> np.ndarray:
        """
        Apply spotlight effect to frame based on tracking box.
        
        Args:
            frame: Input frame (BGR format)
            tracking_box: Normalized bounding box for tracked player
            effect_config: Effect configuration
            frame_index: Frame number (for animations)
            
        Returns:
            Frame with spotlight effect applied
        """
        try:
            # Convert normalized coordinates to pixel coordinates
            center_x = int(tracking_box.x * self.frame_width)
            center_y = int(tracking_box.y * self.frame_height)
            
            # Calculate radius based on bounding box size and config
            box_size = max(
                tracking_box.width * self.frame_width,
                tracking_box.height * self.frame_height
            )
            base_radius = max(50, int(box_size * 0.8))
            radius = max(base_radius, effect_config.radius)
            
            # Apply effect based on type
            if effect_config.type == EffectType.CIRCLE:
                return self._render_circular_spotlight(
                    frame, center_x, center_y, radius, effect_config
                )
            elif effect_config.type == EffectType.BEAM:
                return self._render_beam_spotlight(
                    frame, center_x, center_y, radius, effect_config
                )
            elif effect_config.type == EffectType.GRADIENT:
                return self._render_gradient_spotlight(
                    frame, center_x, center_y, radius, effect_config
                )
            else:
                logger.warning(f"Unknown effect type: {effect_config.type}")
                return frame
                
        except Exception as e:
            logger.error(f"❌ Effect rendering failed: {e}")
            return frame
    
    def _render_circular_spotlight(
        self,
        frame: np.ndarray,
        center_x: int,
        center_y: int,
        radius: int,
        config: EffectConfig
    ) -> np.ndarray:
        """Render circular spotlight effect."""
        # Create mask for spotlight
        mask = np.zeros((self.frame_height, self.frame_width), dtype=np.float32)
        
        # Create coordinate matrices
        y, x = np.ogrid[:self.frame_height, :self.frame_width]
        
        # Calculate distance from center
        distance = np.sqrt((x - center_x)**2 + (y - center_y)**2)
        
        # Create smooth circular gradient
        inner_radius = max(1, radius - config.feather)
        outer_radius = radius + config.feather
        
        # Spotlight intensity (1.0 in center, fading to config.intensity outside)
        mask = np.where(
            distance <= inner_radius,
            1.0,  # Full intensity in center
            np.where(
                distance <= outer_radius,
                1.0 - (distance - inner_radius) / (outer_radius - inner_radius) * (1.0 - config.intensity),
                config.intensity  # Dimmed outside
            )
        )
        
        # Apply mask to frame
        result = frame.copy().astype(np.float32)
        for channel in range(3):
            result[:, :, channel] *= mask
        
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def _render_beam_spotlight(
        self,
        frame: np.ndarray,
        center_x: int,
        center_y: int,
        radius: int,
        config: EffectConfig
    ) -> np.ndarray:
        """Render vertical beam spotlight effect."""
        # Create mask for vertical beam
        mask = np.full((self.frame_height, self.frame_width), config.intensity, dtype=np.float32)
        
        # Create coordinate matrix for x-axis
        x = np.arange(self.frame_width)
        
        # Calculate distance from center line
        distance_from_center = np.abs(x - center_x)
        
        # Create beam profile
        beam_half_width = radius // 2
        feather_zone = config.feather
        
        # Beam intensity profile
        beam_mask = np.where(
            distance_from_center <= beam_half_width,
            1.0,  # Full intensity in beam center
            np.where(
                distance_from_center <= beam_half_width + feather_zone,
                1.0 - (distance_from_center - beam_half_width) / feather_zone * (1.0 - config.intensity),
                config.intensity  # Dimmed outside beam
            )
        )
        
        # Apply beam mask to all rows
        mask = np.tile(beam_mask, (self.frame_height, 1))
        
        # Apply mask to frame
        result = frame.copy().astype(np.float32)
        for channel in range(3):
            result[:, :, channel] *= mask
        
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def _render_gradient_spotlight(
        self,
        frame: np.ndarray,
        center_x: int,
        center_y: int,
        radius: int,
        config: EffectConfig
    ) -> np.ndarray:
        """Render radial gradient spotlight effect."""
        # Create mask with radial gradient
        mask = np.zeros((self.frame_height, self.frame_width), dtype=np.float32)
        
        # Create coordinate matrices
        y, x = np.ogrid[:self.frame_height, :self.frame_width]
        
        # Calculate distance from center
        distance = np.sqrt((x - center_x)**2 + (y - center_y)**2)
        
        # Create radial gradient
        max_distance = radius * 1.5
        normalized_distance = np.clip(distance / max_distance, 0, 1)
        
        # Smooth gradient function
        gradient = 1.0 - normalized_distance
        gradient = np.power(gradient, 0.7)  # Adjust curve
        
        # Scale by intensity
        mask = config.intensity + (1.0 - config.intensity) * gradient
        
        # Apply mask to frame
        result = frame.copy().astype(np.float32)
        for channel in range(3):
            result[:, :, channel] *= mask
        
        return np.clip(result, 0, 255).astype(np.uint8)
    
    def add_player_highlight(
        self,
        frame: np.ndarray,
        tracking_box: BoundingBox,
        color: Tuple[int, int, int] = (0, 255, 255),  # Yellow in BGR
        thickness: int = 3
    ) -> np.ndarray:
        """Add colored highlight box around tracked player."""
        # Convert normalized coordinates to pixel coordinates
        x = int((tracking_box.x - tracking_box.width / 2) * self.frame_width)
        y = int((tracking_box.y - tracking_box.height / 2) * self.frame_height)
        w = int(tracking_box.width * self.frame_width)
        h = int(tracking_box.height * self.frame_height)
        
        # Ensure coordinates are within frame bounds
        x = max(0, min(x, self.frame_width - 1))
        y = max(0, min(y, self.frame_height - 1))
        w = max(1, min(w, self.frame_width - x))
        h = max(1, min(h, self.frame_height - y))
        
        # Draw rectangle
        result = frame.copy()
        cv2.rectangle(result, (x, y), (x + w, y + h), color, thickness)
        
        # Add confidence text
        conf_text = f"{tracking_box.confidence:.2f}"
        text_size = cv2.getTextSize(conf_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
        text_x = x
        text_y = max(y - 10, text_size[1] + 5)
        
        # Background for text
        cv2.rectangle(
            result,
            (text_x, text_y - text_size[1] - 5),
            (text_x + text_size[0] + 5, text_y + 5),
            color,
            -1
        )
        
        # Text
        cv2.putText(
            result,
            conf_text,
            (text_x + 2, text_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 0, 0),  # Black text
            2
        )
        
        return result
    
    def create_overlay_frame(
        self,
        frame: np.ndarray,
        tracking_data: list,
        effect_config: EffectConfig,
        selected_track_id: Optional[int] = None,
        frame_index: int = 0
    ) -> np.ndarray:
        """
        Create complete overlay frame with spotlight and highlights.
        
        Args:
            frame: Input frame
            tracking_data: List of TrackingData objects
            effect_config: Effect configuration
            selected_track_id: ID of player to spotlight (None for auto-select)
            frame_index: Frame number
            
        Returns:
            Frame with complete overlay applied
        """
        if not tracking_data:
            return frame
        
        result = frame.copy()
        
        # Auto-select player if not specified (largest/most central)
        if selected_track_id is None:
            selected_track = max(
                tracking_data,
                key=lambda t: t.bounding_box.width * t.bounding_box.height * t.bounding_box.confidence
            )
        else:
            selected_track = next(
                (t for t in tracking_data if t.track_id == selected_track_id),
                tracking_data[0] if tracking_data else None
            )
        
        if selected_track:
            # Apply spotlight effect to selected player
            result = self.render_effect(
                result,
                selected_track.bounding_box,
                effect_config,
                frame_index
            )
            
            # Add highlight box to selected player
            result = self.add_player_highlight(
                result,
                selected_track.bounding_box,
                color=(0, 255, 255),  # Yellow highlight
                thickness=4
            )
        
        # Add subtle highlights to other players
        for track in tracking_data:
            if track.track_id != (selected_track.track_id if selected_track else -1):
                result = self.add_player_highlight(
                    result,
                    track.bounding_box,
                    color=(255, 255, 255),  # White highlight
                    thickness=2
                )
        
        return result
    
    def update_dimensions(self, width: int, height: int):
        """Update frame dimensions."""
        self.frame_width = width
        self.frame_height = height
        self._gradient_cache.clear()  # Clear cache on dimension change