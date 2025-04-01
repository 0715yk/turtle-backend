// src/services/screeningService.ts
import axios from "axios";
import https from "https";
import {
  CoinInfo,
  CandleData,
  ScreeningResult,
  ScreeningType,
} from "../types/screener";
import { delay } from "../utils/common";
import {
  calculateHMA,
  isBullishCandle,
  isClosingAbovePreviousHigh,
  isHMACrossover,
} from "../utils/indicators";

export class ScreeningService {
  private progress: number = 0;

  resetProgress(): void {
    this.progress = 0;
  }

  getProgress(): number {
    return this.progress;
  }

  async getCoins(): Promise<CoinInfo[]> {
    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });

      const response = await axios.get(
        "https://api.upbit.com/v1/market/all?isDetails=false",
        { httpsAgent }
      );

      return response.data.filter((coin: CoinInfo) =>
        coin.market.startsWith("KRW-")
      );
    } catch (error) {
      console.error("Error fetching markets:", error);
      return [];
    }
  }

  async getCoinCandles(
    market: string,
    count: number = 30
  ): Promise<CandleData[]> {
    try {
      await delay(200); // API 제한 방지
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
      const response = await axios.get(
        `https://api.upbit.com/v1/candles/days?market=${market}&count=${count}`,
        { httpsAgent }
      );

      return response.data as CandleData[];
    } catch (error) {
      console.error(`Error fetching candles for ${market}:`, error);
      return [];
    }
  }

  async screenAllConditions(): Promise<ScreeningResult[]> {
    const coins = await this.getCoins();
    const results: ScreeningResult[] = [];

    this.resetProgress();
    const totalCoins = coins.length;

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      const candles = await this.getCoinCandles(coin.market, 30);

      if (candles.length < 22) {
        continue;
      }

      candles.sort(
        (a, b) =>
          new Date(b.candle_date_time_kst).getTime() -
          new Date(a.candle_date_time_kst).getTime()
      );

      const conditions: string[] = [];

      const isBullish = isBullishCandle(candles[1]);
      if (isBullish) conditions.push("전날 양봉");

      const isBreakout = isClosingAbovePreviousHigh(candles[1], candles[2]);
      if (isBreakout) conditions.push("전날 종가가 전전날 최고가보다 높음");

      const closePrices = candles.map((candle) => candle.trade_price).reverse();
      const hma20 = calculateHMA(closePrices, 20).reverse();

      const isHMACross = isHMACrossover(
        candles[1].trade_price,
        candles[0].trade_price,
        hma20[1],
        hma20[0]
      );
      if (isHMACross) conditions.push("20 HMA 돌파");

      const volumes = candles
        .map((candle) => candle.candle_acc_trade_volume)
        .reverse();
      const avgVolume =
        volumes.slice(0, 10).reduce((sum, vol) => sum + vol, 0) / 10;
      const isHighVolume = candles[0].candle_acc_trade_volume > avgVolume * 1.5;
      if (isHighVolume) conditions.push("거래량 증가");

      const hma5 = calculateHMA(closePrices, 5).reverse();
      const isUptrend = hma5[0] > hma5[1] && hma5[1] > hma5[2];
      if (isUptrend) conditions.push("단기 상승 추세");

      const breakoutStrength = isBreakout
        ? ((candles[1].trade_price - candles[2].high_price) /
            candles[2].high_price) *
          100
        : 0;
      const isStrongBreakout = breakoutStrength > 2.0;
      if (isStrongBreakout) conditions.push("강한 돌파(2% 이상)");

      const baseConditionsMet =
        [isBullish, isBreakout, isHMACross].filter(Boolean).length >= 2;
      const additionalConditionsMet =
        [isHighVolume, isUptrend, isStrongBreakout].filter(Boolean).length >= 1;

      if (baseConditionsMet && additionalConditionsMet) {
        results.push({
          coin,
          candles,
          conditions,
          currentPrice: candles[0].trade_price,
          metrics: {
            hma20: hma20[0],
            volumeRatio: isHighVolume
              ? candles[0].candle_acc_trade_volume / avgVolume
              : undefined,
          },
        });
      }

      this.progress = Math.floor(((i + 1) / totalCoins) * 100);
    }

    return results.sort((a, b) => b.conditions.length - a.conditions.length);
  }

  // 다른 스크리닝 메서드도 여기에 구현...
  // screenBullishBreakout, screenHMACrossover, screenPremiumHMA, screenPremiumBullishBreakout

  // 스크리닝 메서드 선택 함수
  async screen(type: ScreeningType): Promise<ScreeningResult[]> {
    switch (type) {
      case "all":
        return this.screenAllConditions();
      // 다른 타입들에 대한 처리 추가
      default:
        throw new Error(`Invalid screening type: ${type}`);
    }
  }
}

export const screeningService = new ScreeningService();
