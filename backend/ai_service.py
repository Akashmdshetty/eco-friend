# ai_service.py
"""
Robust AI service wrapper for Ultralytics YOLO.
- Handles PyTorch >= 2.6 safe-loading via add_safe_globals if available.
- Lazily loads model and returns stable JSON-friendly results.
- Works across a range of ultralytics result shapes.
"""

import os
import logging
from typing import List, Dict, Any

logger = logging.getLogger("ai_service")
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("[ai_service] %(levelname)s: %(message)s"))
    logger.addHandler(ch)
logger.setLevel(logging.INFO)

# Config (override via env if needed)
MODEL_WEIGHTS = os.environ.get("YOLO_WEIGHTS", "yolov8n.pt")
MODEL_CONF_THRESH = float(os.environ.get("YOLO_CONF_THRESHOLD", "0.25"))
MODEL_DEVICE = os.environ.get("YOLO_DEVICE", "")  # e.g. "cpu" or "0" or ""

# Module-level caches
_model = None
_model_load_error = None

def _allowlist_ultralytics_detectionmodel():
    """If available, add safe globals to allow torch.load to unpickle ultralytics classes."""
    try:
        import torch
        import ultralytics
        # add_safe_globals is available in PyTorch 2.6+ as described in error messages
        if hasattr(torch.serialization, "add_safe_globals"):
            # The exact entry required can vary; allowlist the DetectionModel and a known container type
            safe_list = []
            if hasattr(ultralytics, "nn") and hasattr(ultralytics.nn, "tasks") and hasattr(ultralytics.nn.tasks, "DetectionModel"):
                safe_list.append(ultralytics.nn.tasks.DetectionModel)
            # sometimes torch.nn.modules.container.Sequential is referenced during weight load:
            try:
                from torch.nn.modules.container import Sequential as TorchSequential
                safe_list.append(TorchSequential)
            except Exception:
                pass
            if safe_list:
                try:
                    torch.serialization.add_safe_globals(safe_list)
                    logger.info("add_safe_globals applied for ultralytics / torch.Sequential")
                except Exception as e:
                    logger.warning("add_safe_globals call failed: %s", e)
        else:
            logger.debug("torch.serialization.add_safe_globals not present on this PyTorch version")
    except Exception as e:
        logger.debug("Could not perform add_safe_globals: %s", e)

def load_model(weights: str = None, device: str = None):
    """Load the YOLO model once (lazy). Raises on first critical failure and caches error."""
    global _model, _model_load_error
    if _model is not None:
        return _model
    if _model_load_error is not None:
        raise RuntimeError("Previous model load failed: " + str(_model_load_error))

    weights = weights or MODEL_WEIGHTS
    device = device if device is not None else (MODEL_DEVICE or None)

    # attempt allowlist for safe unpickling
    _allowlist_ultralytics_detectionmodel()

    try:
        from ultralytics import YOLO
        logger.info("Loading YOLO from weights=%s device=%s", weights, device or "default")
        if device:
            _model = YOLO(weights, device=device)
        else:
            _model = YOLO(weights)
        logger.info("Model loaded successfully.")
        return _model
    except Exception as e:
        _model_load_error = e
        logger.error("Failed to load YOLO model: %s", e)
        # keep error in state; callers can decide to fallback
        raise

def _ensure_model() -> bool:
    """Ensure model is present. Returns True if model loaded, False otherwise."""
    global _model
    try:
        if _model is None:
            load_model()
        return _model is not None
    except Exception as e:
        logger.warning("Model ensure failed: %s", e)
        return False

def _extract_from_result_object(r) -> List[Dict[str, Any]]:
    """
    Given a single ultralytics Results object (r), try to extract detections robustly.
    Support multiple ultralytics versions by checking common shapes.
    """
    detections = []
    try:
        # Typical approach: r.boxes has xyxy, conf, cls
        boxes_obj = getattr(r, "boxes", None)
        names = getattr(r, "names", None) or {}
        # If boxes_obj exists and has xyxy attribute (tensor/np), use that
        if boxes_obj is not None:
            # prefer .xyxy, .conf, .cls
            xyxy = getattr(boxes_obj, "xyxy", None)
            confs = getattr(boxes_obj, "conf", None)
            cls_idxs = getattr(boxes_obj, "cls", None)
            # if those exist and are convertible to lists, do so
            if xyxy is not None:
                try:
                    # allow torch tensor or numpy arrays or list-like
                    if hasattr(xyxy, "cpu"):
                        arr = xyxy.cpu().numpy().tolist()
                    elif hasattr(xyxy, "tolist"):
                        arr = xyxy.tolist()
                    else:
                        arr = list(xyxy)
                except Exception:
                    arr = list(xyxy)
                # confs / cls conversion
                conf_list = []
                cls_list = []
                if confs is not None:
                    try:
                        if hasattr(confs, "cpu"):
                            conf_list = confs.cpu().numpy().tolist()
                        elif hasattr(confs, "tolist"):
                            conf_list = confs.tolist()
                        else:
                            conf_list = list(confs)
                    except Exception:
                        conf_list = [0.0] * len(arr)
                else:
                    conf_list = [0.0] * len(arr)

                if cls_idxs is not None:
                    try:
                        if hasattr(cls_idxs, "cpu"):
                            cls_list = cls_idxs.cpu().numpy().tolist()
                        elif hasattr(cls_idxs, "tolist"):
                            cls_list = cls_idxs.tolist()
                        else:
                            cls_list = list(cls_idxs)
                    except Exception:
                        cls_list = [None] * len(arr)
                else:
                    cls_list = [None] * len(arr)

                for xy, conf, cls_idx in zip(arr, conf_list, cls_list):
                    # sanitize
                    try:
                        bbox = [float(xy[0]), float(xy[1]), float(xy[2]), float(xy[3])]
                    except Exception:
                        continue
                    try:
                        conff = float(conf)
                    except Exception:
                        conff = 0.0
                    name = None
                    try:
                        if cls_idx is not None and names:
                            name = names[int(cls_idx)]
                        elif cls_idx is not None:
                            name = str(cls_idx)
                    except Exception:
                        name = str(cls_idx)
                    detections.append({"name": name, "conf": conff, "bbox": bbox})
                return detections

            # fallback: iterate boxes as objects (older ultralytics returned iterable box objects)
            try:
                iter_boxes = list(boxes_obj)
            except Exception:
                iter_boxes = None
            if iter_boxes:
                for b in iter_boxes:
                    # try to read attributes
                    xy = None
                    for attr in ("xyxy", "bbox", "data", "__iter__"):
                        try:
                            val = getattr(b, attr, None)
                            if val is None and attr == "__iter__":
                                # attempt to coerce into list(b)
                                try:
                                    tmp = list(b)
                                    if len(tmp) >= 4:
                                        xy = [float(tmp[0]), float(tmp[1]), float(tmp[2]), float(tmp[3])]
                                        break
                                except Exception:
                                    pass
                            elif val is not None:
                                if hasattr(val, "cpu"):
                                    xy_t = val.cpu().numpy().tolist()
                                elif hasattr(val, "tolist"):
                                    xy_t = val.tolist()
                                else:
                                    xy_t = list(val)
                                # xy_t may be shape (4,) or nested - take first 4 numbers
                                if isinstance(xy_t[0], (list, tuple)):
                                    xy = [float(xy_t[0][0]), float(xy_t[0][1]), float(xy_t[0][2]), float(xy_t[0][3])]
                                else:
                                    xy = [float(xy_t[0]), float(xy_t[1]), float(xy_t[2]), float(xy_t[3])]
                                break
                        except Exception:
                            continue

                    # conf and class
                    try:
                        conff = float(getattr(b, "conf", None) or getattr(b, "confidence", 0.0))
                    except Exception:
                        conff = 0.0
                    cls_idx = getattr(b, "cls", None) or getattr(b, "class_id", None)
                    name = None
                    try:
                        if cls_idx is not None and names:
                            name = names[int(cls_idx)]
                        elif cls_idx is not None:
                            name = str(cls_idx)
                    except Exception:
                        name = str(cls_idx)
                    if xy is not None:
                        detections.append({"name": name, "conf": conff, "bbox": xy})
                return detections

    except Exception as e:
        logger.debug("Error parsing result object: %s", e)
    # If we reach here, return empty list (no reliable boxes extracted)
    return detections

def detect_image(image_path: str, conf_thresh: float = None) -> Dict[str, Any]:
    """
    Run detection and return a response dict to be returned by the Flask endpoint.
    Response dict keys:
      - success: bool
      - detected_objects: list of {name, conf, bbox}
      - recommendations: list[str]
      - eco_points: int
      - carbon_saved_kg: float
      - debug: { ... }
    """
    conf_thresh = conf_thresh if conf_thresh is not None else MODEL_CONF_THRESH
    debug = {"model_loaded": _model is not None, "detections_count": 0, "model_load_error": None}

    # ensure model loaded
    if not _ensure_model():
        debug["model_load_error"] = str(_model_load_error) if _model_load_error else "Model not loaded"
        logger.warning("Model unavailable; returning demo fallback result")
        return {
            "success": False,
            "detected_objects": [],
            "recommendations": ["Demo fallback: model unavailable."],
            "eco_points": 0,
            "carbon_saved_kg": 0.0,
            "debug": debug
        }

    if not os.path.exists(image_path):
        logger.error("Input image does not exist: %s", image_path)
        return {
            "success": False,
            "detected_objects": [],
            "recommendations": ["Image file not found."],
            "eco_points": 0,
            "carbon_saved_kg": 0.0,
            "debug": {"error": "image_not_found"}
        }

    try:
        # run prediction using the cached model
        # prefer to call .predict (Ultralytics API)
        results = _model.predict(source=image_path, conf=conf_thresh, device=MODEL_DEVICE or None)
    except Exception as e:
        logger.exception("Error during model prediction: %s", e)
        return {
            "success": False,
            "detected_objects": [],
            "recommendations": ["AI prediction failed."],
            "eco_points": 0,
            "carbon_saved_kg": 0.0,
            "debug": {"exception": str(e)}
        }

    # aggregate detections across result(s)
    all_detections: List[Dict[str, Any]] = []
    try:
        for r in results:
            ds = _extract_from_result_object(r)
            if ds:
                all_detections.extend(ds)
    except Exception as e:
        logger.debug("Failed to aggregate results: %s", e)

    # sort by confidence desc and filter by conf_thresh
    filtered = [d for d in all_detections if (d.get("conf", 0.0) >= (conf_thresh or 0.0))]
    filtered.sort(key=lambda x: x.get("conf", 0.0), reverse=True)
    debug["detections_count"] = len(filtered)

    # build simple recommendations + points mapping (customize to your needs)
    recommendations = []
    eco_points = 0
    carbon_saved = 0.0

    if not filtered:
        recommendations.append("No objects detected. Try a clearer photo or different angle.")
    else:
        # Example simple mapping for common recyclable objects. Expand this dictionary as needed.
        mapping = {
            "bottle": {"action": "Recycle", "points": 10, "carbon": 0.5},
            "plastic": {"action": "Recycle", "points": 8, "carbon": 0.3},
            "can": {"action": "Recycle (aluminum)", "points": 8, "carbon": 0.4},
            "paper": {"action": "Recycle (paper)", "points": 5, "carbon": 0.1},
            "cardboard": {"action": "Recycle (cardboard)", "points": 6, "carbon": 0.2},
            "electronics": {"action": "E-waste dropoff", "points": 20, "carbon": 1.0}
        }
        # For each detection derive recommendation
        for det in filtered:
            name = (det.get("name") or "").lower() if det.get("name") else ""
            chosen = None
            for key in mapping:
                if key in name:
                    chosen = mapping[key]
                    break
            if chosen:
                recommendations.append(f"{det['name'] or 'Item'} — {chosen['action']}")
                eco_points += chosen["points"]
                carbon_saved += chosen["carbon"]
            else:
                # if we don't know, give a safe default
                recommendations.append(f"{det['name'] or 'Item'} — Unknown: please consult local recycling rules")
                eco_points += 0

    # prepare detected objects in returned payload
    out_detections = []
    for d in filtered:
        out_detections.append({
            "name": d.get("name"),
            "conf": float(d.get("conf") or 0.0),
            "bbox": [float(v) for v in d.get("bbox", [])]
        })

    response = {
        "success": True,
        "detected_objects": out_detections,
        "recommendations": recommendations,
        "eco_points": int(eco_points),
        "carbon_saved_kg": float(round(carbon_saved, 3)),
        "debug": debug
    }
    return response

# Backwards-compatible wrapper used by your Flask app
def analyze_image_file(image_path: str, conf_threshold: float = None) -> Dict[str, Any]:
    """Compatibility wrapper: returns the response dict expected by the Flask route."""
    return detect_image(image_path, conf_thresh=(conf_threshold if conf_threshold is not None else None) if False else conf_threshold)

# quick health helper
def health_check() -> Dict[str, Any]:
    global _model, _model_load_error
    status = {"model_loaded": _model is not None, "error": None}
    if _model_load_error:
        status["error"] = str(_model_load_error)
    else:
        # attempt to ensure model loaded but do not raise here
        try:
            if _model is None:
                load_model()
            status["model_loaded"] = _model is not None
        except Exception as e:
            status["error"] = str(e)
            status["model_loaded"] = False
    return status

if __name__ == "__main__":
    logger.info("Running ai_service self-test (this will attempt to load model).")
    try:
        load_model()
        logger.info("Model loaded ok.")
    except Exception as e:
        logger.error("Model load failed in self-test: %s", e)
