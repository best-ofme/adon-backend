"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
// โหลดตัวแปรจากไฟล์ .env
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
