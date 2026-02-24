@echo off
setlocal
set "PATH=C:\Users\Administrateur\AppData\Roaming\Adobe\CEP\extensions\Productivity\bin;%PATH%"
python "C:\Users\Administrateur\AppData\Roaming\Adobe\CEP\extensions\Productivity\scripts\transcription\transcribe.py" "E:\VIDEO\Montage\Projets\Olivier\Projet 186\07_Audio\AD10.wav" "BROLL" > "E:\VIDEO\Montage\Projets\Olivier\Projet 186\07_Audio\stdout.log" 2>&1
endlocal
