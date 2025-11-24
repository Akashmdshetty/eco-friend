# test_ai.py - quick check for ai_service.analyze_image_file
import sys
import traceback
from pathlib import Path

# adapt import to your project layout; ai_service.py must be next to this file
try:
    from ai_service import analyze_image_file
except Exception as e:
    print("ERROR importing ai_service.analyze_image_file ->", e)
    traceback.print_exc()
    sys.exit(2)

if len(sys.argv) < 2:
    print("Usage: python test_ai.py <path-to-image>")
    sys.exit(1)

image_path = Path(sys.argv[1]).resolve()
print("Testing image:", image_path)
if not image_path.exists():
    print("File not found:", image_path)
    sys.exit(2)

try:
    result = analyze_image_file(str(image_path))
    print("RETURNED:", repr(result))
    print("TYPE:", type(result))
except Exception as ex:
    print("EXCEPTION from analyze_image_file:")
    traceback.print_exc()
    sys.exit(3)
