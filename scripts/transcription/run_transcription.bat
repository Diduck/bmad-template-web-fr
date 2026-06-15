@echo off
setlocal
set "PATH=C:\Users\Administrateur\AppData\Roaming\Adobe\CEP\extensions\Productivity\bin;%PATH%"
python "C:\Users\Administrateur\AppData\Roaming\Adobe\CEP\extensions\Productivity\scripts\transcription\transcribe.py" "E:\VIDEO\Montage\Projets\Olivier\Projet 199\07_Audio\Audio\Intro.wav" "SRT" "25" "" "E:\VIDEO\Montage\Projets\Olivier\Projet 199\07_Audio\Subtitles" > "E:\VIDEO\Montage\Projets\Olivier\Projet 199\07_Audio\Audio\stdout.log" 2>&1
endlocal
