# ai_server.py
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
from ai_service import analyze_image_file

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "ai_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__)
CORS(app)

ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "bmp"}

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status":"ok", "service":"ai_server"})

@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Accepts multipart/form-data with field "image".
    Optional form field: username
    Returns JSON as produced by ai_service.analyze_image_file(path)
    """
    if "image" not in request.files:
        return jsonify({"success": False, "error": "no file part 'image'"}), 400
    f = request.files["image"]
    if f.filename == "":
        return jsonify({"success": False, "error": "empty filename"}), 400
    if not allowed_file(f.filename):
        return jsonify({"success": False, "error": "file type not allowed"}), 400

    filename = secure_filename(f.filename)
    unique = f"{os.urandom(8).hex()}_{filename}"
    save_path = os.path.join(UPLOAD_DIR, unique)
    f.save(save_path)

    result = analyze_image_file(save_path)
    # Optionally include saved path (not necessary for frontend)
    result.setdefault("saved_path", save_path)
    result.setdefault("success", result.get("success", True))
    return jsonify(result)

if __name__ == "__main__":
    # production: use a WSGI server; for dev use Flask's built-in
    app.run(host="0.0.0.0", port=5000, debug=False)
