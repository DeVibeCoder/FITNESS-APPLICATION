import { onRequestPost as __api_food_scan_ts_onRequestPost } from "D:\\PROJECTS\\FITNESS\\functions\\api\\food-scan.ts"
import { onRequest as __api_food_scan_ts_onRequest } from "D:\\PROJECTS\\FITNESS\\functions\\api\\food-scan.ts"

export const routes = [
    {
      routePath: "/api/food-scan",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_food_scan_ts_onRequestPost],
    },
  {
      routePath: "/api/food-scan",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_food_scan_ts_onRequest],
    },
  ]