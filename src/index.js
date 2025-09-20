// index.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

// โหลดตัวแปรจากไฟล์ .env
dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json());

// ทดสอบ API
app.get('/', (req, res) => {
  res.send('Ad On Eng Backend is running!');
});

// กำหนด Port
const PORT = process.env.PORT || 4000;

// เริ่มเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
