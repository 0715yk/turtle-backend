// src/utils/common.ts
export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
