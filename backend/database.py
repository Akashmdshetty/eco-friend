# database.py
"""
Simple SQLite wrapper for EcoWise.

Provides:
- init_db_if_needed()
- get_user(username)
- increment_user_stats(username, points, items, carbon)
- add_history(...)
- get_history(username)
- get_centers(), get_center_by_id()
- get_leaderboard(limit)
- get_stats()  # aggregate counts (optional)
"""

import sqlite3
import os
import json
from datetime import datetime
from typing import Optional, List, Dict, Any

EXAMPLE_CENTERS = [
    {
        "id": 1,
        "name": "Hassan City Municipal Waste Center",
        "type": "recycling",
        "address": "Near Bus Stand, MG Road, Hassan",
        "lat": 13.0069,
        "lng": 76.0991,
        "hours": "8:00 AM - 6:00 PM",
        "rating": 4.2,
        "services": ["Plastic", "Paper", "Glass", "Metal"],
        "distance": "0.5 km",
        "phone": ""
    },
    {
        "id": 2,
        "name": "Community Donation Center",
        "type": "donation",
        "address": "Station Road, Hassan",
        "lat": 13.008,
        "lng": 76.1005,
        "hours": "9:00 AM - 5:00 PM",
        "rating": 4.0,
        "services": ["Books", "Clothes"],
        "distance": "1.1 km",
        "phone": ""
    }
]


class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_dir()

    def _ensure_dir(self):
        # make sure directory exists (handles when db_path is in current dir)
        directory = os.path.dirname(self.db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

    def _connect(self):
        # For simple single-process usage this is fine.
        # If you plan to use threads or async, consider check_same_thread=False and a connection pool.
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db_if_needed(self):
        """Create tables if they don't exist and seed centers if empty."""
        with self._connect() as conn:
            cur = conn.cursor()
            # users table: created_at column consistent with other code
            cur.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    level TEXT DEFAULT 'Eco Friend',
                    eco_points INTEGER DEFAULT 0,
                    items_recycled INTEGER DEFAULT 0,
                    carbon_saved_kg REAL DEFAULT 0.0,
                    created_at TEXT
                )
            ''')
            # history table
            cur.execute('''
                CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT,
                    filename TEXT,
                    processed_at TEXT,
                    points_earned INTEGER,
                    carbon_saved_kg REAL,
                    objects_detected INTEGER,
                    stored_path TEXT
                )
            ''')
            # centers table
            cur.execute('''
                CREATE TABLE IF NOT EXISTS centers (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    type TEXT,
                    address TEXT,
                    lat REAL,
                    lng REAL,
                    hours TEXT,
                    rating REAL,
                    services TEXT,
                    distance TEXT,
                    phone TEXT,
                    website TEXT
                )
            ''')
            conn.commit()

            # seed centers if table is empty
            cur.execute('SELECT COUNT(*) AS c FROM centers')
            row = cur.fetchone()
            count = row['c'] if row is not None else 0
            if count == 0:
                for c in EXAMPLE_CENTERS:
                    cur.execute('''
                        INSERT INTO centers (id, name, type, address, lat, lng, hours, rating, services, distance, phone, website)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        c.get('id'),
                        c.get('name'),
                        c.get('type'),
                        c.get('address'),
                        c.get('lat'),
                        c.get('lng'),
                        c.get('hours', ''),
                        c.get('rating', 0),
                        ','.join(c.get('services', [])),
                        c.get('distance', ''),
                        c.get('phone', ''),
                        c.get('website', '')
                    ))
                conn.commit()

    # -----------------------
    # Users
    # -----------------------
    def get_user(self, username: str) -> Dict[str, Any]:
        """Retrieve user row. If missing, create with defaults and return."""
        with self._connect() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM users WHERE username = ?', (username,))
            row = cur.fetchone()
            if not row:
                now = datetime.utcnow().isoformat()
                cur.execute('''
                    INSERT INTO users (username, level, eco_points, items_recycled, carbon_saved_kg, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (username, 'Eco Friend', 0, 0, 0.0, now))
                conn.commit()
                cur.execute('SELECT * FROM users WHERE username = ?', (username,))
                row = cur.fetchone()
            return dict(row) if row else {}

    def increment_user_stats(self, username: str, points: int = 0, items: int = 0, carbon: float = 0.0):
        """
        Add points/items/carbon to a user and recalc level.
        Creates the user if missing.
        """
        # Ensure numeric types
        try:
            points = int(points)
        except Exception:
            points = 0
        try:
            items = int(items)
        except Exception:
            items = 0
        try:
            carbon = float(carbon)
        except Exception:
            carbon = 0.0

        with self._connect() as conn:
            cur = conn.cursor()
            # ensure user exists
            self.get_user(username)
            cur.execute('''
                UPDATE users
                SET eco_points = eco_points + ?,
                    items_recycled = items_recycled + ?,
                    carbon_saved_kg = carbon_saved_kg + ?
                WHERE username = ?
            ''', (points, items, carbon, username))
            conn.commit()

            # update level based on points
            cur.execute('SELECT eco_points FROM users WHERE username = ?', (username,))
            r = cur.fetchone()
            pts = r['eco_points'] if r else 0
            level = 'Eco Friend'
            if pts >= 1000:
                level = 'Eco Champion'
            elif pts >= 200:
                level = 'Eco Warrior'
            cur.execute('UPDATE users SET level = ? WHERE username = ?', (level, username))
            conn.commit()

    # -----------------------
    # History
    # -----------------------
    def add_history(self, username: str, filename: str, points: int, carbon_saved_kg: float, objects_detected: int, stored_path: str):
        """Insert a history row for an analyzed image."""
        with self._connect() as conn:
            cur = conn.cursor()
            cur.execute('''
                INSERT INTO history (username, filename, processed_at, points_earned, carbon_saved_kg, objects_detected, stored_path)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (username, filename, datetime.utcnow().isoformat(), points, carbon_saved_kg, objects_detected, stored_path))
            conn.commit()

    def get_history(self, username: str, limit: int = 50) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            cur = conn.cursor()
            cur.execute('''
                SELECT filename, processed_at, points_earned, carbon_saved_kg, objects_detected
                FROM history
                WHERE username = ?
                ORDER BY processed_at DESC
                LIMIT ?
            ''', (username, limit))
            return [dict(r) for r in cur.fetchall()]

    # -----------------------
    # Centers
    # -----------------------
    def get_centers(self) -> List[Dict[str, Any]]:
        """Return all recycling centers as list of dicts. Services are returned as list."""
        with self._connect() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM centers ORDER BY id')
            rows = []
            for r in cur.fetchall():
                row = dict(r)
                services = row.get('services') or ''
                row['services'] = [s for s in services.split(',') if s]
                rows.append(row)
            return rows

    def get_center_by_id(self, center_id: int) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM centers WHERE id = ?', (center_id,))
            r = cur.fetchone()
            if not r:
                return None
            row = dict(r)
            services = row.get('services') or ''
            row['services'] = [s for s in services.split(',') if s]
            return row

    # -----------------------
    # Leaderboard / Stats
    # -----------------------
    def get_leaderboard(self, limit: int = 20) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            cur = conn.cursor()
            cur.execute('SELECT username, eco_points, level FROM users ORDER BY eco_points DESC LIMIT ?', (limit,))
            return [dict(r) for r in cur.fetchall()]

    def get_stats(self) -> Dict[str, Any]:
        """Return some aggregated stats: user count, total points, centers count."""
        with self._connect() as conn:
            cur = conn.cursor()
            cur.execute('SELECT COUNT(*) AS users FROM users')
            users = cur.fetchone()['users'] or 0
            cur.execute('SELECT COALESCE(SUM(eco_points),0) AS total_points FROM users')
            total_points = cur.fetchone()['total_points'] or 0
            cur.execute('SELECT COUNT(*) AS centers FROM centers')
            centers = cur.fetchone()['centers'] or 0
            return {"users": users, "total_points": total_points, "centers": centers}
