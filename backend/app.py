# app.py
"""
EcoWise backend (Flask) - improved version
- Safe file uploads (allowed extensions)
- Better static file serving (SPA-friendly)
- Robust error handling around AI service
- Reads PORT from env (default 5000)
- Small security + logging improvements
"""

import os
import uuid
import logging
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS
from werkzeug.utils import secure_filename

# local modules (ensure these exist: database.py and ai_service.py)
from database import Database
from ai_service import analyze_image_file

# -----------------------
# Config
# -----------------------
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOAD_FOLDER = Path(os.environ.get("UPLOAD_FOLDER", BASE_DIR / "uploads"))
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# port from env (default 5000)
PORT = int(os.environ.get("PORT", 5000))
HOST = os.environ.get("HOST", "0.0.0.0")

# -----------------------
# App init
# -----------------------
app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="/static")
CORS(app)
logging.basicConfig(level=logging.INFO)

# -----------------------
# Database init
# -----------------------
DB_PATH = BASE_DIR / "ecowise.db"
db = Database(str(DB_PATH))
# Attempt to initialize (Database should provide init method)
try:
    db.init_db_if_needed()
except AttributeError:
    app.logger.info("Database object does not implement init_db_if_needed(); skipping init step.")
except Exception as ex:
    app.logger.exception("Database initialization error: %s", ex)

# -----------------------
# Helpers
# -----------------------
def allowed_file(filename: str) -> bool:
    if not filename or "." not in filename:
        return False
    ext = Path(filename).suffix.lower()
    return ext in ALLOWED_EXTENSIONS

# -----------------------
# Basic routes / health
# -----------------------
@app.route("/", methods=["GET"])
def index():
    # If a static index.html exists in frontend, serve it (SPA mode)
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return send_from_directory(str(FRONTEND_DIR), "index.html")
    return jsonify({
        "status": "EcoWise backend running",
        "routes": [
            "/recycling-centers",
            "/user/<username>",
            "/user/<username>/history",
            "/detect (POST)",
            "/get-directions/<id>"
        ]
    })

@app.route("/static/<path:filename>")
def serve_static(filename):
    # Serve static assets explicitly
    file_path = FRONTEND_DIR / filename
    if file_path.exists():
        return send_from_directory(str(FRONTEND_DIR), filename)
    abort(404)

# -----------------------
# Data endpoints
# -----------------------
@app.route("/recycling-centers", methods=["GET"])
def recycling_centers():
    try:
        centers = db.get_centers()
        # Ensure we return an object (not a bare list) for consistency
        return jsonify({"centers": centers})
    except Exception as e:
        app.logger.exception("Failed to fetch centers")
        return jsonify({"error": "DB error"}), 500

@app.route("/user/<username>", methods=["GET"])
def get_user(username):
    try:
        user = db.get_user(username)
        if not user:
            return jsonify({"error": "User not found"}), 404
        return jsonify(user)
    except Exception as e:
        app.logger.exception("Failed to fetch user")
        return jsonify({"error": "DB error"}), 500

@app.route("/user/<username>/history", methods=["GET"])
def user_history(username):
    try:
        history = db.get_history(username)
        return jsonify({"history": history})
    except Exception as e:
        app.logger.exception("Failed to fetch history")
        return jsonify({"error": "DB error"}), 500

@app.route("/leaderboard", methods=["GET"])
def leaderboard():
    try:
        lb = db.get_leaderboard(limit=20)
        return jsonify({"leaderboard": lb})
    except Exception as e:
        app.logger.exception("Failed to fetch leaderboard")
        return jsonify({"error": "DB error"}), 500

@app.route("/get-directions/<int:center_id>", methods=["GET"])
def get_directions(center_id):
    try:
        center = db.get_center_by_id(center_id)
        if not center:
            return jsonify({"error": "Center not found"}), 404
        directions = {
            "id": center["id"],
            "name": center["name"],
            "directions": f"Head to {center.get('address', 'the listed address')}.",
            "transport": center.get("transport", []),
            "landmarks": center.get("landmarks", []),
            "phone": center.get("phone", "")
        }
        return jsonify(directions)
    except Exception as e:
        app.logger.exception("Failed to get directions")
        return jsonify({"error": "DB error"}), 500

# -----------------------
# Detection endpoint
# -----------------------
@app.route("/detect", methods=["POST"])
def detect():
    # Validate presence of file
    if "image" not in request.files:
        return jsonify({"success": False, "error": "No image file provided"}), 400

    file = request.files["image"]
    username = request.form.get("username", "guest")

    if file.filename == "":
        return jsonify({"success": False, "error": "Empty filename"}), 400

    if not allowed_file(file.filename):
        return jsonify({"success": False, "error": "Unsupported file type"}), 400

    # Save securely
    filename = secure_filename(file.filename)
    unique_name = f"{uuid.uuid4().hex}_{filename}"
    save_path = UPLOAD_FOLDER / unique_name
    try:
        file.save(str(save_path))
    except Exception as e:
        app.logger.exception("Failed to save uploaded file")
        return jsonify({"success": False, "error": "File save error"}), 500

    # Call AI service (wrap in try/except)
    try:
        result = analyze_image_file(str(save_path))
        if not isinstance(result, dict):
            raise ValueError("AI service returned unexpected type")
    except Exception as e:
        app.logger.exception("AI analyze failed")
        # respond with a friendly error and keep user flow working
        return jsonify({"success": False, "error": "AI analysis failed", "details": str(e)}), 500

    # Normalize result keys
    points = result.get("eco_points", 0)
    carbon = result.get("carbon_saved_kg", 0)
    items = result.get("objects_detected", 0)

    # Persist history & update stats (guarded)
    try:
        db.add_history(
            username=username,
            filename=filename,
            points=points,
            carbon_saved_kg=carbon,
            objects_detected=items,
            stored_path=str(save_path)
        )
    except Exception:
        app.logger.exception("Failed to write history to DB (continuing)")

    try:
        db.increment_user_stats(username, points, items, carbon)
    except Exception:
        app.logger.exception("Failed to update user stats (continuing)")

    # Return result
    response = dict(result)  # copy so we can modify
    response["filename"] = filename
    response["success"] = True
    return jsonify(response)

# -----------------------
# Catch-all for SPA: serve index.html for unknown routes (frontend routing)
# -----------------------
@app.errorhandler(404)
def handle_404(err):
    # If frontend index exists, serve it (allows client-side routing)
    index_file = FRONTEND_DIR / "index.html"
    req_path = request.path.lstrip("/")
    # Do not intercept API endpoints or static assets
    if req_path.startswith("api") or req_path.startswith("detect") or req_path.startswith("recycling-centers"):
        return jsonify({"error": "Not found"}), 404
    if index_file.exists():
        return send_from_directory(str(FRONTEND_DIR), "index.html")
    return jsonify({"error": "Not found"}), 404

# -----------------------
# Start app
# -----------------------
if __name__ == "__main__":
    app.logger.info("Starting EcoWise backend on %s:%d", HOST, PORT)
    # debug True for local dev only
    app.run(host=HOST, port=PORT, debug=True)
