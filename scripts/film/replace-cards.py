"""Replace the three branded cards in the original 22-second Rounds film.

python3 scripts/film/replace-cards.py desktop original.mp4 paper.mp4 cards/ output.mp4
The original footage and audio are read-only inputs. Render cards with ad-cards.mjs first.
"""
import json
from pathlib import Path
import subprocess
import sys

view, original, paper, cards, output = sys.argv[1:]
width, height = (1920, 1080) if view == "desktop" else (1080, 1350)
info = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_frames,r_frame_rate", "-of", "json", original,
]))["streams"][0]
assert (info["width"], info["height"], info["nb_frames"], info["r_frame_rate"]) == (width, height, "1320", "60/1"), "Expected the original 22-second film at 60 fps"
work = Path(cards) / f"edit-{view}"
work.mkdir(exist_ok=True)


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *map(str, args)], check=True)


for name, frames, paper_at in [("w3", 60, 1.04), ("w6", 30, 2.15), ("end", 360, 3.26)]:
    print(f"{view}: composing {name}", flush=True)
    ffmpeg(
        "-ss", paper_at, "-i", paper, "-framerate", "60",
        "-i", Path(cards) / f"{view}-{name}" / "%04d.png",
        "-frames:v", frames, "-filter_complex",
        f"[1:v]scale={width}:{height}:flags=lanczos,format=rgba[text];[0:v][text]overlay=0:0:eof_action=repeat",
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "12",
        "-pix_fmt", "yuv420p", "-r", "60", work / f"{name}.mp4",
    )

# Leave the actual demo shots in place. Only 1-2s, 10-10.5s, and 16-22s change.
print(f"{view}: assembling film", flush=True)
ffmpeg(
    "-i", original, "-i", work / "w3.mp4", "-i", work / "w6.mp4", "-i", work / "end.mp4",
    "-filter_complex",
    "[0:v]split=3[a][b][c];"
    "[a]trim=start_frame=0:end_frame=60,setpts=PTS-STARTPTS[a0];"
    "[b]trim=start_frame=120:end_frame=600,setpts=PTS-STARTPTS[b0];"
    "[c]trim=start_frame=630:end_frame=960,setpts=PTS-STARTPTS[c0];"
    "[1:v]setpts=PTS-STARTPTS[t1];[2:v]setpts=PTS-STARTPTS[t2];[3:v]setpts=PTS-STARTPTS[t3];"
    "[a0][t1][b0][t2][c0][t3]concat=n=6:v=1:a=0[video]",
    "-map", "[video]", "-map", "0:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", "60", "-c:a", "copy", "-movflags", "+faststart", output,
)
print(f"{view}: saved {output}", flush=True)
