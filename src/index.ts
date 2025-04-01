// src/index.ts
import express from "express";
import mysql from "mysql2/promise";
import crypto from "crypto";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MySQL 연결 풀 생성
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 거래 데이터 인터페이스
interface Transaction {
  id: string;
  transaction_time: Date;
  market: string;
  coin: string;
  type: string;
  quantity: number;
  price: number;
  total_amount: number;
  fee: number;
  net_amount: number;
  order_time: Date;
}

// 데이터베이스 테이블 생성
async function setupDatabase(): Promise<void> {
  try {
    const connection = await pool.getConnection();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(36) PRIMARY KEY,
        transaction_time DATETIME,
        market VARCHAR(20),
        coin VARCHAR(20),
        type VARCHAR(10),
        quantity DECIMAL(24,8),
        price DECIMAL(24,2),
        total_amount DECIMAL(24,2),
        fee DECIMAL(24,2),
        net_amount DECIMAL(24,2),
        order_time DATETIME
      )
    `);
    connection.release();
    console.log("데이터베이스 테이블 준비 완료");
  } catch (error) {
    console.error("데이터베이스 설정 오류:", error);
  }
}

// REST API 엔드포인트 - 거래 내역 조회
app.get("/api/transactions", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM transactions ORDER BY transaction_time DESC"
    );
    res.json(rows);
  } catch (error) {
    console.error("거래 내역 조회 오류:", error);
    res
      .status(500)
      .json({ error: "거래 내역을 가져오는 중 오류가 발생했습니다." });
  }
});

// 특정 코인 거래 내역 조회
app.get("/api/transactions/:coin", async (req, res) => {
  try {
    const coin = req.params.coin.toUpperCase();
    const [rows] = await pool.query(
      "SELECT * FROM transactions WHERE coin = ? ORDER BY transaction_time DESC",
      [coin]
    );
    res.json(rows);
  } catch (error) {
    console.error("거래 내역 조회 오류:", error);
    res
      .status(500)
      .json({ error: "거래 내역을 가져오는 중 오류가 발생했습니다." });
  }
});

// 거래 타입별 조회 (매수/매도)
app.get("/api/transactions/type/:type", async (req, res) => {
  try {
    const type = req.params.type === "buy" ? "매수" : "매도";
    const [rows] = await pool.query(
      "SELECT * FROM transactions WHERE type = ? ORDER BY transaction_time DESC",
      [type]
    );
    res.json(rows);
  } catch (error) {
    console.error("거래 내역 조회 오류:", error);
    res
      .status(500)
      .json({ error: "거래 내역을 가져오는 중 오류가 발생했습니다." });
  }
});

// 기간별 거래 내역 조회
app.get("/api/transactions/period/:start/:end", async (req, res) => {
  try {
    const startDate = req.params.start;
    const endDate = req.params.end;
    const [rows] = await pool.query(
      "SELECT * FROM transactions WHERE transaction_time BETWEEN ? AND ? ORDER BY transaction_time DESC",
      [startDate, endDate]
    );
    res.json(rows);
  } catch (error) {
    console.error("거래 내역 조회 오류:", error);
    res
      .status(500)
      .json({ error: "거래 내역을 가져오는 중 오류가 발생했습니다." });
  }
});

// 업비트 API 인증 헤더 생성
function generateAuthToken(): { Authorization: string } {
  const accessKey = process.env.UPBIT_ACCESS_KEY || "";
  const secretKey = process.env.UPBIT_SECRET_KEY || "";
  const payload = {
    access_key: accessKey,
    nonce: uuidv4(),
  };

  const token = crypto
    .createHmac("sha512", secretKey)
    .update(JSON.stringify(payload))
    .digest("hex");

  return {
    Authorization: `Bearer ${accessKey}.${token}.${payload.nonce}`,
  };
}

// 업비트에서 내 계정의 거래 내역 가져오기
async function fetchMyTransactions(): Promise<void> {
  try {
    const headers = generateAuthToken();

    // 주문 내역 조회 API 사용
    const response = await axios.get("https://api.upbit.com/v1/orders", {
      headers,
      params: {
        state: "done", // 체결된 주문만
        page: 1,
        limit: 100,
      },
    });

    const orders = response.data;
    console.log(`총 ${orders.length}개의 주문 내역을 가져왔습니다.`);

    for (const order of orders) {
      // 주문의 개별 체결 내역 조회
      const tradesResponse = await axios.get(
        `https://api.upbit.com/v1/order?uuid=${order.uuid}`,
        {
          headers,
        }
      );

      const orderDetail = tradesResponse.data;

      // 각 체결에 대해 데이터베이스에 저장
      if (orderDetail.trades && orderDetail.trades.length > 0) {
        for (const trade of orderDetail.trades) {
          const formattedTx: Transaction = {
            id: uuidv4(),
            transaction_time: new Date(trade.created_at),
            market: orderDetail.market.split("-")[0],
            coin: orderDetail.market.split("-")[1],
            type: orderDetail.side === "bid" ? "매수" : "매도",
            quantity: parseFloat(trade.volume),
            price: parseFloat(trade.price),
            total_amount: parseFloat(trade.funds),
            fee: parseFloat(trade.fee),
            net_amount: parseFloat(trade.funds) - parseFloat(trade.fee),
            order_time: new Date(orderDetail.created_at),
          };

          try {
            await pool.query(
              "INSERT IGNORE INTO transactions SET ?",
              formattedTx
            );
            console.log(
              `거래 내역 저장: ${formattedTx.coin} ${formattedTx.type} ${formattedTx.quantity}`
            );
          } catch (dbError) {
            console.error("거래 저장 오류:", dbError);
          }
        }
      }

      // API 호출 제한을 피하기 위한 지연
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`거래 내역 동기화 완료`);
  } catch (error: any) {
    console.error(
      "업비트 API 호출 오류:",
      error.response ? error.response.data : error.message
    );
  }
}

// 서버 시작
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  await setupDatabase();

  // 초기 데이터 로드
  await fetchMyTransactions();

  // 주기적으로 거래 내역 업데이트 (1분마다)
  setInterval(fetchMyTransactions, 1 * 60 * 1000);
});
