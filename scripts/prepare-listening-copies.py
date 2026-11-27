#!/usr/bin/env python3
"""Make verified MP3 listening copies for WAV-only entries; never edit originals.

Requires ffmpeg/ffprobe with libmp3lame and Python with numpy. The saved catalog,
upload plan and canonical archive are read-only inputs. Only this script's
ignored private-data/listening-copies* outputs are written. Interrupted work is
resumable; a saved copy is reused only after both file hashes still match.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

import numpy as np


PROJECT = Path(__file__).resolve().parent.parent
POLICY = "mp3-listening-copy-128k-gapless-v1"
BIT_RATE = 128000
EXPECTED_WAV_ONLY_ENTRIES = 128
SUPPORTED_RATES = {8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000}


def now():
    return datetime.now(timezone.utc).isoformat()


def file_hash(path):
    before = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(4 * 1024 * 1024):
            digest.update(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f"File changed while hashing: {path.name}")
    return digest.hexdigest(), after.st_size


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def probe(path):
    data = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)
    ]))
    audio = [s for s in data["streams"] if s["codec_type"] == "audio"]
    if len(audio) != 1:
        raise ValueError(f"Expected one audio stream: {path.name}")
    stream = audio[0]
    return {
        "sampleRate": int(stream["sample_rate"]),
        "channels": int(stream["channels"]),
        "codec": stream["codec_name"],
        "duration": float(stream.get("duration", data["format"]["duration"])),
        "containerDuration": float(data["format"]["duration"]),
        "startTime": float(stream.get("start_time", 0)),
        "bitRate": int(stream.get("bit_rate", 0)),
        "durationTs": stream.get("duration_ts"),
        "timeBase": stream.get("time_base"),
    }


def sample_count(metadata):
    numerator, denominator = map(int, metadata["timeBase"].split("/"))
    count = metadata["durationTs"] * numerator * metadata["sampleRate"] / denominator
    if not math.isfinite(count) or abs(count - round(count)) > 0.0001:
        raise ValueError("Source duration does not resolve to an integer sample count")
    return round(count)


def sample_windows(frames, rate):
    width = min(frames, 8 * rate)
    # Three non-overlapping candidates per region let quiet lead-ins and tails
    # be represented honestly without mistaking silence for alignment evidence.
    starts = {
        "beginning": [0, width, 2 * width],
        "middle": [frames // 2 - 3 * width // 2, frames // 2 - width // 2, frames // 2 + width // 2],
        "end": [frames - 3 * width, frames - 2 * width, frames - width],
    }
    return [
        {"region": region, "start": max(0, min(frames - width, start)), "frames": width}
        for region, offsets in starts.items() for start in offsets
    ]


def decode_samples(path, channels, windows):
    """Count every decoded frame while keeping only small verification windows.

    Decoding MP3 from the beginning lets FFmpeg apply the Xing/LAME skip/discard
    metadata. Seeking into a raw MP3 would confound encoder delay with alignment.
    """
    captures = [bytearray() for _ in windows]
    frame_bytes = channels * 4
    position = 0
    carry = b""
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([
            "ffmpeg", "-v", "error", "-nostdin", "-threads", "1", "-i", str(path),
            "-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", "pcm_f32le", "-threads", "1",
            "-f", "f32le", "pipe:1",
        ], stdout=subprocess.PIPE, stderr=errors)
        try:
            while block := process.stdout.read(1024 * 1024):
                block = carry + block
                aligned = len(block) // frame_bytes * frame_bytes
                carry = block[aligned:]
                block = block[:aligned]
                end = position + len(block) // frame_bytes
                for window, capture in zip(windows, captures):
                    left = max(position, window["start"])
                    right = min(end, window["start"] + window["frames"])
                    if right > left:
                        capture.extend(block[(left - position) * frame_bytes:(right - position) * frame_bytes])
                position = end
            status = process.wait()
            errors.seek(0)
            error_text = errors.read().decode("utf-8", errors="replace").strip()
            if status or carry or error_text:
                raise ValueError(f"Decode failed for {path.name}: {error_text[:800]}")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
    arrays = [np.frombuffer(capture, dtype="<f4").reshape(-1, channels).astype(np.float64) for capture in captures]
    return position, arrays


def alignment_checks(source, output, windows, rate):
    checks = []
    for region in ("beginning", "middle", "end"):
        indices = [i for i, window in enumerate(windows) if window["region"] == region]
        selected = max(indices, key=lambda i: float(np.mean(source[i] ** 2)))
        a, b = source[selected], output[selected]
        if a.shape != b.shape or a.shape[0] != windows[selected]["frames"]:
            raise ValueError(f"Incomplete {region} verification window")
        channel_checks = []
        for channel in range(a.shape[1]):
            left = a[:, channel] - a[:, channel].mean()
            right = b[:, channel] - b[:, channel].mean()
            rms = float(np.sqrt(np.mean(left ** 2)))
            right_rms = float(np.sqrt(np.mean(right ** 2)))
            if rms < 1e-7:
                if right_rms > 1e-5:
                    raise ValueError(f"Unexpected signal in silent {region} window")
                channel_checks.append({"channel": channel + 1, "status": "silent-window", "sourceRms": rms})
                continue
            correlation = float(np.dot(left, right) / (np.linalg.norm(left) * np.linalg.norm(right)))
            fft_size = 1 << (2 * len(left) - 1).bit_length()
            correlation_series = np.fft.irfft(np.fft.rfft(left, fft_size) * np.conj(np.fft.rfft(right, fft_size)), fft_size)
            search = min(round(rate * 0.1), len(left) - 1)
            lags = np.arange(-search, search + 1)
            best_lag = int(lags[np.argmax(correlation_series[lags % fft_size])])
            # 128-kbit/s lossy coding changes samples; correlation and lag check
            # timeline identity, not bit identity or transcript correctness.
            if not math.isfinite(correlation) or correlation < 0.90 or abs(best_lag) > 1:
                raise ValueError(f"Alignment check failed in {region}: correlation={correlation}, lag={best_lag}")
            channel_checks.append({
                "channel": channel + 1, "status": "aligned", "zeroLagCorrelation": correlation,
                "bestLagSamples": best_lag, "bestLagSeconds": best_lag / rate, "sourceRms": rms,
            })
        checks.append({
            "region": region, "startSeconds": windows[selected]["start"] / rate,
            "durationSeconds": windows[selected]["frames"] / rate, "channels": channel_checks,
        })
    return checks


def prepare(entry, asset, output_dir, existing, ffmpeg_version):
    source = Path(asset["localPath"])
    expected_hash, expected_bytes = asset["sha256"], asset["bytes"]
    digest, size = file_hash(source)
    if digest != expected_hash or size != expected_bytes:
        raise ValueError(f"Original WAV failed its archived integrity baseline: {entry['id']}")
    file_name = re.sub(r"[^A-Za-z0-9._-]", "-", source.stem) + ".listening-copy.mp3"
    folder = output_dir / entry["id"]
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / file_name
    if (existing and existing.get("sourceAudioId") == asset["id"]
            and existing.get("sourcePath") == str(source)
            and existing.get("sourceSha256") == expected_hash
            and existing.get("localPath") == str(destination)
            and existing.get("verification", {}).get("policy") == POLICY
            and existing.get("verification", {}).get("passed") is True
            and destination.is_file()):
        output_hash, output_bytes = file_hash(destination)
        if output_hash == existing.get("sha256") and output_bytes == existing.get("bytes"):
            return existing

    metadata = probe(source)
    rate, channels = metadata["sampleRate"], metadata["channels"]
    if rate not in SUPPORTED_RATES or channels not in (1, 2):
        raise ValueError(f"Unsupported rate/channel layout; will not silently change original: {entry['id']}")
    if abs(metadata["startTime"]) > 1 / rate:
        raise ValueError(f"Nonzero original start time requires review: {entry['id']}")
    frames = sample_count(metadata)
    partial = folder / (file_name + ".partial")
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "1",
        "-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", str(rate), "-ac", str(channels),
        "-threads", "1", "-write_xing", "1", "-id3v2_version", "3",
        "-metadata", "title=" + source.stem + " (MP3 listening copy)",
        "-metadata", "comment=MP3 listening copy derived from the preserved original WAV; 128 kbps; no trimming or signal processing.",
        "-f", "mp3", str(partial),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    partial.chmod(0o600)
    output_metadata = probe(partial)
    if (output_metadata["codec"] != "mp3" or output_metadata["sampleRate"] != rate
            or output_metadata["channels"] != channels or output_metadata["bitRate"] != BIT_RATE):
        raise ValueError(f"MP3 encoding parameters differ from policy: {entry['id']}")
    windows = sample_windows(frames, rate)
    source_frames, source_windows = decode_samples(source, channels, windows)
    output_frames, output_windows = decode_samples(partial, channels, windows)
    if not (frames == source_frames == output_frames):
        raise ValueError(f"Decoded sample count changed for {entry['id']}: source={source_frames}, output={output_frames}, expected={frames}")
    checks = alignment_checks(source_windows, output_windows, windows, rate)
    if file_hash(source) != (expected_hash, expected_bytes):
        raise ValueError(f"Original changed during conversion: {entry['id']}")
    output_hash, output_bytes = file_hash(partial)
    partial.replace(destination)
    return {
        "entryId": entry["id"], "sourceAudioId": asset["id"], "sourcePath": str(source),
        "sourceSha256": expected_hash, "sourceBytes": expected_bytes,
        "localPath": str(destination), "name": file_name, "sha256": output_hash,
        "bytes": output_bytes, "duration": frames / rate, "originalDuration": metadata["duration"],
        "format": "mp3", "encoding": {
            "codec": "libmp3lame", "bitRate": BIT_RATE, "rateControl": "constant bitrate",
            "sampleRate": rate, "channels": channels, "sampleRateAndChannelsPreserved": True,
            "xingGaplessMetadata": True, "signalProcessing": "none", "trimmed": False,
            "ffmpegVersion": ffmpeg_version, "originalFormat": "wav", "encodedAt": now(),
        }, "verification": {
            "policy": POLICY, "passed": True, "verifiedAt": now(),
            "sourceSha256BeforeAndAfterMatchesBaseline": True,
            "originalDecodedSamplesPerChannel": source_frames,
            "mp3DecodedSamplesPerChannel": output_frames, "decodedDurationDeltaSeconds": 0,
            "containerDuration": output_metadata["containerDuration"],
            "mp3StartTime": output_metadata["startTime"],
            "timelineChecks": checks,
        },
    }


def write_report(path, manifest):
    checks = [c for copy in manifest["copies"] for window in copy["verification"]["timelineChecks"] for c in window["channels"]]
    aligned = [c for c in checks if c["status"] == "aligned"]
    report = {
        "version": 1, "policy": POLICY, "generatedAt": now(), "state": manifest["state"],
        "expectedCopies": manifest["expectedCopies"], "verifiedCopies": len(manifest["copies"]),
        "sourceBytes": sum(c["sourceBytes"] for c in manifest["copies"]),
        "mp3Bytes": sum(c["bytes"] for c in manifest["copies"]),
        "durationSeconds": sum(c["duration"] for c in manifest["copies"]),
        "allDecodedSampleCountsExact": all(c["verification"]["originalDecodedSamplesPerChannel"] == c["verification"]["mp3DecodedSamplesPerChannel"] for c in manifest["copies"]),
        "alignedWindows": len(aligned), "silentWindows": len(checks) - len(aligned),
        "minimumZeroLagCorrelation": min((c["zeroLagCorrelation"] for c in aligned), default=None),
        "maximumAbsoluteLagSamples": max((abs(c["bestLagSamples"]) for c in aligned), default=None),
        "failures": manifest.get("failures", []), "limitations": [
            "MP3 is lossy. Original WAV files remain authoritative, unchanged and independently hashed.",
            "All output samples are counted after decoding from the beginning with Xing/LAME delay and padding compensation. MP3 container duration includes frame padding and can differ slightly from the content duration.",
            "Waveform comparisons test one high-energy eight-second window near the beginning, middle and end of each channel. They do not compare every waveform sample or verify transcript accuracy.",
            "Silent windows provide no waveform alignment evidence and are reported separately; exact full-file decoded sample counts still apply.",
            "This verifies local FFmpeg decoding. Browser seeking and gapless handling require separate playback checks.",
        ],
    }
    atomic_json(path, report)


def run(args):
    data_dir = args.data_dir.resolve()
    catalog = json.loads((data_dir / "archive.json").read_text())
    plan = json.loads((data_dir / "upload-plan.json").read_text())
    assets = {asset["id"]: asset for asset in plan["assets"]}
    # Added derivatives must not change eligibility on a later rerun. This
    # remains the original-source inventory, even after web integration.
    entries = []
    for entry in catalog["entries"]:
        originals = [audio for audio in entry["audio"] if audio.get("kind") != "listening-copy"]
        if originals and all(audio["format"].lower() == "wav" for audio in originals):
            entries.append({**entry, "audio": originals})
    if len(entries) != EXPECTED_WAV_ONLY_ENTRIES:
        raise ValueError(f"Expected {EXPECTED_WAV_ONLY_ENTRIES} original WAV-only entries; found {len(entries)}. Review catalog coverage before converting.")
    if any(len(e["audio"]) != 1 for e in entries):
        raise ValueError("Multiple WAV-only alternatives require an explicit choice; none will be silently omitted")
    selected = entries[:args.limit] if args.limit else entries
    output_dir = data_dir / "listening-copies"
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = data_dir / "listening-copies-manifest.json"
    report_path = data_dir / "listening-copies-verification.json"
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    eligible_ids = {entry["id"] for entry in entries}
    existing = {copy["entryId"]: copy for copy in old.get("copies", []) if copy["entryId"] in eligible_ids}
    version = subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]
    manifest = {
        "version": 1, "bitRate": BIT_RATE, "policy": POLICY, "state": "running", "startedAt": now(),
        "expectedCopies": len(entries), "copies": list(existing.values()), "failures": [], "complete": False,
        "originalsPreserved": True, "existingMp3FilesReencoded": False,
    }
    started = time.monotonic()
    verified_this_run = 0
    atomic_json(manifest_path, manifest)
    # Two workers bound encoder load and PCM-window memory while an independent
    # upload is in progress. There are no full-file PCM buffers or temporary WAVs.
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        pending = {executor.submit(prepare, entry, assets[entry["audio"][0]["id"]], output_dir, existing.get(entry["id"]), version): entry for entry in selected}
        for future in as_completed(pending):
            entry = pending[future]
            try:
                result = future.result()
                manifest["copies"] = [copy for copy in manifest["copies"] if copy["entryId"] != entry["id"]]
                manifest["copies"].append(result)
                manifest["copies"].sort(key=lambda copy: copy["entryId"])
                verified_this_run += 1
            except Exception as error:
                manifest["copies"] = [copy for copy in manifest["copies"] if copy["entryId"] != entry["id"]]
                manifest["failures"].append({"entryId": entry["id"], "error": str(error)})
                print(f"FAILED {entry['id']}: {error}", flush=True)
            atomic_json(manifest_path, manifest)
            if verified_this_run % 16 == 0 and verified_this_run:
                print(f"Verified {verified_this_run}/{len(entries)} MP3 listening copies", flush=True)
    manifest["complete"] = not manifest["failures"] and verified_this_run == len(entries)
    manifest["state"] = "failed" if manifest["failures"] else "complete" if manifest["complete"] else "partial"
    manifest["finishedAt"] = now()
    manifest["elapsedSeconds"] = round(time.monotonic() - started, 3)
    atomic_json(manifest_path, manifest)
    write_report(report_path, manifest)
    print(json.dumps({"state": manifest["state"], "verifiedCopies": len(manifest["copies"]), "expectedCopies": len(entries), "failures": len(manifest["failures"]), "elapsedSeconds": manifest["elapsedSeconds"]}), flush=True)
    if manifest["failures"]:
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=PROJECT / "private-data")
    parser.add_argument("--workers", type=int, choices=(1, 2), default=2)
    parser.add_argument("--limit", type=int, help="Process only the first N WAV-only entries for a smoke check")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    # A live OS lock, rather than a stale PID receipt, protects fixed temporary
    # paths and the manifest against accidental overlapping invocations.
    with (args.data_dir.resolve() / ".listening-copies.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another listening-copy preparation process is already active.")
        run(args)


if __name__ == "__main__":
    main()
