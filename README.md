# SlideShow

Веб-приложение для сборки видео-слайдшоу из большого количества фотографий (до 10 000), с настройкой длительности кадра и плавными переходами.

## Что умеет

- Загрузка фотографий файлами или ZIP-архивом.
- Нормализация изображений при импорте (`sharp`, авто-ориентация EXIF).
- Предпросмотр кадров во frontend.
- Рендер MP4 1080p/30fps через `ffmpeg`.
- Плавные переходы (`xfade`) для больших наборов изображений.
- Фоновая очередь рендеров с прогрессом и debug-статусом.

## Технологии

- Frontend: React + Vite
- Backend: Node.js + Express + SQLite
- Обработка медиа: FFmpeg + Sharp

## Требования

- Node.js 18+
- npm
- Установленный `ffmpeg` в `PATH` **или** переменная окружения `FFMPEG_PATH`

## Установка

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

## Запуск

### Режим разработки (frontend + backend одновременно)

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`

### Production-сборка frontend

```bash
npm run build
```

### Запуск backend

```bash
npm run start
```

### Тесты backend

```bash
npm test
```

## Конфигурация backend

Файл: `backend/src/config.js`

Ключевые параметры:

- `PORT` (по умолчанию `4000`)
- `MAX_FILES` (по умолчанию `10000`)
- `RENDER_CHUNK_SIZE` (по умолчанию `50`, минимум `2`)

Через env можно переопределить, например:

```bash
set RENDER_CHUNK_SIZE=40
set FFMPEG_PATH=C:\path\to\ffmpeg.exe
```

## Как устроен рендер

Рендерер выбирает режим автоматически:

- `concat` — когда переходы выключены или кадров меньше 2.
- `inlineXfade` — когда переходы включены и команда безопасна по длине.
- `segmentedXfade` — для больших проектов: рендер чанками с `xfade`, затем merge с переходами.

Для стабильности используются:

- `-filter_complex_script` (чтобы не упираться в лимит длины командной строки Windows),
- адаптивные таймауты ffmpeg (вместо фиксированного 4-минутного лимита),
- пошаговый прогресс рендера (включая чанки и merge-этап).

## API (кратко)

### Health

- `GET /api/health`

### Проекты

- `POST /api/projects` — создать проект
- `GET /api/projects/:id` — получить проект
- `PATCH /api/projects/:id/settings` — обновить настройки
- `POST /api/projects/:id/upload/files` — загрузка фото
- `POST /api/projects/:id/upload/zip` — загрузка ZIP
- `GET /api/projects/:id/frames?offset=0&limit=200` — список кадров
- `GET /api/projects/:id/upload-status` — статус импорта
- `POST /api/projects/:id/render` — старт рендера

### Рендер-джобы

- `GET /api/render-jobs/:id` — статус джобы
- `GET /api/render-jobs/:id/debug` — debug-информация (`stage`, `bootstrapStep`, `renderMode`, `lastMessage`)
- `GET /api/render-jobs/:id/download` — скачать MP4
- `GET /api/render-jobs/:id/preview` — просмотр MP4

## Хранилище

Backend использует каталог `backend/storage`:

- `projects/` — исходные изображения по проектам
- `renders/` — итоговые видео
- `tmp/` — временные файлы загрузок
- `slideshow.db` — база SQLite

## Частые проблемы

- `FFmpeg executable was not found`  
  Проверьте `FFMPEG_PATH` или наличие `ffmpeg` в `PATH`.

- Рендер падает на больших проектах  
  Проверьте `/api/render-jobs/:id/debug` и поле `lastMessage`; при необходимости уменьшите `RENDER_CHUNK_SIZE` (например, до `30-40`).

- Нет плавных переходов  
  Убедитесь, что включен `Smooth transition` и `transitionDurationMs > 0`.  
  В debug проверьте `renderMode` — должен быть `inlineXfade` или `segmentedXfade`.

## Лицензия

ISC

