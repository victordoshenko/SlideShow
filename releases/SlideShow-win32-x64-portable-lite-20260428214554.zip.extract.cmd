@echo off
setlocal
set "ARCHIVE_BASE=SlideShow-win32-x64-portable-lite-20260428214554.zip"
set "COPY_LIST="SlideShow-win32-x64-portable-lite-20260428214554.zip.001"+"SlideShow-win32-x64-portable-lite-20260428214554.zip.002""
set "WORK_ZIP=%TEMP%\%ARCHIVE_BASE%"
set "TARGET_DIR=%~dp0%ARCHIVE_BASE%"
if exist "%WORK_ZIP%" del /f /q "%WORK_ZIP%" >nul 2>nul
echo Combining multi-volume archive...
copy /b %COPY_LIST% "%WORK_ZIP%" >nul
if errorlevel 1 (
  echo Failed to combine archive parts. Ensure all parts are in this folder.
  pause
  exit /b 1
)
echo Extracting archive...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%WORK_ZIP%' -DestinationPath '%TARGET_DIR%' -Force"
if errorlevel 1 (
  echo Extraction failed.
  pause
  exit /b 1
)
del /f /q "%WORK_ZIP%" >nul 2>nul
echo Done. Extracted to:
echo %TARGET_DIR%
pause