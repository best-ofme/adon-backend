import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import quizRoutes from './quiz-routes'; // ต้องมีไฟล์นี้ใน src/

// โหลดตัวแปรจากไฟล์ .env
dotenv.config();

// --- Firebase Initialization ---
// โหลด service account จาก environment variable

// ⚡️ START DIAGNOSTIC LOGGING ⚡️
console.log(`[FIREBASE DIAGNOSTIC] Checking for SERVICE_ACCOUNT_KEY...`);
const key = process.env.SERVICE_ACCOUNT_KEY;
console.log(`[FIREBASE DIAGNOSTIC] Key is present: ${!!key}`);
if (key) {
    console.log(`[FIREBASE DIAGNOSTIC] Key length: ${key.length}`);
    // แสดงเฉพาะส่วนเริ่มต้นของค่า เพื่อให้แน่ใจว่ามันถูกโหลดมาจริง (และไม่แสดงคีย์ทั้งหมดเพื่อความปลอดภัย)
    console.log(`[FIREBASE DIAGNOSTIC] Key starts with: ${key.substring(0, 50)}...`);
}
// ⚡️ END DIAGNOSTIC LOGGING ⚡️

if (!key) {
  // ข้อผิดพลาดนี้จะถูกแสดงเมื่อรันบน Render ถ้าไม่ได้ตั้งค่า Environment Variable
  console.error('FATAL ERROR: SERVICE_ACCOUNT_KEY environment variable not found. Please set it in .env (local) or Render Dashboard (production) as a single line JSON string.');
  process.exit(1);
}

let serviceAccount: any;
try {
  // พยายามแปลงสตริง JSON จาก Environment Variable ให้เป็น Object
  serviceAccount = JSON.parse(key);
} catch (e) {
  // ข้อผิดพลาดนี้จะถูกแสดงถ้า JSON string มีการจัดรูปแบบผิดพลาด
  console.error('FATAL ERROR: Failed to parse SERVICE_ACCOUNT_KEY. Ensure it is a single-line, valid JSON string.', e);
  process.exit(1);
}

// Initialize Firebase Admin SDK
try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (e) {
    console.error("FATAL ERROR: Firebase initialization failed. Check SERVICE_ACCOUNT_KEY content and format.", e);
    process.exit(1);
}
// --- End Firebase Initialization ---


const app = express();
// NOTE: เราจะสร้าง Prisma Client ที่นี่ แต่การใช้งานจริงจะอยู่ใน Routes
const prisma = new PrismaClient(); 

// Middleware
app.use(cors());
app.use(express.json());

// Middleware to verify JWT token
const verifyToken = (req: Request, res: Response, next: () => void) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    // ใช้ JWT_SECRET ที่ต้องตั้งค่าใน .env หรือ Render Env Var
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    (req as any).userId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Connect new quiz routes (เราต้องใช้ verifyToken ใน quiz routes ด้วย)
// **หมายเหตุ: ต้องมั่นใจว่าไฟล์ quiz-routes.ts ถูกสร้างแล้ว**
// เนื่องจากโค้ดใน index.ts อ้างอิงถึง quizRoutes
// app.use('/api/quiz', verifyToken, quizRoutes); 

// API for new user registration
app.post('/api/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Invalid email or password (min 6 characters)' });
    }

    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
    });

    const newUser = await prisma.user.create({
      data: {
        firebaseId: userRecord.uid,
        email: email,
      },
    });

    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error: any) {
    if (error.code === 'auth/email-already-in-use') {
      res.status(409).json({ error: 'Email is already in use' });
    } else {
      console.error('Error during registration:', error);
      res.status(500).json({ error: 'Something went wrong during user creation.' });
    }
  }
});

// API for user login
app.post('/api/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    // NOTE: In a real production app, use Firebase Client SDK to login and send ID Token to backend.
    // For now, we attempt to retrieve user from Firebase Admin.
    const userRecord = await admin.auth().getUserByEmail(email);

    // TODO: Password check must be implemented. Admin SDK cannot verify password directly.

    const user = await prisma.user.findUnique({
      where: { firebaseId: userRecord.uid },
    });

    if (!user) {
      return res.status(404).json({ error: 'User found in Firebase but not in database' });
    }

    // สร้าง JWT Token
    const token = jwt.sign({ id: userRecord.uid }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    
    res.status(200).json({ 
      message: 'Login successful', 
      token: token, 
      user: { 
        email: user.email,
        firebaseId: user.firebaseId
      }
    });
  } catch (error: any) {
    // Catch errors from admin.auth().getUserByEmail()
    if (error.code === 'auth/user-not-found') {
      res.status(401).json({ error: 'Invalid email or password' });
    } else {
      console.error('Error during login:', error);
      res.status(500).json({ error: 'Something went wrong during login verification.' });
    }
  }
});

// API for user logout (simply returns a success message)
app.post('/api/logout', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Logout successful' });
});

// Protected API route
app.get('/api/profile', verifyToken, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  try {
    const user = await prisma.user.findUnique({
      where: { firebaseId: userId },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({
      message: 'Welcome to your profile!',
      user: {
        email: user.email,
        firebaseId: user.firebaseId,
      }
    });
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Test API
app.get('/', (req: Request, res: Response) => {
  res.send('Ad On Eng Backend is running!');
});

// Set Port
const PORT = process.env.PORT || 4000;

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
