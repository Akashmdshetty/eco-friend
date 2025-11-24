# check_methods.py
"""
Small filename/extension validation helpers used by app.py.

Usage:
    allowed = {"jpg", "png", "jpeg", "webp"}
    allowed_file("photo.JPG", allowed)   -> True
    allowed_file("document.pdf", allowed) -> False
"""

from pathlib import Path
from typing import Iterable, Set


def _normalize_allowed(allowed: Iterable[str]) -> Set[str]:
    """
    Normalize allowed extensions into a set of lowercase extensions
    WITHOUT a leading dot, e.g. "jpg", "png".
    Accepts inputs with or without a leading dot.
    """
    out = set()
    for e in allowed:
        if not e:
            continue
        s = str(e).strip().lower()
        if s.startswith("."):
            s = s[1:]
        out.add(s)
    return out


def allowed_file(filename: str | None, allowed: Iterable[str]) -> bool:
    """
    Return True if `filename` has an allowed extension.

    - filename: the name to check (may be None or empty)
    - allowed: iterable of allowed extensions (e.g. {"jpg","png"} or {".jpg",".png"})

    The check is case-insensitive and robust to leading dots in allowed list.
    """
    if not filename or not isinstance(filename, str):
        return False

    allowed_set = _normalize_allowed(allowed)
    # Use pathlib to robustly extract suffix (handles names like '.env' -> '.env')
    suffix = Path(filename).suffix.lower()
    if not suffix:
        return False
    # remove leading dot from suffix
    ext = suffix[1:]
    return ext in allowed_set


# Quick smoke test when run directly
if __name__ == "__main__":
    tests = [
        ("photo.JPG", {"jpg", "png"}),
        ("archive.tar.gz", {"gz", "zip"}),
        ("noext", {"jpg"}),
        (None, {"jpg"}),
        (".env", {"env"}),
        ("picture.webp", {".webp"}),
    ]
    for fname, allow in tests:
        print(f"{fname!r} allowed {allow} -> {allowed_file(fname, allow)}")
