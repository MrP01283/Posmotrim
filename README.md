# AI Teacher Assistant

Приложение создаёт учебные материалы по предмету, теме и уровню учащихся.

## Запуск

1. Скопируйте `backend/.env.example` в `backend/.env` и укажите `AI_API_KEY`.
2. Установите зависимости: `cd backend && npm install`.
3. Запустите сервер: `npm start`.
4. Откройте `http://localhost:5000` в браузере.

Сервер одновременно раздаёт фронтенд и обрабатывает `POST /api/generate`.
