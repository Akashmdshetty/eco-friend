"""
A deterministic, rules-based detector used for development and testing.
It does not require heavy ML models and returns consistent outputs the frontend expects.

API:
- SimpleDetector.detect_from_path(path: str) -> dict
"""
from __future__ import annotations
from typing import List, Dict, Any
from PIL import Image
import math
import os

# Basic mapping of filename keywords to detected items.
# This is intentionally simple: use real ML (ai_service) in production.
KEYWORD_MAP = {
    "bottle": {"name": "plastic_bottle", "action": "recycle", "points": 10, "carbon_saved_kg": 0.2},
    "can": {"name": "aluminum_can", "action": "recycle", "points": 8, "carbon_saved_kg": 0.15},
    "paper": {"name": "paper", "action": "recycle", "points": 5, "carbon_saved_kg": 0.05},
    "glass": {"name": "glass", "action": "recycle", "points": 12, "carbon_saved_kg": 0.25},
    "organic": {"name": "organic_waste", "action": "compost", "points": 3, "carbon_saved_kg": 0.01},
}


class SimpleDetector:
    def __init__(self):
        pass

    def detect_from_path(self, path: str) -> Dict[str, Any]:
        """
        Inspect the filename and very basic image heuristics to return
        detected items. Always returns a consistent structure.
        """
        filename = os.path.basename(path).lower()
        detected: List[Dict[str, Any]] = []

        # 1) Keyword matching
        for kw, info in KEYWORD_MAP.items():
            if kw in filename:
                detected.append(info.copy())

        # 2) Fallback heuristic: size-based detection (not ML, just a deterministic label)
        if not detected:
            try:
                with Image.open(path) as img:
                    w, h = img.size
                    area = w * h
                    # small images -> likely 'paper', large images -> 'bottle'
                    if area < 200 * 200:
                        detected.append(KEYWORD_MAP["paper"].copy())
                    else:
                        detected.append(KEYWORD_MAP["bottle"].copy())
            except Exception:
                # As ultimate fallback
                detected.append(KEYWORD_MAP["paper"].copy())

        recommendations = [f"Please {item['action']} the {item['name'].replace('_', ' ')}." for item in detected]

        return {
            "detected_objects": detected,
            "recommendations": recommendations
        }
