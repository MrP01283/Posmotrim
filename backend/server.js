import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3-flash-preview";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.join(__dirname, "..", "frontend");

const BLOCKS = {
  explanation: "Объяснение темы",
  theory: "Теория",
  practice: "Практика",
  case: "Кейс",
  discussion: "Дискуссия",
  quiz: "Мини-тест",
  reflection: "Рефлексия",
  homework: "Домашнее задание"
};

class ValidationError extends Error {}

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

function getLessonSettings(body) {
  const { subject, topic, level, lessonGoal, totalDuration, blocks, quizSettings } = body;

  if (!subject?.trim() || !topic?.trim() || !level?.trim()) {
    throw new ValidationError("Заполните предмет, тему и уровень студентов.");
  }

  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new ValidationError("Выберите хотя бы один блок занятия.");
  }

  const ids = new Set();

  const normalizedBlocks = blocks.map((block) => {
    if (!BLOCKS[block.id] || ids.has(block.id)) {
      throw new ValidationError("Получен некорректный набор блоков занятия.");
    }

    const duration = Number(block.duration);

    if (!Number.isInteger(duration) || duration < 0) {
      throw new ValidationError("Время каждого блока должно быть целым неотрицательным числом.");
    }

    ids.add(block.id);

    return {
      id: block.id,
      name: BLOCKS[block.id],
      duration,
      teacherNote: String(block.teacherNote || "").trim()
    };
  });

  const duration = Number(totalDuration);

  if (![15, 30, 45, 60, 90].includes(duration)) {
    throw new ValidationError("Выберите допустимую общую длительность занятия.");
  }

  if (normalizedBlocks.reduce((sum, block) => sum + block.duration, 0) !== duration) {
    throw new ValidationError("Распределите всё время занятия между выбранными блоками.");
  }

  const normalizedQuizSettings = ids.has("quiz")
    ? {
        questionCount: [3, 5, 10].includes(Number(quizSettings?.questionCount))
          ? Number(quizSettings.questionCount)
          : 5,
        difficulty: ["easy", "medium", "hard"].includes(quizSettings?.difficulty)
          ? quizSettings.difficulty
          : "medium",
        showAnswers: Boolean(quizSettings?.showAnswers)
      }
    : null;

  return {
    subject: subject.trim(),
    topic: topic.trim(),
    level: level.trim(),
    lessonGoal: String(lessonGoal || "Понять новую тему"),
    totalDuration: duration,
    blocks: normalizedBlocks,
    quizSettings: normalizedQuizSettings
  };
}

function buildLessonPrompt(settings) {
  const selectedBlocks = settings.blocks
    .map((block) => `- ${block.id} («${block.name}»): ${block.duration} минут. Заметка преподавателя: ${block.teacherNote || "нет"}`)
    .join("\n");

  const quizRules = settings.quizSettings
    ? `Мини-тест: ровно ${settings.quizSettings.questionCount} вопросов, сложность: ${settings.quizSettings.difficulty}. У каждого вопроса строго 4 варианта и один correctAnswer, который полностью совпадает с одним вариантом.`
    : "Мини-тест не выбран — не добавляй его.";

  return `Ты — помощник преподавателя. Создай материалы занятия строго по настройкам.

Предмет: ${settings.subject}
Тема: ${settings.topic}
Уровень студентов: ${settings.level}
Цель: ${settings.lessonGoal}
Общая длительность: ${settings.totalDuration} минут.

Выбранные блоки:
${selectedBlocks}

${quizRules}

Верни только валидный JSON без Markdown и без пояснений:
{
  "blocks": [
    {
      "id": "идентификатор выбранного блока",
      "title": "Название блока",
      "duration": число минут из настроек,
      "studentContent": "материал для студентов",
      "teacherNotes": "личные заметки преподавателю: что сказать, где задать вопрос, ожидаемые ошибки"
    }
  ]
}

Для блока с id "quiz" вместо studentContent верни:
{
  "id": "quiz",
  "title": "Мини-тест",
  "duration": число минут,
  "questions": [
    {
      "question": "Вопрос",
      "options": ["Вариант A", "Вариант B", "Вариант C", "Вариант D"],
      "correctAnswer": "Один из вариантов"
    }
  ],
  "teacherNotes": "личные заметки преподавателю"
}

Верни только выбранные блоки, каждый ровно один раз, в том же порядке. Не добавляй блоки, которые не выбрал преподаватель.`;
}

function buildRegeneratePrompt(settings, block) {
  const quizRules = block.id === "quiz"
    ? `Создай ровно ${settings.quizSettings.questionCount} вопросов сложности ${settings.quizSettings.difficulty}; у каждого строго 4 варианта и один correctAnswer, совпадающий с вариантом.`
    : "Создай содержательный материал для студентов.";

  return `Ты — помощник преподавателя. Обнови только один блок занятия, не меняя его длительность и назначение.

Предмет: ${settings.subject}
Тема: ${settings.topic}
Уровень: ${settings.level}
Цель: ${settings.lessonGoal}
Блок: ${block.id} («${block.name}»), ${block.duration} минут.
Заметка преподавателя: ${block.teacherNote || "нет"}.
${quizRules}

Верни только валидный JSON без Markdown:
{
  "id": "${block.id}",
  "title": "Название блока",
  "duration": ${block.duration},
  "studentContent": "материал для студентов",
  "teacherNotes": "личные заметки преподавателю"
}

Для quiz используй поле questions вместо studentContent.`;
}

function parseGeminiJson(text) {
  const cleanText = text
    .trim()
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/^\`\`\`\s*/i, "")
    .replace(/\s*\`\`\`$/, "");

  return JSON.parse(cleanText);
}

async function requestGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("Не найден GEMINI_API_KEY в файле backend/.env.");
  }

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
          parts: [{ text: "Отвечай только валидным JSON без Markdown." }]
        },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    }
  );

  if (!response.ok) {
    const details = await response.text();
    console.error("Gemini API error:", response.status, details);
    throw new Error(`Gemini временно недоступен (код ${response.status}).`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");

  if (!text) {
    throw new Error("Gemini вернул пустой ответ.");
  }

  try {
    return parseGeminiJson(text);
  } catch {
    console.error("Invalid Gemini JSON:", text);
    throw new Error("Gemini вернул ответ в неверном формате. Попробуйте ещё раз.");
  }
}

function normalizeBlock(block, expectedBlock, quizSettings) {
  if (!block || block.id !== expectedBlock.id) {
    throw new Error("Gemini вернул некорректный блок занятия.");
  }

  const normalized = {
    id: expectedBlock.id,
    title: String(block.title || expectedBlock.name),
    duration: expectedBlock.duration,
    teacherNotes: String(block.teacherNotes || "")
  };

  if (expectedBlock.id === "quiz") {
    const questions = Array.isArray(block.questions) ? block.questions : [];

    if (questions.length !== quizSettings.questionCount) {
      throw new Error("Gemini вернул неполный мини-тест. Попробуйте обновить блок.");
    }

    normalized.questions = questions.map((question) => {
      const options = Array.isArray(question.options)
        ? question.options.map((option) => String(option))
        : [];

      if (
        !String(question.question || "").trim() ||
        options.length !== 4 ||
        !options.includes(String(question.correctAnswer || ""))
      ) {
        throw new Error("Gemini вернул тест в неверном формате. Попробуйте обновить блок.");
      }

      return {
        question: String(question.question),
        options,
        correctAnswer: String(question.correctAnswer)
      };
    });
  } else {
    const content = String(block.studentContent || block.content || "").trim();

    if (!content) {
      throw new Error("Gemini не создал материал для выбранного блока.");
    }

    normalized.studentContent = content;
  }

  return normalized;
}

app.post("/api/generate", async (req, res) => {
  try {
    const settings = getLessonSettings(req.body);
    const generated = await requestGemini(buildLessonPrompt(settings));
    const receivedBlocks = Array.isArray(generated.blocks) ? generated.blocks : [];

    const lesson = {
      blocks: settings.blocks.map((block) => {
        const generatedBlock = receivedBlocks.find((item) => item?.id === block.id);
        return normalizeBlock(generatedBlock, block, settings.quizSettings);
      })
    };

    return res.json({ lesson });
  } catch (error) {
    console.error(error);
    return res.status(error instanceof ValidationError ? 400 : 500)
      .json({ error: error.message || "Не удалось создать занятие." });
  }
});

app.post("/api/regenerate-block", async (req, res) => {
  try {
    const settings = getLessonSettings(req.body);
    const block = settings.blocks.find((item) => item.id === req.body.blockId);

    if (!block) {
      return res.status(400).json({ error: "Выбранный блок не найден в настройках занятия." });
    }

    const generated = await requestGemini(buildRegeneratePrompt(settings, block));
    const blockResult = normalizeBlock(generated, block, settings.quizSettings);

    return res.json({ block: blockResult });
  } catch (error) {
    console.error(error);
    return res.status(error instanceof ValidationError ? 400 : 500)
      .json({ error: error.message || "Не удалось обновить блок." });
  }
});

app.use(express.static(frontendDirectory));

app.listen(PORT, () => {
  console.log(`AI Teacher Assistant is running on http://localhost:${PORT}`);
});
