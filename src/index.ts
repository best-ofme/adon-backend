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
// โหลด service account จาก environment variable ที่แยกส่วนกัน
const privateKeyEnv = process.env.FIREBASE_PRIVATE_KEY;
const clientEmailEnv = process.env.FIREBASE_CLIENT_EMAIL;

// ⚡️ START DIAGNOSTIC LOGGING ⚡️
console.log(`[FIREBASE DIAGNOSTIC] Checking for separated keys...`);
console.log(`[FIREBASE DIAGNOSTIC] Private Key present: ${!!privateKeyEnv}`);
console.log(`[FIREBASE DIAGNOSTIC] Client Email present: ${!!clientEmailEnv}`);
// ⚡️ END DIAGNOSTIC LOGGING ⚡️

if (!privateKeyEnv || !clientEmailEnv) {
  console.error('FATAL ERROR: FIREBASE_PRIVATE_KEY and/or FIREBASE_CLIENT_EMAIL environment variables not found.');
  console.error('Please set these two variables in Render Dashboard using the format described.');
  process.exit(1);
}

let serviceAccount: any;
try {
  // 1. นำ Private Key มาแทนที่ escaped newlines (\\n) ด้วย literal newlines (\n)
  const correctedPrivateKey = privateKeyEnv.replace(/\\n/g, '\n');

  // 2. สร้าง Service Account Object ที่สมบูรณ์
  serviceAccount = {
    type: 'service_account',
    project_id: 'ad-on-54140', // Hardcode project ID
    client_email: clientEmailEnv,
    private_key: correctedPrivateKey,
  };

  console.log(`[FIREBASE DIAGNOSTIC] Successfully constructed serviceAccount object.`);
  console.log(`[FIREBASE DIAGNOSTIC] Using Client Email: ${serviceAccount.client_email}`);

} catch (e) {
  console.error('FATAL ERROR: Failed to construct service account object.', e);
  process.exit(1);
}

// Initialize Firebase Admin SDK
try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (e) {
    console.error("FATAL ERROR: Firebase initialization failed (Admin SDK). Check the project_id and keys.", e);
    process.exit(1);
}
// --- End Firebase Initialization ---


const app = express();
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

// Connect new quiz routes (ต้องมีไฟล์ quiz-routes.ts และแก้ไขโค้ดที่เรียกใช้)
// app.use('/api/quiz', verifyToken, quizRoutes); 

// API for new user registration
app.post('/api/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Invalid email or password (min 6 characters)' });
    }

    // 1. สร้างผู้ใช้ใน Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
    });

    // 2. สร้าง Record ผู้ใช้ใน PostgreSQL (Prisma)
    const newUser = await prisma.user.create({
      data: {
        firebaseId: userRecord.uid,
        email: email,
        // ไม่ต้องระบุ 'id' เพราะใช้ @default(uuid())
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
    
    // NOTE: For demo, we retrieve user from Firebase Admin. This doesn't verify the password.
    // In production, use Firebase Client SDK to login and send ID Token to backend.
    const userRecord = await admin.auth().getUserByEmail(email);

    // TODO: Password check must be implemented. Admin SDK cannot verify password directly.

    // 1. Check for user in PostgreSQL database (Prisma)
    let user = await prisma.user.findUnique({
      where: { firebaseId: userRecord.uid },
    });

    // 2. **DEFENSIVE FIX:** If user exists in Firebase but not in DB, create the DB entry now.
    // เนื่องจากคุณยืนยันแล้วว่าผู้ใช้มีใน Firebase ขั้นตอนนี้จะสร้าง Record ใน DB
    if (!user) {
      console.warn(`User ${userRecord.uid} found in Firebase but missing in DB. Creating entry now.`);
      user = await prisma.user.create({
        data: {
          firebaseId: userRecord.uid,
          email: userRecord.email || email, 
          // 🛑 แก้ไข: ลบ Field 'role' ออกเพื่อให้ตรงกับ schema.prisma
        },
      });
      console.log(`Successfully created DB entry for user: ${user.firebaseId}`);
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
      // NOTE: This error can also indicate wrong password since we can't verify it with Admin SDK here.
      res.status(401).json({ error: 'Invalid email or password' });
    } else {
      // ⚠️ การแก้ไข: แสดงรายละเอียด Error เพื่อดีบั๊ก
      console.error('Error during login (Defensive Create Failed):', error);
      res.status(500).json({ 
        error: 'Something went wrong during login verification. (Check debugDetails)',
        debugDetails: error.message || 'Check server logs for detailed Prisma error.'
      });
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
      // NOTE: This can happen if the token is valid but the user was manually deleted from DB.
      // We return 404 to prompt the user to log in again, which should trigger the defensive fix if necessary.
      return res.status(404).json({ error: 'User not found in database' }); 
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
