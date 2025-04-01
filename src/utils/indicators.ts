// src/utils/indicators.ts
import { CandleData } from "../types/screener";

// WMA 계산 함수
export function calculateWMA(data: number[], period: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    let sum = 0;
    let weight = 0;

    for (let j = 0; j < period; j++) {
      const value = data[i - j];
      const currentWeight = period - j;
      sum += value * currentWeight;
      weight += currentWeight;
    }

    result.push(sum / weight);
  }

  return result;
}

// HMA 계산 함수
export function calculateHMA(data: number[], period: number): number[] {
  // WMA(2 * WMA(n/2) - WMA(n)), sqrt(n))
  const halfPeriod = Math.floor(period / 2);
  const sqrtPeriod = Math.floor(Math.sqrt(period));

  // WMA(n) 계산
  const wma = calculateWMA(data, period);

  // WMA(n/2) 계산
  const halfWma = calculateWMA(data, halfPeriod);

  // 2 * WMA(n/2) - WMA(n) 계산
  const rawHma = halfWma.map((value, index) => {
    if (isNaN(value) || isNaN(wma[index])) {
      return NaN;
    }
    return 2 * value - wma[index];
  });

  // 최종 HMA 계산: WMA(rawHma, sqrt(n))
  const hma = calculateWMA(rawHma, sqrtPeriod);

  return hma;
}

// RSI 계산 함수
export function calculateRSI(prices: number[], period: number): number[] {
  const rsi: number[] = [];
  let gains = 0;
  let losses = 0;

  // 첫 번째 평균 계산
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  // 첫 번째 평균 이득과 손실
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // RSI 계산
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    let currentGain = 0;
    let currentLoss = 0;

    if (change >= 0) {
      currentGain = change;
    } else {
      currentLoss = -change;
    }

    // 평균 이득과 손실 업데이트 (Wilder's smoothing method)
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    // 상대적 강도 계산
    const rs = avgGain / avgLoss;
    // RSI 계산
    const currentRsi = 100 - 100 / (1 + rs);
    rsi.push(currentRsi);
  }

  return rsi;
}

// 캔들이 양봉인지 확인
export function isBullishCandle(candle: CandleData): boolean {
  return candle.trade_price > candle.opening_price;
}

// 종가가 이전 고점보다 높은지 확인
export function isClosingAbovePreviousHigh(
  current: CandleData,
  previous: CandleData
): boolean {
  return current.trade_price > previous.high_price;
}

// HMA 돌파 확인
export function isHMACrossover(
  prevPrice: number,
  currentPrice: number,
  prevHMA: number,
  currentHMA: number
): boolean {
  return prevPrice < prevHMA && currentPrice > currentHMA;
}
