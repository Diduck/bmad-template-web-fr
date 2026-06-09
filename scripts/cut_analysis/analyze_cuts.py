# -*- coding: utf-8 -*-
"""
Analyse de coupes automatiques (Auto-Cut) — version Python.

Remplace le parsing ExtendScript (catastrophiquement lent : ~2,5 min pour une
sequence de 72 min) par un traitement Python rapide (<2s pour le meme volume).

Pipeline :
  WAV -> ffmpeg astats (RMS par frame) -> parse -> seuil (auto/manuel)
       -> runs de silence -> regroupement content-aware -> marge -> CutZones

Sortie : un JSON au MEME format que l'ancien AnalyseCut JSX, consomme tel quel
par displayCutAnalysis (JS) et CutSecond (JSX) :
  {
    "Message": "Analyse réussie",
    "Value": [[start, end], ...],          # zones a couper, en secondes
    "AllValueWav": [{"time": t, "debit": rms}, ...],  # SOUS-ECHANTILLONNE pour l'affichage
    "fileName": "<nom sequence>",
    "duration": {"hour": h, "minute": m, "second": s},
    "autoThreshold": <float|null>          # non-null seulement si seuil auto
  }

Usage :
  python analyze_cuts.py <wav_path> <margin> <threshold> <output_json> <duration_sec> [fps] [grouping] [fallback] [display_bars]

  threshold : nombre (dB) ou "" pour auto-detection (mediane)
"""

import sys
import os
import json
import re
import subprocess

# --- Constantes (alignees sur CONSTANTS du JSX) ---
# Regroupement "content-aware" : on ne fusionne deux silences (en pontant le
# passage au-dessus du seuil qui les separe) QUE si ce passage est un blip
# (clic, frame parasite, souffle), jamais s'il s'agit de vraie parole.
FRAME_GROUPING_THRESHOLD = 0.15   # gap max (s) : au-dela, c'est forcement du contenu -> jamais ponte
SPEECH_MIN_DURATION = 0.07        # en-deca (s), le trou est trop court pour un mot -> toujours ponte (clic)
SPEECH_MARGIN_DB = 4.0            # entre les deux : c'est de la parole si le pic depasse seuil + cette marge (dB)
AUTO_THRESHOLD_FALLBACK = -65.0   # seuil si aucune valeur RMS numerique
DEFAULT_FPS = 30                  # arrondi a la frame (roundToFrame)
DISPLAY_BARS = 1800               # nb max de barres envoyees a l'UI (downsample)
RMS_NEG_INF = -99.0               # -inf stocke en -99 (comme le JSX)


def log(msg):
    """Log sur stdout (capture dans le .log par le .bat)."""
    sys.stdout.write(str(msg) + "\n")
    sys.stdout.flush()


def run_ffmpeg_astats(wav_path):
    """Lance ffmpeg astats et retourne la sortie texte (stdout+stderr combines)."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "info",
        "-i", wav_path,
        "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
        "-f", "null", "NUL",
    ]
    log("ffmpeg: " + " ".join(cmd))
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return proc.stdout.decode("utf-8", errors="replace")


# Regex identiques a l'ancien parse JSX
RE_PTS = re.compile(r"pts_time:([0-9.]+)")
RE_RMS = re.compile(r"RMS_level=([-0-9.inf]+)")


def round_to_frame(t, fps):
    return round(t * fps) / fps


def parse_astats(text, fps):
    """Parse la sortie ffmpeg -> liste de (time, rms). Reproduit parseFFmpegResults."""
    all_values = []
    current_time = None
    for line in text.split("\n"):
        m_pts = RE_PTS.search(line)
        if m_pts:
            current_time = round_to_frame(float(m_pts.group(1)), fps)
        m_rms = RE_RMS.search(line)
        if m_rms:
            rms_str = m_rms.group(1)
            rms = RMS_NEG_INF if rms_str == "-inf" else float(rms_str)
            all_values.append((current_time, rms))
    return all_values


def calculate_rms_threshold(all_values):
    """Seuil auto : (-90 + mediane) / 2 + 1.5. Reproduit calculateRmsMedian."""
    numeric = [rms for (_t, rms) in all_values if rms != RMS_NEG_INF]
    if not numeric:
        return AUTO_THRESHOLD_FALLBACK
    numeric.sort()
    n = len(numeric)
    mid = n // 2
    if n % 2 == 0:
        median = (numeric[mid - 1] + numeric[mid]) / 2.0
    else:
        median = numeric[mid]
    return (-90.0 + median) / 2.0 + 1.5


def group_cut_zones(all_values, threshold, margin):
    """Regroupe les silences en zones de coupe, puis applique la marge.

    Version "content-aware". Entre deux runs de silence se trouve un passage
    entierement au-dessus du seuil (sinon il y aurait un silence au milieu). On
    fusionne les deux silences (= on coupe par-dessus ce passage) UNIQUEMENT si
    ce passage est un blip et non de la parole :

      - gap > FRAME_GROUPING_THRESHOLD  -> contenu certain -> pas de fusion
      - gap < SPEECH_MIN_DURATION       -> trop court pour un mot -> blip, on ponte
      - sinon                           -> parole si pic >= seuil + SPEECH_MARGIN_DB
                                           (parole -> pas de fusion ; sinon souffle/bruit -> on ponte)

    Empeche d'avaler un mot bref coince entre deux silences (bug de l'ancien
    pont aveugle a FRAME_GROUPING_THRESHOLD).
    """
    runs = []                 # [[start, end], ...] runs de silence (avant marge)
    cur_start = None
    cur_end = None
    gap_peak = RMS_NEG_INF    # pic RMS du passage loud en cours (depuis la fin du dernier run)

    for (t, rms) in all_values:
        if t is None:
            continue
        if rms < threshold:
            # --- frame silencieuse ---
            if cur_start is None:
                # ouverture d'un silence : faut-il ponter le passage loud precedent ?
                if runs:
                    prev_start, prev_end = runs[-1]
                    gap_dur = t - prev_end
                    if gap_dur > FRAME_GROUPING_THRESHOLD:
                        bridge = False
                    elif gap_dur < SPEECH_MIN_DURATION:
                        bridge = True
                    else:
                        bridge = gap_peak < threshold + SPEECH_MARGIN_DB
                    if bridge:
                        cur_start = prev_start   # prolonge le run precedent
                        runs.pop()
                    else:
                        cur_start = t
                else:
                    cur_start = t
                cur_end = t
            else:
                cur_end = t
        else:
            # --- frame au-dessus du seuil (passage loud) ---
            if cur_start is not None:
                runs.append([cur_start, cur_end])
                cur_start = None
                cur_end = None
                gap_peak = rms
            elif rms > gap_peak:
                gap_peak = rms

    if cur_start is not None:
        runs.append([cur_start, cur_end])

    cut_zones = []
    for start, end in runs:
        s = start + margin
        e = end - margin
        if s < e:
            cut_zones.append([s, e])
    return cut_zones


def downsample_waveform(all_values, max_bars):
    """Sous-echantillonne pour l'affichage : moyenne RMS par bucket.
    L'ancien code creait 1 barre DOM par entree -> 204k barres pour 72 min (crash).
    On limite a max_bars barres."""
    n = len(all_values)
    if n == 0:
        return []
    if n <= max_bars:
        return [{"time": t if t is not None else 0, "debit": rms} for (t, rms) in all_values]

    bucket_size = float(n) / max_bars
    out = []
    i = 0
    while i < max_bars:
        start_idx = int(i * bucket_size)
        end_idx = int((i + 1) * bucket_size)
        if end_idx <= start_idx:
            end_idx = start_idx + 1
        if start_idx >= n:
            break
        chunk = all_values[start_idx:end_idx]
        # temps = debut du bucket ; debit = moyenne (les silences tirent la moyenne vers le bas)
        t0 = chunk[0][0]
        avg = sum(r for (_t, r) in chunk) / len(chunk)
        out.append({"time": t0 if t0 is not None else 0, "debit": round(avg * 10) / 10})
        i += 1
    return out


def seconds_to_duration(total_sec):
    total = int(round(total_sec))
    return {
        "hour": total // 3600,
        "minute": (total % 3600) // 60,
        "second": total % 60,
    }


def main():
    if len(sys.argv) < 6:
        log("ERREUR: arguments manquants")
        sys.exit(1)

    wav_path = sys.argv[1]
    margin = float(sys.argv[2]) if sys.argv[2] else 0.0
    threshold_arg = sys.argv[3].strip() if len(sys.argv) > 3 else ""
    output_json = sys.argv[4]
    duration_sec = float(sys.argv[5]) if sys.argv[5] else 0.0
    fps = int(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else DEFAULT_FPS

    file_name = os.path.splitext(os.path.basename(wav_path))[0]
    done_path = os.path.splitext(output_json)[0] + ".done"

    # Nettoyage d'anciens marqueurs
    for p in (output_json, done_path):
        try:
            if os.path.exists(p):
                os.remove(p)
        except OSError:
            pass

    if not os.path.exists(wav_path):
        log("ERREUR: WAV introuvable : " + wav_path)
        _write_error(output_json, done_path, file_name, "Fichier WAV introuvable")
        sys.exit(1)

    log("Analyse ffmpeg de " + file_name + " (" + str(int(duration_sec)) + "s)...")
    text = run_ffmpeg_astats(wav_path)

    all_values = parse_astats(text, fps)
    log("RMS extraits : " + str(len(all_values)))

    if not all_values:
        _write_error(output_json, done_path, file_name,
                     "Aucune donnee RMS (ffmpeg n'a rien produit)")
        sys.exit(1)

    # Seuil : manuel si fourni et numerique, sinon auto (mediane)
    auto_threshold = None
    try:
        threshold = float(threshold_arg)
        if threshold != threshold:  # NaN
            raise ValueError()
    except ValueError:
        auto_threshold = round(calculate_rms_threshold(all_values) * 10) / 10
        threshold = auto_threshold
    log("Seuil utilise : " + str(threshold) + (" (auto)" if auto_threshold is not None else " (manuel)"))

    cut_zones = group_cut_zones(all_values, threshold, margin)
    log("Zones de coupe : " + str(len(cut_zones)))

    result = {
        "Message": u"Analyse réussie",
        "Value": cut_zones,
        "AllValueWav": downsample_waveform(all_values, DISPLAY_BARS),
        "fileName": file_name,
        "duration": seconds_to_duration(duration_sec),
        "autoThreshold": auto_threshold,
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    # Marqueur de fin (poll cote JS)
    with open(done_path, "w", encoding="utf-8") as f:
        f.write("ok")

    log("JSON create : " + output_json)


def _write_error(output_json, done_path, file_name, message):
    result = {"Message": message, "fileName": file_name}
    try:
        with open(output_json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        with open(done_path, "w", encoding="utf-8") as f:
            f.write("err")
    except OSError:
        pass


if __name__ == "__main__":
    main()
