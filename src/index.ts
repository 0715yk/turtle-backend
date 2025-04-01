// src/index.ts
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { screeningService } from "./services/screeningService";
import { ScreeningType } from "./types/screener";

// 환경 변수 로드
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(express.json());

// 라우트
app.get("/", (req, res) => {
  res.send("코인 스크리닝 API가 실행 중입니다.");
});

// 진행률 확인 엔드포인트
app.get("/api/progress", (req, res) => {
  res.json({ progress: screeningService.getProgress() });
});

// 스크리닝 엔드포인트
app.get("/api/screen", async (req, res) => {
  try {
    const type = (req.query.type as ScreeningType) || "all";

    const results = await screeningService.screen(type);
    res.json(results);
  } catch (error: any) {
    console.error("스크리닝 오류:", error);
    res
      .status(500)
      .json({ error: error.message || "스크리닝 중 오류가 발생했습니다." });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
