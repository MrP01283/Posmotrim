import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.join(__dirname, "..", "frontend");

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const questionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    question: { type: "string" },
    options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
    correctAnswer: { type: "string" }
  },
  required: ["question", "options", "correctAnswer"]
};

const blockSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    duration: { type: "number" },
    studentContent: { type: "string" },
    teacherNotes: { type: "string" },
    questions: { type: "array", items: questionSchema }
  },
  required: ["id", "title", "duration", "studentContent", "teacherNotes"]
};

function validateLessonSettings(body) {
  const { subject, topic, level, lessonGoal, totalDuration, blocks } = body;

  if (!subject || !topic || !level || !lessonGoal || !Number.isFinite(Number(totalDuration)) || !Array.isArray(blocks) || blocks.length === 0) {
    return "Заполните все обязательные поля и выберите хотя бы один блок";
  }

  if (blocks.some((block) => !block?.id || !block.name || !Number.isFinite(Number(block.duration)) || Number(block.duration) <= 0)) {
    return "Проверьте выбранные блоки и их длительность";
  }

  const blocksDuration = blocks.reduce((sum, block) => sum + Number(block.duration), 0);
  if (blocksDuration !== Number(totalDuration)) {
    return "Сумма длительности блоков должна совпадать с общей длительностью";
  }

  if (blocks.some((block) => block.id === "quiz")) {
    const questionCount = Number(body.quizSettings?.questionCount);
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 20) {
      return "Укажите количество вопросов в quizSettings от 1 до 20";
    }
  }

  return null;
}

function buildLessonPrompt(settings) {
  const { subject, topic, level, lessonGoal, totalDuration, blocks, quizSettings } = settings;
  return `Ты помощник преподавателя. Создай материалы только для выбранных блоков занятия.

Предмет: ${subject}
Тема: ${topic}
Уровень студентов: ${level}
Цель занятия: ${lessonGoal}
Общая длительность: ${totalDuration} минут
Выбранные блоки: ${JSON.stringify(blocks)}
Настройки мини-теста: ${JSON.stringify(quizSettings || null)}

Верни только JSON. Поля lesson: subject, topic, goal, totalDuration и blocks. Верни ровно те блоки и в том же порядке, которые есть в списке. Не добавляй блоки, сохраняй их id и duration, учитывай teacherNote, цель и уровень. Для блока quiz добавь questions с ${quizSettings?.questionCount || 0} вопросами; у каждого ровно 4 options и correctAnswer должен совпадать с option.`;
}

function buildBlockPrompt(settings, block) {
  return `Ты помощник преподавателя. Перегенерируй только этот блок и верни только его JSON.
Предмет: ${settings.subject}
Тема: ${settings.topic}
Уровень: ${settings.level}
Цель: ${settings.lessonGoal}
Общая длительность: ${settings.totalDuration} минут
Блок: ${JSON.stringify(block)}
Настройки теста: ${JSON.stringify(settings.quizSettings || null)}
Сохрани id и duration, учти teacherNote. Если id равен quiz, добавь нужное количество вопросов, ровно 4 варианта и правильный ответ.`;
}

async function askGemini(prompt, schema) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "Отвечай только валидным JSON без markdown." }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema }
    })
  });

  if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini API returned empty response");
  return JSON.parse(text);
}

app.post("/api/generate", async (req, res) => {
  const validationError = validateLessonSettings(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const lesson = await askGemini(buildLessonPrompt(req.body), {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string" },
        topic: { type: "string" },
        goal: { type: "string" },
        totalDuration: { type: "number" },
        blocks: { type: "array", minItems: req.body.blocks.length, maxItems: req.body.blocks.length, items: blockSchema }
      },
      required: ["subject", "topic", "goal", "totalDuration", "blocks"]
    });
    return res.json({ success: true, lesson });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Не удалось получить ответ от AI" });
  }
});

app.post("/api/regenerate-block", async (req, res) => {
  const validationError = validateLessonSettings(req.body);
  const block = req.body.blocks?.find((item) => item.id === req.body.blockId);
  if (validationError || !req.body.blockId || !block) {
    return res.status(400).json({ error: validationError || "Укажите существующий blockId" });
  }

  try {
    const blockSchemaForRequest = JSON.parse(JSON.stringify(blockSchema));
    if (block.id === "quiz") {
      const count = Number(req.body.quizSettings.questionCount);
      blockSchemaForRequest.properties.questions.minItems = count;
      blockSchemaForRequest.properties.questions.maxItems = count;
    }
    const regeneratedBlock = await askGemini(buildBlockPrompt(req.body, block), blockSchemaForRequest);
    return res.json({ success: true, block: regeneratedBlock });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Не удалось получить ответ от AI" });
  }
});

app.use(express.static(frontendDirectory));

app.listen(PORT, () => {
  console.log(`Backend is running on http://localhost:${PORT}`);
});
