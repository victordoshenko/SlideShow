# SlideShow

Приложение для сборки видео-слайдшоу из большого количества фотографий (до 10 000), с плавными переходами, прогрессом рендера и desktop-сборкой на Electron.

## Возможности

- Импорт фото файлами и ZIP-архивом.
- Нормализация ориентации изображений при импорте (`sharp.rotate()`).
- Рендер MP4 через `ffmpeg` с автоматическим выбором режима.
- Переходы `xfade` для больших проектов (включая сегментный рендер).
- Прогресс рендера + debug-статус (`stage`, `bootstrapStep`, `renderMode`, `lastMessage`).
- Пресеты качества рендера в UI: `Quality` / `Balanced` / `Small size` (по умолчанию `Small size`).
- Electron desktop build + автоматическая публикация актуального ZIP в `releases`.

## Технологии

- Frontend: React + Vite
- Backend: Node.js + Express + SQLite
- Media: FFmpeg + Sharp
- Desktop: Electron + electron-packager

## Требования

- Node.js 18+
- npm
- Установленный `ffmpeg` в `PATH` или `FFMPEG_PATH`

## Установка

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

## Запуск

### Dev (frontend + backend)

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

### Только backend

```bash
npm run start
```

### Тесты backend

```bash
npm test
```

## Electron

### Локальный запуск Electron

```bash
npm run electron:dev
```

### Сборка Electron (рекомендуемый путь)

```bash
npm run electron:build
```

Что делает команда:

1. Собирает frontend.
2. Пересобирает `sqlite3` под Electron (`electron-rebuild`).
3. Упаковывает приложение в `releases/SlideShow-win32-x64`.
4. Создает ZIP с таймстампом:
   - `SlideShow-win32-x64-portable-ГГГГММДДЧЧММСС.zip`
5. Обновляет `releases/latest-electron.json` для фронтовой ссылки на «последний» архив.

## Конфигурация backend

Файл: `backend/src/config.js`

Ключевые параметры:

- `PORT` (по умолчанию `4000`)
- `MAX_FILES` (по умолчанию `10000`)
- `RENDER_CHUNK_SIZE` (по умолчанию `50`)
- `TRANSITION_OUTPUT_FPS`
- `VIDEO_CRF`
- `OPENH264_TRANSITION_BITRATE_K`
- `OPENH264_BASE_BITRATE_K`

Пример env (Windows):

```bash
set RENDER_CHUNK_SIZE=40
set TRANSITION_OUTPUT_FPS=8
set FFMPEG_PATH=C:\path\to\ffmpeg.exe
```

## Рендер-пайплайн

Режим выбирается автоматически:

- `concat` — переходы выключены или < 2 кадров.
- `inlineXfade` — переходы включены и фильтр помещается в лимиты.
- `segmentedXfade` — большие проекты: рендер чанками + merge с переходами.

Стабильность:

- `-filter_complex_script` (обход лимита длины команды в Windows),
- адаптивные таймауты ffmpeg,
- прогресс по timemark/frame с heartbeat-обновлениями.

## API (кратко)

### Сервис

- `GET /api/health`

### Проекты

- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id/settings`
- `POST /api/projects/:id/upload/files`
- `POST /api/projects/:id/upload/zip`
- `GET /api/projects/:id/frames?offset=0&limit=200`
- `GET /api/projects/:id/upload-status`
- `POST /api/projects/:id/render` (поддерживает `preset` в body)

### Рендер-джобы

- `GET /api/render-jobs/:id`
- `GET /api/render-jobs/:id/debug`
- `GET /api/render-jobs/:id/download`
- `GET /api/render-jobs/:id/preview`

### Desktop downloads

- `GET /api/downloads/latest-electron` — возвращает актуальный ZIP (`downloadUrl`)
- `GET /downloads/<file>` — раздача файлов из `releases`

## Структура хранения

`backend/storage`:

- `projects/` — исходные изображения
- `renders/` — итоговые MP4
- `tmp/` — временные файлы импорта
- `slideshow.db` — SQLite

`releases/`:

- Electron-артефакты и ZIP-архивы desktop-версий

## Частые проблемы

- `FFmpeg executable was not found`  
  Проверьте `FFMPEG_PATH`/`PATH`.

- Зависание Electron/белый экран  
  Проверьте `%APPDATA%\SlideShow\logs\main.log` и пришлите последние строки.

- Нет плавных переходов  
  Убедитесь, что `Smooth transition` включен, и смотрите `renderMode` в debug.

## Лицензия

ISC

