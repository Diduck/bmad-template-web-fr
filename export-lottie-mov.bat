@echo off
echo ========================================
echo  Export Lottie PNG → MOV (ProRes 4444)
echo  Alpha channel pour Premiere Pro
echo ========================================
echo.

set SCRIPT_DIR=%~dp0
set FFMPEG=%SCRIPT_DIR%bin\ffmpeg.exe
set FRAMES_DIR=%SCRIPT_DIR%lottie-frames\frames
set OUTPUT=%SCRIPT_DIR%lottie-clock-overlay.mov

:: Verifier ffmpeg
if not exist "%FFMPEG%" (
    echo ERREUR: ffmpeg.exe introuvable dans bin\
    pause
    exit /b 1
)

:: Creer le dossier si besoin et dezipper
if not exist "%SCRIPT_DIR%lottie-frames" (
    mkdir "%SCRIPT_DIR%lottie-frames"
)

:: Verifier si les frames existent
if not exist "%FRAMES_DIR%\frame_000.png" (
    echo.
    echo Dezippe d'abord lottie-frames.zip dans le dossier lottie-frames\
    echo Structure attendue : lottie-frames\frames\frame_000.png, frame_001.png, ...
    echo.

    :: Tenter un dezippage automatique avec PowerShell
    if exist "%SCRIPT_DIR%lottie-frames-1000.zip" (
        echo Dezippage automatique de lottie-frames-1000.zip...
        powershell -Command "Expand-Archive -Path '%SCRIPT_DIR%lottie-frames-1000.zip' -DestinationPath '%SCRIPT_DIR%lottie-frames' -Force"
        echo Done.
    ) else if exist "%SCRIPT_DIR%lottie-frames.zip" (
        echo Dezippage automatique de lottie-frames.zip...
        powershell -Command "Expand-Archive -Path '%SCRIPT_DIR%lottie-frames.zip' -DestinationPath '%SCRIPT_DIR%lottie-frames' -Force"
        echo Done.
    ) else (
        echo ERREUR: lottie-frames.zip introuvable.
        echo Telecharge-le depuis la page HTML d'abord.
        pause
        exit /b 1
    )
)

:: Verifier encore
if not exist "%FRAMES_DIR%\frame_000.png" (
    echo ERREUR: Frames introuvables dans %FRAMES_DIR%
    pause
    exit /b 1
)

echo.
echo Conversion en cours...
echo Input:  %FRAMES_DIR%\frame_%%03d.png
echo Output: %OUTPUT%
echo Codec:  ProRes 4444 avec alpha (full range)
echo.

"%FFMPEG%" -y -framerate 30 -i "%FRAMES_DIR%\frame_%%03d.png" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -color_range pc -an "%OUTPUT%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo  SUCCES ! Fichier cree :
    echo  %OUTPUT%
    echo.
    echo  → Importe ce .mov dans Premiere Pro
    echo  → Place-le au-dessus de ta video
    echo  → L'alpha est natif, pas besoin de keying
    echo ========================================
) else (
    echo.
    echo ERREUR lors de la conversion ffmpeg.
)

echo.
pause
