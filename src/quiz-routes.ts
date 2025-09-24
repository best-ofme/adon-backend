import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// API: สร้างข้อสอบใหม่ (ใช้สำหรับแอดมิน)
router.post('/create', async (req, res) => {
  try {
    const { subjectName, topicName, questions } = req.body;

    const subject = await prisma.subject.upsert({
      where: { name: subjectName },
      update: {},
      create: { name: subjectName }
    });

    const topic = await prisma.topic.upsert({
      where: { name: topicName },
      update: {},
      create: {
        name: topicName,
        subjectId: subject.id,
      },
    });

    const createdQuestions = await Promise.all(
      questions.map(async (q: any) => {
        return prisma.question.create({
          data: {
            text: q.text,
            topicId: topic.id,
            choices: {
              create: q.choices.map((c: any) => ({
                text: c.text,
                isCorrect: c.isCorrect,
              })),
            },
          },
        });
      })
    );

    res.status(201).json({ message: 'Quiz created successfully', questions: createdQuestions });
  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({ error: 'Failed to create quiz' });
  }
});

// API: ดึงข้อสอบสุ่ม (ตามหัวข้อ)
router.get('/random', async (req, res) => {
  try {
    const { topicName, count } = req.query;
    if (!topicName || !count) {
      return res.status(400).json({ error: 'Topic name and count are required' });
    }

    const topic = await prisma.topic.findUnique({ where: { name: topicName as string } });
    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const questions = await prisma.$queryRaw`
      SELECT id, text, "topicId"
      FROM "Question"
      WHERE "topicId" = ${topic.id}
      ORDER BY RANDOM()
      LIMIT ${Number(count)}
    `;

    const questionsWithChoices = await Promise.all(
      (questions as any[]).map(async (q) => {
        const choices = await prisma.choice.findMany({
          where: { questionId: q.id },
          select: { id: true, text: true },
        });
        return { ...q, choices };
      })
    );

    res.status(200).json({ questions: questionsWithChoices });
  } catch (error) {
    console.error('Error fetching random quiz:', error);
    res.status(500).json({ error: 'Failed to fetch quiz' });
  }
});

// API: บันทึกผลการทำข้อสอบ
router.post('/submit', async (req, res) => {
  try {
    const { userId, score } = req.body;
    
    await prisma.examAttempt.create({
      data: {
        score: score,
        userId: userId,
      }
    });

    res.status(200).json({ message: 'Exam results saved successfully' });
  } catch (error) {
    console.error('Error saving exam results:', error);
    res.status(500).json({ error: 'Failed to save results' });
  }
});

export default router;
