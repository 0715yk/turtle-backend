// src/types/screener.ts
export interface CoinInfo {
  market: string;
  korean_name: string;
  english_name: string;
}

export interface CandleData {
  market: string;
  candle_date_time_utc: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  timestamp: number;
  candle_acc_trade_price: number;
  candle_acc_trade_volume: number;
}

export interface ScreeningResult {
  coin: CoinInfo;
  candles: CandleData[];
  conditions: string[];
  currentPrice?: number;
  metrics?: {
    hma20?: number;
    volumeRatio?: number;
  };
}

export type ScreeningType =
  | "all"
  | "bullish_breakout"
  | "hma_crossover"
  | "premium_hma"
  | "premium_bullish";
