#!/usr/bin/env python3
"""
Simple TTS generation script using pyttsx3, gTTS, and Meta MMS.
Enhanced with strict language enforce checks and fallback mechanisms for Care Companion.
"""

import sys
import json
import os
import argparse
import platform
import subprocess
import re
from pathlib import Path

# Force UTF-8 Encoding for stdout and stderr to handle Urdu characters cleanly on Windows
if sys.platform.startswith("win"):
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.detach())
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.detach())

# ----------------------------------------------------------------------
# Platform detection
# ----------------------------------------------------------------------
IS_WINDOWS = platform.system() == "Windows"
IS_PI = platform.system() == "Linux" and platform.machine() in ('armv7l', 'aarch64')

SCRIPT_DIR = Path(__file__).resolve().parent  # /backend/tts_service_offline
BACKEND_DIR = SCRIPT_DIR.parent  # /backend

print(f"Script located at: {SCRIPT_DIR}", file=sys.stderr)
print(f"Backend directory: {BACKEND_DIR}", file=sys.stderr)


# Simple English text to Urdu mapping dictionary for core health tips
HEALTH_TIPS_TRANSLATION_MAP = {
    "practice deep breathing exercises to reduce stress": "ذہنی دباؤ کم کرنے کے لیے گہرے سانس لینے کی مشق کریں۔",
    "get 7-8 hours of sleep every night": "ہر رات سات سے آٹھ گھنٹے کی نیند لیں۔",
    "drink at least 8 glasses of water daily to stay": "خود کو ہائیڈریٹ رکھنے کے لیے روزانہ کم از کم 8 گلاس پانی پییں۔",
    "avoid sugary drinks and prefer water or herbal tea": "میٹھے مشروبات سے پرہیز کریں اور پانی یا ہربل چائے ko tarjeeh dein.",
    "take a 30-minute walk every day for better health": "بہتر صحت کے لیے روزانہ 30 min waak karein.",
    "take breaks every hour to stretch your neck and sh": "گردن اور کندھوں ko khinchne ke liye har ghantay baad waqfa len.",
    "sit up straight with your shoulders back and relax": "اپنے کندھوں کو پیچھے رکھ کر سیدھے بیٹھیں اور پرسکون رہیں۔",
    "eat more fruits and vegetables for better nutritio": "بہتر غذائیت کے لیے زیادہ پھل اور سبزیاں کھائیں۔"
}

# Mapping Urdu text to Roman Urdu for absolute emergency fallback (Stops Windows SAPI5 from crashing)
URDU_TO_ROMAN_MAP = {
    "ذہنی دباؤ کم کرنے کے لیے گہرے سانس لینے کی مشق کریں۔": "Zehni dabao kam karne ke liye gahray saans lene ki mashq karein.",
    "ہر رات سات سے آٹھ گھنٹے کی نیند لیں۔": "Har raat saat se aath ghantay ki neend lein.",
    "خود کو ہائیڈریٹ رکھنے کے لیے روزانہ کم از کم 8 گلاس پانی پییں۔": "Khud ko hydrate rakhne ke liye rozana kam az kam aath glass paani peeyein.",
    "میٹھے مشروبات سے پرہیز کریں اور پانی یا ہربل چائے ko tarjeeh dein.": "Meethay mashroobaat se parhez karein aur paani ya herbal chai ko tarjeeh dein.",
    "بہتر صحت کے لیے روزانہ 30 min waak karein.": "Behtar sehat ke liye rozana tees minute walk karein.",
    "گردن اور کندھوں ko khinchne ke liye har ghantay baad waqfa len.": "Gardan aur kandhon ko kheenchnay ke liye har ghantay baad waqfa lein.",
    "اپنے کندھوں کو پیچھے رکھ کر سیدھے بیٹھیں اور پرسکون رہیں۔": "Apne kandhon ko peechay rakh kar seedhay baithein aur pur-sukoon rahein.",
    "بہتر غذائیت کے لیے زیادہ پھل اور سبزیاں کھائیں۔": "Behtar ghizaiyat ke liye zyada phal aur sabziyan khayein."
}

def clean_and_translate_text(text, target_lang):
    """Ensure that if Urdu is chosen, text contains actual Urdu characters or mapped translations."""
    if target_lang == "urdu":
        text_clean = text.strip().lower()
        
        # Check direct or substring match inside translation dictionary
        for english_key, urdu_translation in HEALTH_TIPS_TRANSLATION_MAP.items():
            if english_key in text_clean or text_clean in english_key:
                print(f"🔄 Auto-translated English health tip to Urdu script: {urdu_translation}", file=sys.stderr)
                return urdu_translation
        
        # If it already contains native Urdu/Arabic characters, don't modify it
        if bool(re.search('[\u0600-\u06FF]', text)):
            return text
            
        # Absolute structural fail-safe fallback
        return "اپنی صحت کا خیال رکھیں، وقت پر پانی پییں اور آرام کریں۔"
        
    return text


# ----------------------------------------------------------------------
# Urdu TTS Flow (gTTS as Primary -> pyttsx3 Roman Fallback)
# ----------------------------------------------------------------------
def generate_urdu(text, output_path):
    processed_text = clean_and_translate_text(text, "urdu")
    print(f"🔄 Processing Urdu speech stream for: {processed_text}", file=sys.stderr)
    
    # LEVEL 1: Try gTTS (Google Cloud Engine - Crystal Clear native voice)
    try:
        from gtts import gTTS
        print(f"🌐 Fetching remote gTTS cloud audio stream...", file=sys.stderr)
        
        tts = gTTS(text=processed_text, lang='ur', slow=False)
        tts.save(output_path)
        
        if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            print(f"✅ Urdu audio saved successfully via gTTS: {output_path}", file=sys.stderr)
            return True
        else:
            raise RuntimeError("gTTS generated empty file payload")
            
    except Exception as gtts_error:
        print(f"⚠️ gTTS cloud engine failed or offline: {str(gtts_error)[:100]}", file=sys.stderr)
        print(f"🔄 Shifting targets to pyttsx3 local transliteration...", file=sys.stderr)
    
    # LEVEL 2: Offline Emergency Rollback (pyttsx3 + Transliteration)
    return generate_urdu_fallback(processed_text, output_path)


def generate_urdu_fallback(text, output_path):
    """Fallback Urdu TTS using pyttsx3 with Roman Urdu transliteration"""
    try:
        import pyttsx3
    except ImportError:
        raise ImportError("pyttsx3 is not installed inside active python runtime environment.")
    
    roman_text = URDU_TO_ROMAN_MAP.get(text, "Apni sehat ka khayal rakhein, waqt par paani peeyein.")
    print(f"🔄 Transliteration parsing applied: {roman_text[:60]}", file=sys.stderr)
    
    try:
        engine = pyttsx3.init()
        voices = engine.getProperty('voices')
        
        if voices:
            engine.setProperty('voice', voices[0].id) # Defaults cleanly to standard desktop system voice
        
        engine.setProperty('rate', 145)
        engine.setProperty('volume', 0.95)
        
        engine.save_to_file(roman_text, output_path)
        engine.runAndWait()
        
        if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            print(f"✅ Fallback Urdu audio generated locally: {output_path}", file=sys.stderr)
            return True
        else:
            raise RuntimeError("pyttsx3 structural driver failure")
            
    except Exception as fallback_error:
        print(f"❌ Critical driver crash on pyttsx3 backend: {str(fallback_error)[:100]}", file=sys.stderr)
        raise RuntimeError(f"All Urdu TTS generation models exhausted.")


# ----------------------------------------------------------------------
# English TTS – using pyttsx3 / PowerShell Speech Synthesizer
# ----------------------------------------------------------------------
def generate_english_windows(text, output_path):
    output_path = Path(output_path)
    ps_text = json.dumps(text)
    ps_output = json.dumps(str(output_path))
    command = [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        (
            f"$text = {ps_text}; "
            f"$out = {ps_output}; "
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$s.SetOutputToWaveFile($out); "
            "$s.Rate = 0; "
            "$s.Volume = 100; "
            "$s.Speak($text);"
        ),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    if not output_path.exists():
        raise RuntimeError("Windows native speech engine failed file generation.")
    print(f"✅ English audio cached via PowerShell: {output_path}", file=sys.stderr)


def generate_english(text, output_path):
    print(f"🔄 Processing English speech stream: {text[:60]}", file=sys.stderr)

    if IS_WINDOWS:
        try:
            generate_english_windows(text, output_path)
            return
        except Exception as fallback_error:
            print(f"⚠️ PowerShell speech synthesis bypassed: {fallback_error}", file=sys.stderr)

    try:
        import pyttsx3
    except ImportError:
        raise ImportError("pyttsx3 runtime dependency not found.")

    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    if voices:
        for voice in voices:
            if 'english' in voice.name.lower() or 'en' in voice.name.lower():
                engine.setProperty('voice', voice.id)
                break

    engine.setProperty('rate', 180)
    engine.setProperty('volume', 0.9)

    engine.save_to_file(text, output_path)
    engine.runAndWait()
    print(f"✅ English audio successfully deployed: {output_path}", file=sys.stderr)


# ----------------------------------------------------------------------
# Execution Controller Entry Point
# ----------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", required=True, choices=["urdu", "english"])
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        out_path = Path(args.output).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # Explicit language route enforcement check 
        if args.lang == "urdu":
            generate_urdu(args.text, str(out_path))
        else:
            generate_english(args.text, str(out_path))
            
        sys.stdout.flush()
        print(json.dumps({"success": True, "file": str(out_path)}))
        
    except Exception as e:
        sys.stdout.flush()
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)