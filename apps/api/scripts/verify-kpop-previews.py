"""Verify the 200 appended K-pop recordings against live Deezer audio.

Run from the repository root with Python 3 and ffmpeg. Kept separate from
ordinary CI because provider previews can change by region or over time.
"""

import ast
import concurrent.futures
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import urllib.request


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def verify(record):
    track_id, title, artist = record
    track = json.loads(get(f"https://api.deezer.com/track/{track_id}"))
    if (track.get("id"), track.get("title"), track.get("artist", {}).get("name")) != (
        track_id, title, artist
    ):
        raise ValueError(f"Metadata mismatch for {track_id}: {title} — {artist}")
    url = urllib.parse.urlparse(track.get("preview", ""))
    if url.scheme != "https" or url.hostname != "cdnt-preview.dzcdn.net":
        raise ValueError(f"No supported preview for {track_id}")
    audio = get(track["preview"])
    decoded = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-t", "15",
         "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"],
        input=audio, capture_output=True, timeout=20, check=True,
    )
    if len(decoded.stdout) != 480000:
        raise ValueError(f"Preview shorter than 15 seconds for {track_id}")
    print(f"VERIFIED {track_id}: {title} — {artist}", flush=True)


if __name__ == "__main__":
    source = Path("apps/api/src/services/song-packs.ts").read_text()
    block = source.split("kpop: [", 1)[1].split("\n\t],", 1)[0]
    records = ast.literal_eval("[" + block + "]")
    if len(records) != 300 or len({track[0] for track in records}) != 300:
        raise ValueError("Expected 300 distinct K-pop recordings")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(verify, records[100:]))
    print("Verified all 200 added recordings, each with 15 seconds of playable audio.")
