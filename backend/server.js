import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.join(__dirname, "..", "frontend");

app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"]
  })
);
app.use(express.json());

app.post("/api/generate", async (req, res) => {
  const { subject, topic, level } = req.body;

  if (!subject || !topic || !level) {
    return res.status(400).json({ error: "Заполните все поля" });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Не найден GEMINI_API_KEY. Создайте файл backend/.env по примеру backend/.env.example и добавьте в него ключ Gemini."
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "Ты помощник преподавателя. Отвечай только валидным JSON без Markdown и без пояснений."
            }
          ]
        },
        contents: [
          {
            parts: [
              {
                text: `Создай учебные материалы для демо-сайта AI Teacher Assistant.

Предмет: ${subject}
Тема урока: ${topic}
Класс/курс: ${level}

Верни строго JSON в таком формате:
{
  "explanation": "Краткое и понятное объяснение темы",
  "lessonPlan": ["Введение", "Объяснение", "Практика"],
  "quiz": [
    {
      "question": "Вопрос",
      "options": ["Ответ A", "Ответ B", "Ответ C", "Ответ D"],
      "correctAnswer": "Ответ A"
    }
  ],
  "homework": "Описание домашнего задания"
}

Требования:
- quiz должен содержать ровно 5 вопросов;
- у каждого вопроса должно быть ровно 4 варианта ответа;
- correctAnswer должен полностью совпадать с одним из вариантов options;
- не добавляй текст вне JSON.`
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                explanation: { type: "string" },
                lessonPlan: {
                  type: "array",
                  items: { type: "string" }
                },
                quiz: {
                  type: "array",
                  minItems: 5,
                  maxItems: 5,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      question: { type: "string" },
                      options: {
                        type: "array",
                        minItems: 4,
                        maxItems: 4,
                        items: { type: "string" }
                      },
                      correctAnswer: { type: "string" }
                    },
                    required: ["question", "options", "correctAnswer"]
                  }
                },
                homework: { type: "string" }
              },
              required: ["explanation", "lessonPlan", "quiz", "homework"]
          }
        }
      })
    }
    );

    if (!response.ok) {
      const errorDetails = await response.text();
      throw new Error(`Gemini API request failed: ${errorDetails}`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("");

    if (!generatedText) {
      throw new Error("Gemini API returned an empty response");
    }

    return res.json(JSON.parse(generatedText));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Не удалось получить ответ от AI" });
  }
});

// The API and the browser interface are served by one application in production.
app.use(express.static(frontendDirectory));

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDirectory, "index.html"));
});

app.listen(PORT, () => {
  console.log(`AI Teacher Assistant is running on http://localhost:${PORT}`);
});
