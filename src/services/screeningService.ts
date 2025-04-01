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

class ScreeningService {
  progress: number = 0;

  resetProgress() {
    this.progress = 0;
  }

  getProgress() {
    return this.progress;
  }

  async getCoins(): Promise<CoinInfo[]> {
    try {
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false, // 개발 환경에서만 사용하세요
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

  // 캔들 데이터 가져오기 함수
  async getCoinCandles(
    market: string,
    count: number = 30
  ): Promise<CandleData[]> {
    try {
      await delay(500); // 500ms 대기
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false, // 개발 환경에서만 사용하세요
      });
      const response = await axios.get(
        `https://api.upbit.com/v1/candles/days?market=${market}&count=${count}`,
        { httpsAgent }
      );

      return response.data as CandleData[];
    } catch (error) {
      console.error("Error fetching candles:", error);
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

      // 캔들 데이터가 충분하지 않으면 스킵
      if (candles.length < 22) {
        continue;
      }

      // 데이터 정렬 (최신 데이터가 앞에 오도록)
      candles.sort(
        (a, b) =>
          new Date(b.candle_date_time_kst).getTime() -
          new Date(a.candle_date_time_kst).getTime()
      );

      const conditions: string[] = [];

      // --- 기본 조건들 확인 ---

      // 조건 1: 전날이 양봉인지 확인
      const isBullish = isBullishCandle(candles[1]);
      if (isBullish) conditions.push("전날 양봉");

      // 조건 2: 전날 종가가 전전날 최고가보다 높은지 확인
      const isBreakout = isClosingAbovePreviousHigh(candles[1], candles[2]);
      if (isBreakout) conditions.push("전날 종가가 전전날 최고가보다 높음");

      // 조건 3: 20 HMA 돌파 확인
      const closePrices = candles.map((candle) => candle.trade_price).reverse();
      const hma20 = calculateHMA(closePrices, 20).reverse();

      const isHMACross = isHMACrossover(
        candles[1].trade_price,
        candles[0].trade_price,
        hma20[1],
        hma20[0]
      );
      if (isHMACross) conditions.push("20 HMA 돌파");

      // --- 추가 필터 조건 확인 ---

      // 추가 조건 1: 거래량 증가 확인
      const volumes = candles
        .map((candle) => candle.candle_acc_trade_volume)
        .reverse();
      const avgVolume =
        volumes.slice(0, 10).reduce((sum, vol) => sum + vol, 0) / 10;
      const isHighVolume = candles[0].candle_acc_trade_volume > avgVolume * 1.5;
      if (isHighVolume) conditions.push("거래량 증가");

      // 추가 조건 2: 단기 추세 확인
      const hma5 = calculateHMA(closePrices, 5).reverse();
      const isUptrend = hma5[0] > hma5[1] && hma5[1] > hma5[2];
      if (isUptrend) conditions.push("단기 상승 추세");

      // 추가 조건 3: 돌파 강도 확인
      const breakoutStrength = isBreakout
        ? ((candles[1].trade_price - candles[2].high_price) /
            candles[2].high_price) *
          100
        : 0;
      const isStrongBreakout = breakoutStrength > 2.0;
      if (isStrongBreakout) conditions.push("강한 돌파(2% 이상)");

      // 기본 조건 중 적어도 2개를 만족하고, 추가 조건 중 적어도 1개를 만족하는 경우
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

      // 진행률 업데이트
      this.progress = Math.floor(((i + 1) / totalCoins) * 100);
    }

    // 조건이 많은 순으로 정렬
    return results.sort((a, b) => b.conditions.length - a.conditions.length);
  }

  // 강세 돌파 스크리닝 (전날기준 : 양봉 + 이전날 최고점 고점 돌파 여부)
  async screenBullishBreakout(): Promise<ScreeningResult[]> {
    const coins = await this.getCoins();
    const results: ScreeningResult[] = [];

    this.resetProgress();
    const totalCoins = coins.length;

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      const candles = await this.getCoinCandles(coin.market, 30);

      // 캔들 데이터가 충분하지 않으면 스킵
      if (candles.length < 3) {
        continue;
      }

      // 데이터 정렬 (최신 데이터가 앞에 오도록)
      candles.sort(
        (a, b) =>
          new Date(b.candle_date_time_kst).getTime() -
          new Date(a.candle_date_time_kst).getTime()
      );

      const conditions: string[] = [];

      // 조건 1: 전날이 양봉인지 확인
      const isBullish = isBullishCandle(candles[1]);

      // 조건 2: 전날 종가가 전전날 최고가보다 높은지 확인
      const isBreakout = isClosingAbovePreviousHigh(candles[1], candles[2]);

      // 두 조건을 모두 만족하는지 확인
      if (isBullish && isBreakout) {
        if (isBullish) conditions.push("전날 양봉");
        if (isBreakout) conditions.push("전날 종가가 전전날 최고가보다 높음");

        results.push({
          coin,
          candles,
          conditions,
        });
      }

      // 진행률 업데이트
      this.progress = Math.floor(((i + 1) / totalCoins) * 100);
    }

    return results;
  }

  // HMA 돌파 스크리닝
  async screenHMACrossover(): Promise<ScreeningResult[]> {
    const coins = await this.getCoins();
    const results: ScreeningResult[] = [];

    this.resetProgress();
    const totalCoins = coins.length;

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      const candles = await this.getCoinCandles(coin.market, 30);

      // 캔들 데이터가 충분하지 않으면 스킵
      if (candles.length < 22) {
        continue;
      }

      // 데이터 정렬 (최신 데이터가 앞에 오도록)
      candles.sort(
        (a, b) =>
          new Date(b.candle_date_time_kst).getTime() -
          new Date(a.candle_date_time_kst).getTime()
      );

      const conditions: string[] = [];

      // 20 HMA 돌파 확인
      const closePrices = candles.map((candle) => candle.trade_price).reverse();
      const hma20 = calculateHMA(closePrices, 20).reverse();

      const isHMACross = isHMACrossover(
        candles[1].trade_price,
        candles[0].trade_price,
        hma20[1],
        hma20[0]
      );

      // HMA 돌파 조건을 만족하는지 확인
      if (isHMACross) {
        conditions.push("20 HMA 돌파");

        results.push({
          coin,
          candles,
          conditions,
        });
      }

      // 진행률 업데이트
      this.progress = Math.floor(((i + 1) / totalCoins) * 100);
    }

    return results;
  }

  async screenPremiumHMA(): Promise<ScreeningResult[]> {
    const coins = await this.getCoins();
    const results: ScreeningResult[] = [];

    this.resetProgress();
    const totalCoins = coins.length;

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      // API 제한 방지를 위한 지연
      await new Promise((resolve) => setTimeout(resolve, 100));

      const candles = await this.getCoinCandles(coin.market, 30);

      // 캔들 데이터가 충분하지 않으면 스킵
      if (candles.length < 22) {
        continue;
      }

      // 데이터 정렬 (최신 데이터가 앞에 오도록)
      candles.sort(
        (a, b) =>
          new Date(b.candle_date_time_kst).getTime() -
          new Date(a.candle_date_time_kst).getTime()
      );

      const conditions: string[] = [];

      // 20 HMA 돌파 확인
      const closePrices = candles.map((candle) => candle.trade_price).reverse();
      const hma20 = calculateHMA(closePrices, 20).reverse();

      const isHMACross = isHMACrossover(
        candles[1].trade_price,
        candles[0].trade_price,
        hma20[1],
        hma20[0]
      );

      // HMA 돌파 조건을 만족하는지 확인
      if (isHMACross) {
        conditions.push("20 HMA 돌파");

        // 거래량 데이터 확인 (추가 필터)
        const volumes = candles
          .map((candle) => candle.candle_acc_trade_volume)
          .reverse();
        const avgVolume =
          volumes.slice(0, 10).reduce((sum, vol) => sum + vol, 0) / 10;
        const isHighVolume =
          candles[0].candle_acc_trade_volume > avgVolume * 1.5;

        if (isHighVolume) {
          conditions.push("거래량 증가");
        }

        // 단기 추세 확인: 5일 HMA 계산
        const hma5 = calculateHMA(closePrices, 5).reverse();
        const isUptrend = hma5[0] > hma5[1] && hma5[1] > hma5[2];

        if (isUptrend) {
          conditions.push("단기 상승 추세");
        }

        // 프리미엄 HMA 조건: 세 가지 모두 충족해야 함
        if (conditions.length === 3) {
          // 현재 가격 및 리스크:리워드 계산
          const currentPrice = candles[0].trade_price;

          results.push({
            coin,
            candles,
            conditions,
            currentPrice,
            metrics: {
              hma20: hma20[0],
              volumeRatio: candles[0].candle_acc_trade_volume / avgVolume,
            },
          });
        }
      }

      // 진행률 업데이트
      this.progress = Math.floor(((i + 1) / totalCoins) * 100);
    }

    return results;
  }

  async screenPremiumBullishBreakout(): Promise<ScreeningResult[]> {
    const coins = await this.getCoins();
    const results: ScreeningResult[] = [];

    this.resetProgress();
    const totalCoins = coins.length;

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      // API 제한 방지를 위한 지연
      await new Promise((resolve) => setTimeout(resolve, 100));

      const candles = await this.getCoinCandles(coin.market, 30);

      // 캔들 데이터가 충분하지 않으면 스킵
      if (candles.length < 5) {
        continue;
      }

      // 데이터 정렬 (최신 데이터가 앞에 오도록)
      candles.sort(
        (a, b) =>
          new Date(b.candle_date_time_kst).getTime() -
          new Date(a.candle_date_time_kst).getTime()
      );

      const conditions: string[] = [];

      // 기본 조건: 전날이 양봉인지 확인
      const isBullish = isBullishCandle(candles[1]);

      // 기본 조건: 전날 종가가 전전날 최고가보다 높은지 확인
      const isBreakout = isClosingAbovePreviousHigh(candles[1], candles[2]);

      // 추가 조건 1: 거래량 증가 확인
      const volumes = candles.map((candle) => candle.candle_acc_trade_volume);
      const avgVolume = (volumes[2] + volumes[3] + volumes[4]) / 3; // 3일 평균 거래량
      const isVolumeIncreased = volumes[1] > avgVolume * 1.5; // 평균 대비 150% 이상

      // 추가 조건 2: 돌파 강도 확인 (전날 종가가 전전날 최고가 대비 얼마나 높은지)
      const breakoutStrength =
        ((candles[1].trade_price - candles[2].high_price) /
          candles[2].high_price) *
        100;
      const isStrongBreakout = breakoutStrength > 2.0; // 2% 이상 돌파

      // 모든 조건 확인
      if (isBullish) conditions.push("전날 양봉");
      if (isBreakout) conditions.push("전날 종가가 전전날 최고가보다 높음");
      if (isVolumeIncreased) conditions.push("거래량 증가");
      if (isStrongBreakout) conditions.push("강한 돌파(2% 이상)");

      // 기본 조건(양봉+돌파)을 만족하고, 추가 조건 중 하나 이상 만족하는 경우
      if (isBullish && isBreakout && (isVolumeIncreased || isStrongBreakout)) {
        results.push({
          coin,
          candles,
          conditions,
        });
      }

      // 진행률 업데이트
      this.progress = Math.floor(((i + 1) / totalCoins) * 100);
    }

    return results;
  }

  // 스크리닝 타입에 따라 적절한 함수 호출
  async screen(type: ScreeningType): Promise<ScreeningResult[]> {
    switch (type) {
      case "all":
        return this.screenAllConditions();
      case "bullish_breakout":
        return this.screenBullishBreakout();
      case "hma_crossover":
        return this.screenHMACrossover();
      case "premium_hma":
        return this.screenPremiumHMA();
      case "premium_bullish":
        return this.screenPremiumBullishBreakout();
      default:
        throw new Error(`Invalid screening type: ${type}`);
    }
  }
}

export const screeningService = new ScreeningService();
