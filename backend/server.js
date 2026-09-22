import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const AI_API_KEY = process.env.AI_API_KEY;

app.use(
  cors({
    origin: "http://localhost:5173"
  })
);
app.use(express.json());

app.post("/api/generate", async (req, res) => {
  const { subject, topic, level } = req.body;

  if (!subject || !topic || !level) {
    return res.status(400).json({ error: "Заполните все поля" });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "system",
            content:
              "Ты помощник преподавателя. Отвечай только валидным JSON без markdown и без пояснений."
          },
          {
            role: "user",
            content: `Создай учебные материалы для демо-сайта AI Teacher Assistant.

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
        ],
        text: {
          format: {
            type: "json_schema",
            name: "teacher_assistant_materials",
            strict: true,
            schema: {
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
        }
      })
    });

    if (!response.ok) {
      throw new Error("AI API request failed");
    }

    const data = await response.json();
    const generatedText = data.output_text;

    if (!generatedText) {
      throw new Error("AI API returned empty response");
    }

    return res.json(JSON.parse(generatedText));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Не удалось получить ответ от AI" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend is running on http://localhost:${PORT}`);
});
