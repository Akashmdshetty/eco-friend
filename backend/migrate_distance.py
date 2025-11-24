import sqlite3
import os
import sys

DB_PATH = os.path.join(os.getcwd(), "ecowise.db")

print("🔍 Looking for database at:", DB_PATH)

# --- Validate existence ---
if not os.path.isfile(DB_PATH):
    print("❌ ERROR: ecowise.db not found in this directory.")
    print("Make sure this script is inside the BACKEND folder where the DB exists.")
    sys.exit(1)

try:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    print("✔ Connected to database")

    # --- Check existing columns ---
    cur.execute("PRAGMA table_info(centers);")
    cols = [row[1] for row in cur.fetchall()]

    print("📌 Existing columns in 'centers' table:", cols)

    # --- Add column if missing ---
    if "distance" in cols:
        print("✔ Column 'distance' already exists. No action required.")
    else:
        print("➕ Adding 'distance' column to 'centers' table...")
        cur.execute("ALTER TABLE centers ADD COLUMN distance TEXT DEFAULT '';")
        conn.commit()
        print("✔ Column 'distance' added successfully.")

    # --- Verify ---
    cur.execute("PRAGMA table_info(centers);")
    new_cols = [row[1] for row in cur.fetchall()]
    print("🔁 Columns after migration:", new_cols)

    print("\n🎉 Migration completed successfully!")

except Exception as e:
    print("❌ ERROR during migration:", e)

finally:
    try:
        cur.close()
        conn.close()
        print("🔌 Connection closed.")
    except:
        pass
