"""Builds the web assets of Blank Writ from the Godot project next to this folder (../blank-writ).

    python tools/build_assets.py [--only art,audio,data] [--force]

  art    ../blank-writ/art/**            -> assets/art/**.webp   (backgrounds 1600x900, cards / portraits as they are,
                                                                   sprites <= 640 px tall, icons <= 160 px, UI pieces as they are)
  audio  ../blank-writ/assets/audio/**   -> assets/audio/**.mp3 + audio.json   (mono, 64 kbps music / 80 kbps effects)
  data   ../blank-writ/data/**.json      -> data/**  (+ data/i18n/zh_*.json, data/manifest.json listing every file: a static
                                                      host cannot glob)
  Writes assets/art/manifest.json (every picture that exists) so the page never asks for a missing file.

Needs Pillow and ffmpeg on PATH (or at the winget location below).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent.parent
SRC = HERE.parent / "blank-writ"
FFMPEG_WINGET = Path(r"C:\Users\kevin\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe")

for _s in (sys.stdout, sys.stderr):
	if hasattr(_s, "reconfigure"):
		_s.reconfigure(encoding="utf-8", errors="replace")


def ffmpeg() -> str:
	return shutil.which("ffmpeg") or (str(FFMPEG_WINGET) if FFMPEG_WINGET.exists() else "ffmpeg")


def webp(src: Path, dst: Path, size: tuple[int, int] | None = None, max_h: int = 0, q: int = 82, alpha: bool = False) -> None:
	im = Image.open(src)
	im = im.convert("RGBA" if alpha else "RGB")
	if size and im.size != size:
		im = im.resize(size, Image.LANCZOS)
	elif max_h and im.height > max_h:
		w = round(im.width * max_h / im.height)
		im = im.resize((w, max_h), Image.LANCZOS)
	dst.parent.mkdir(parents=True, exist_ok=True)
	im.save(dst, "WEBP", quality=q, method=6)


def build_art(force: bool) -> dict:
	out = HERE / "assets" / "art"
	made = []
	plan = [
		("bg", "*.jpg", {"size": (1600, 900), "q": 80}),
		("cards", "*.jpg", {"q": 82}),
		("portraits", "*.jpg", {"q": 82}),
		("endings", "*.jpg", {"size": (1600, 900), "q": 80}),
		("sprites", "*.png", {"max_h": 640, "q": 86, "alpha": True}),
		("icons", "*.png", {"max_h": 160, "q": 88, "alpha": True}),
		("ui", "*.png", {"q": 90, "alpha": True}),
	]
	for folder, pat, kw in plan:
		for f in sorted((SRC / "art" / folder).glob(pat)):
			dst = out / folder / (f.stem + ".webp")
			if force or not dst.exists() or dst.stat().st_mtime < f.stat().st_mtime:
				webp(f, dst, **kw)
			made.append(f"{folder}/{dst.name}")
	t = SRC / "art" / "title.jpg"
	if t.exists():
		dst = out / "title.webp"
		if force or not dst.exists():
			webp(t, dst, size=(1600, 900), q=82)
		made.append("title.webp")
	fr = SRC / "art" / "ui" / "frames.json"
	if fr.exists():
		(out / "ui").mkdir(parents=True, exist_ok=True)
		shutil.copy(fr, out / "ui" / "frames.json")
	(out / "manifest.json").write_text(json.dumps({"files": made}, indent=1), encoding="utf-8", newline="\n")
	return {"art files": len(made)}


def mp3(src: Path, dst: Path, kbps: int) -> None:
	dst.parent.mkdir(parents=True, exist_ok=True)
	cmd = [ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-ac", "1", "-codec:a", "libmp3lame", "-b:a", f"{kbps}k", str(dst)]
	r = subprocess.run(cmd, capture_output=True, text=True)
	if r.returncode != 0:
		print("ffmpeg failed:", src.name, r.stderr[:200])


def build_audio(force: bool) -> dict:
	src = SRC / "assets" / "audio"
	out = HERE / "assets" / "audio"
	man = json.loads((src / "audio.json").read_text(encoding="utf-8"))
	n = 0
	for id_, spec in man.get("sfx", {}).items():
		files = []
		for f in spec.get("files", []):
			s = src / f
			d = out / Path(f).with_suffix(".mp3")
			if force or not d.exists():
				mp3(s, d, 80)
			files.append(str(Path(f).with_suffix(".mp3")).replace("\\", "/"))
			n += 1
		spec["files"] = files
	for id_, spec in man.get("music", {}).items():
		f = spec.get("file", "")
		if not f:
			continue
		s = src / f
		d = out / Path(f).with_suffix(".mp3")
		if force or not d.exists():
			mp3(s, d, 64)
		spec["file"] = str(Path(f).with_suffix(".mp3")).replace("\\", "/")
		n += 1
	(out / "audio.json").write_text(json.dumps(man, indent=1), encoding="utf-8", newline="\n")
	return {"audio files": n}


def build_data() -> dict:
	src = SRC / "data"
	out = HERE / "data"
	files, events, i18n = [], [], []
	for f in sorted(src.glob("*.json")):
		shutil.copy(f, out / f.name)
		files.append(f.name)
	(out / "events").mkdir(parents=True, exist_ok=True)
	for f in sorted((src / "events").glob("*.json")):
		shutil.copy(f, out / "events" / f.name)
		events.append(f.name)
	(out / "i18n").mkdir(parents=True, exist_ok=True)
	for f in sorted((src / "i18n").glob("zh*.json")):
		shutil.copy(f, out / "i18n" / f.name)
	# the web build's own tables (zh_web*.json, written here, not in the Godot project) are listed too
	i18n = sorted(f.name for f in (out / "i18n").glob("zh*.json"))
	# the Traditional tables are made by tools/build_hant.py (run it after this); keep them listed
	hant_dir = out / "i18n" / "hant"
	hant = sorted(f.name for f in hant_dir.glob("zh*.json")) if hant_dir.exists() else []
	(out / "manifest.json").write_text(json.dumps({"files": files, "events": events, "i18n": i18n, "i18n_hant": hant}, indent=1), encoding="utf-8", newline="\n")
	return {"data files": len(files), "events": len(events), "i18n": len(i18n)}


def main() -> int:
	ap = argparse.ArgumentParser()
	ap.add_argument("--only", default="art,audio,data")
	ap.add_argument("--force", action="store_true")
	a = ap.parse_args()
	want = {s.strip() for s in a.only.split(",")}
	res = {}
	if "data" in want:
		res.update(build_data())
	if "art" in want:
		res.update(build_art(a.force))
	if "audio" in want:
		res.update(build_audio(a.force))
	print(res)
	return 0


sys.exit(main())
