@echo off
setlocal
set "PATH=C:\Users\Administrateur\AppData\Roaming\Adobe\CEP\extensions\Productivity\bin;%PATH%"
python "C:\Users\Administrateur\AppData\Roaming\Adobe\CEP\extensions\Productivity\scripts\transcription\transcribe.py" "E:\VIDEO\Montage\Projets\Fiverr\Projet 55\07_Audio\Audio\AD1.wav" "BROLL" "" "" > "E:\VIDEO\Montage\Projets\Fiverr\Projet 55\07_Audio\Audio\stdout.log" 2>&1
endlocal
