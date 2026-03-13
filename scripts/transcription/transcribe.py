import whisper
import re
import os
import json
from datetime import timedelta
import sys

audio_path = sys.argv[1]
goal = sys.argv[2]  # "BROLL" ou "SRT"
try:
    char_limit = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
except (ValueError, TypeError):
    char_limit = None

model_name = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else "large-v3"
output_dir = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None

model = whisper.load_model(model_name)

if output_dir:
    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    if goal == "SRT":
        output_json = os.path.join(output_dir, base_name + "SRT.json")
    else:
        output_json = os.path.join(output_dir, base_name + ".json")
else:
    if goal == "SRT":
        output_json = os.path.splitext(audio_path)[0] + "SRT.json"
    else:
        output_json = os.path.splitext(audio_path)[0] + ".json"

if goal == "SRT":
    charnbr = char_limit if char_limit else 19
else:
    charnbr = char_limit if char_limit else 40

# Garde-fou : clamping entre 10 et 80
charnbr = max(10, min(80, charnbr))

# 🔹 Signes spéciaux
PERCENT_SIGNS = {"%", "％", "000"}   # ASCII et pleine largeur
EURO_SIGNS    = {"€", "EURO", "euros", "Euros", "EUROS", "euro", "Euro"}

# 🔹 Transcrire l'audio avec timestamps mot à mot
result = model.transcribe(audio_path, word_timestamps=True)

# ---------- Nettoyage de base ----------

def clean(word):
    txt = re.sub(r"[.,]", "", word).strip()
    txt = re.sub(r"\b(euros?|EUROS?|Euros?|Euro)\b", "€", txt)
    return txt

def is_number(token: str) -> bool:
    token = token.strip()
    return re.fullmatch(r"\d+(?:[.,]\d+)?", token) is not None

# ---------- Custom replacements EN DERNIER ----------
# Tu peux rajouter d'autres mappings ici
CUSTOM_REPLACEMENTS = {
    "school": "skool",
    "col":"call",
    "etiquette": "high ticket",
    "euro": "€",
    "euros": "€",
    "«": " : ",
    "lotiquette": "low ticket",
    "lotticket": "low ticket",
    "lo ticket": "low ticket",
    "notering": "nurtering",
    "se caler": "scaler",
    "lits": "leads",
    "cols": "calls",
    "se quêler": "scaler",
    "scalaise ": "scaler",
    "scalaire": "scaler",
    "escaler": "scaler",
    "lotiquettes": "low tickets",
    "lot ticket": "low ticket",
    "l'autiquette": "low ticket",
    "vessel": "VSL",
    "book call": "book a call",
    "étiquette": "high ticket"
}

def apply_custom_replacements(text: str) -> str:
    """
    Applique les remplacements custom sur le texte final.
    Respecte les limites de mots avec \b pour éviter les faux positifs.
    """
    for src, dst in CUSTOM_REPLACEMENTS.items():
        pattern = re.compile(r"\b" + re.escape(src) + r"\b", re.IGNORECASE)
        text = pattern.sub(dst, text)
    return text

# ---------- Merges intelligents AVANT le découpage ----------

def merge_apostrophe_words(words):
    merged = []
    i = 0
    while i < len(words):
        current = words[i]
        if i < len(words) - 1:
            next_word = words[i + 1]
            if next_word["word"].startswith("'"):
                merged_word = {
                    "word": current["word"] + next_word["word"],
                    "start": current["start"],
                    "end": next_word["end"]
                }
                merged.append(merged_word)
                i += 2
                continue
        merged.append(current)
        i += 1
    return merged

def merge_hyphen_words(words):
    merged = []
    i = 0
    while i < len(words):
        text = words[i]["word"]
        start = words[i]["start"]
        end = words[i]["end"]
        j = i

        while j + 1 < len(words):
            nxt = words[j + 1]["word"]
            if nxt == "-" or text.endswith("-") or nxt.startswith("-"):
                text = text.rstrip("-") + "-" + nxt.lstrip("-")
                end = words[j + 1]["end"]
                j += 1
            else:
                break

        merged.append({"word": text, "start": start, "end": end})
        i = j + 1
    return merged

def merge_number_unit_words(words):
    merged = []
    i = 0
    while i < len(words):
        cur_raw = words[i]["word"]
        cur = cur_raw.strip()

        if i < len(words) - 1:
            nxt_raw = words[i + 1]["word"]
            nxt = nxt_raw.strip()

            if is_number(cur) and (nxt in PERCENT_SIGNS or nxt in EURO_SIGNS):
                merged.append({
                    "word": cur + nxt,
                    "start": words[i]["start"],
                    "end":   words[i + 1]["end"]
                })
                i += 2
                continue

            if cur in EURO_SIGNS and is_number(nxt):
                merged.append({
                    "word": cur + nxt,
                    "start": words[i]["start"],
                    "end":   words[i + 1]["end"]
                })
                i += 2
                continue

        merged.append(words[i])
        i += 1

    return merged

# ---------- Regroupement en chunks ----------

def group_words(words, max_chars):
    chunks = []
    current_chunk = []
    current_len = 0

    for word in words:
        raw_txt = word['word']
        txt = clean(raw_txt)
        if not txt:
            continue

        prev_word = current_chunk[-1]["word"] if current_chunk else ""
        avoid_cut = prev_word.endswith("'") or raw_txt.startswith("'")

        if current_len + len(txt) + 1 <= max_chars or avoid_cut or not current_chunk:
            current_chunk.append(word)
            current_len += (len(txt) + (0 if not current_chunk[:-1] else 1))
        else:
            chunks.append(current_chunk)
            current_chunk = [word]
            current_len = len(txt) + 1

        if re.search(r'[.,?!…]$', raw_txt.rstrip()):
            chunks.append(current_chunk)
            current_chunk = []
            current_len = 0

    if current_chunk:
        chunks.append(current_chunk)

    return chunks

# ---------- Préparation des mots ----------

all_words = []
for segment in result["segments"]:
    if "words" in segment:
        all_words.extend(segment["words"])

all_words = merge_apostrophe_words(all_words)
all_words = merge_hyphen_words(all_words)
all_words = merge_number_unit_words(all_words)

def smart_join(words):
    final = ""
    for i, w in enumerate(words):
        word = clean(w["word"])
        if i == 0:
            final += word
        else:
            prev = clean(words[i - 1]["word"])
            if word.startswith("'") or prev.endswith("'"):
                final += word
            else:
                final += " " + word
    return final

# ---------- Découpage en chunks ----------

chunks = group_words(all_words, max_chars=charnbr)

# ---------- Construction du JSON ----------

json_output = []
for i, chunk in enumerate(chunks):
    start = chunk[0]["start"]
    end = chunk[-1]["end"]

    # Texte final du chunk
    line = smart_join(chunk)
    # 🔥 Application du filtre custom EN DERNIER
    line = apply_custom_replacements(line)

    # Détails mots par mots
    words_list = []
    for w in chunk:
        w_txt = clean(w["word"])
        w_txt = apply_custom_replacements(w_txt)
        words_list.append({
            "word": w_txt,
            "start": w["start"],
            "end": w["end"]
        })

    json_output.append({
        "index": i + 1,
        "start": start,
        "end": end,
        "text": line,
        "words": words_list
    })

# ---------- Sauvegarde ----------

with open(output_json, "w", encoding="utf-8") as f:
    json.dump(json_output, f, indent=2, ensure_ascii=False)

print(f"JSON create : {output_json}")
