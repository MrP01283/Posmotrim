# AI Teacher Assistant

Приложение создаёт учебные материалы по предмету, теме и уровню учащихся.

## Запуск

1. В папке проекта выполните `npm run setup`.
2. Скопируйте `backend/.env.example` в новый файл `backend/.env`.
3. В `backend/.env` укажите бесплатный ключ: `GEMINI_API_KEY=ваш_ключ_из_Google_AI_Studio`.
4. В папке проекта выполните `npm start`.
5. Откройте `http://localhost:5000` в браузере.

Сервер одновременно раздаёт фронтенд и обрабатывает `POST /api/generate`.
