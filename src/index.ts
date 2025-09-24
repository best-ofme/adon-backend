import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import quizRoutes from './quiz-routes';

// โหลดตัวแปรจากไฟล์ .env
dotenv.config();

// ตั้งค่า Firebase Admin
let serviceAccount;
try {
  serviceAccount = require('../serviceAccountKey.json');
} catch (e) {
  console.error('Error: Could not find serviceAccountKey.json. Please make sure the file is in the root directory of the backend project.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const prisma = new PrismaClient();

// Middleware ควรอยู่ด้านบนสุด
app.use(cors());
app.use(express.json());

// Middleware to verify JWT token for protected routes
const verifyToken = (req: Request, res: Response, next: () => void) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
    (req as any).userId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Connect new quiz routes
app.use('/api/quiz', quizRoutes);

// API for new user registration
app.post('/api/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

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
      res.status(500).json({ error: 'Something went wrong' });
    }
  }
});

// API for user login
app.post('/api/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    // In a real app, you would verify the password on the client side.
    const userRecord = await admin.auth().getUserByEmail(email);
    
    const user = await prisma.user.findUnique({
      where: { firebaseId: userRecord.uid },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found in database' });
    }

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
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      res.status(401).json({ error: 'Invalid email or password' });
    } else {
      console.error('Error during login:', error);
      res.status(500).json({ error: 'Something went wrong' });
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
