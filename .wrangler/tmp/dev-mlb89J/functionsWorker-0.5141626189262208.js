var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/pages-JjqBaD/functionsWorker-0.5141626189262208.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var TRANSIENT_CODES = [
  "timeout",
  "rate_limited",
  "provider_failed",
  // A model that returned unparseable JSON may well produce valid JSON on a
  // second generation, so this is worth one more go.
  "unreadable_response"
];
var ScanFailure = class extends Error {
  static {
    __name(this, "ScanFailure");
  }
  static {
    __name2(this, "ScanFailure");
  }
  code;
  transient;
  constructor(code, message, transient) {
    super(message);
    this.name = "ScanFailure";
    this.code = code;
    this.transient = transient ?? TRANSIENT_CODES.includes(code);
  }
};
function confidenceLevel(value) {
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}
__name(confidenceLevel, "confidenceLevel");
__name2(confidenceLevel, "confidenceLevel");
var UNITS = ["g", "ml", "piece", "slice", "cup", "tbsp", "serving"];
function asString(value, max = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}
__name(asString, "asString");
__name2(asString, "asString");
function asNumber(value, min, max) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, min), max);
}
__name(asNumber, "asNumber");
__name2(asNumber, "asNumber");
function asUnit(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const direct = UNITS.find((unit) => unit === raw);
  if (direct) return direct;
  if (["gram", "grams", "gr"].includes(raw)) return "g";
  if (["millilitre", "milliliter", "millilitres", "milliliters"].includes(raw)) return "ml";
  if (["pieces", "pcs", "item", "items", "whole"].includes(raw)) return "piece";
  if (["slices"].includes(raw)) return "slice";
  if (["cups"].includes(raw)) return "cup";
  if (["tablespoon", "tablespoons", "tbs"].includes(raw)) return "tbsp";
  return "serving";
}
__name(asUnit, "asUnit");
__name2(asUnit, "asUnit");
function stripFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}
__name(stripFence, "stripFence");
__name2(stripFence, "stripFence");
function parseVisionJson(text) {
  try {
    return JSON.parse(stripFence(text));
  } catch {
    throw new ScanFailure("unreadable_response", "The analysis came back in a form we could not read.");
  }
}
__name(parseVisionJson, "parseVisionJson");
__name2(parseVisionJson, "parseVisionJson");
function validateVisionResult(raw) {
  if (typeof raw !== "object" || raw === null) {
    throw new ScanFailure("unreadable_response", "The analysis came back empty.");
  }
  const source = raw;
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = [];
  for (const entry of rawItems) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry;
    const name = asString(item.name);
    if (!name) continue;
    const quantity = asNumber(item.estimatedQuantity ?? item.quantity, 0.1, 5e3);
    const confidence = asNumber(item.confidence, 0, 1);
    items.push({
      name,
      foodType: asString(item.likelyFoodType ?? item.foodType) ?? name,
      quantity: quantity ?? 100,
      unit: asUnit(item.unit),
      confidence: confidence ?? 0.4,
      alternatives: Array.isArray(item.alternatives) ? item.alternatives.map((alternative) => asString(alternative)).filter((alternative) => alternative !== null).slice(0, 4) : [],
      cookingMethod: asString(item.cookingMethod) ?? void 0,
      estimatedKcal: asNumber(item.estimatedKcal, 0, 5e3) ?? void 0,
      estimatedProteinG: asNumber(item.estimatedProteinG, 0, 500) ?? void 0,
      estimatedCarbsG: asNumber(item.estimatedCarbsG, 0, 500) ?? void 0,
      estimatedFatG: asNumber(item.estimatedFatG, 0, 500) ?? void 0
    });
    if (items.length >= 12) break;
  }
  if (items.length === 0) {
    throw new ScanFailure(
      "no_food_found",
      "We could not make out any food in that photo."
    );
  }
  const overall = asNumber(source.overallConfidence, 0, 1) ?? items.reduce((sum, item) => sum + item.confidence, 0) / items.length;
  return {
    items,
    mealDescription: asString(source.mealDescription, 200) ?? "Meal",
    overallConfidence: overall,
    // Trust the model's own flag, but insist on confirmation whenever the
    // reading is weak regardless of what it claimed.
    needsUserConfirmation: source.needsUserConfirmation === true || overall < 0.75 || items.some((item) => item.confidence < 0.6)
  };
}
__name(validateVisionResult, "validateVisionResult");
__name2(validateVisionResult, "validateVisionResult");
var endpointFor = /* @__PURE__ */ __name2((model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, "endpointFor");
var SYSTEM_PROMPT = `You identify food in a photograph for a nutrition log. This is a careful classification task, not a creative one.

Rules, in order of importance:
1. Look at THIS photograph and report only food you can actually see in it.
2. Never output a food you cannot see. Do not produce a typical, example or remembered meal. You have no memory of previous images \u2014 every photograph is judged only on its own contents. If the image shows steak, you must not report oats.
3. If the image contains no food at all, return an empty items array. An empty answer is correct and useful; a fabricated one is not.
4. List each distinct food separately. A plate of steak, rice and salad is three items, not one "mixed meal".
5. Portion size cannot be measured from a photograph. Estimate from visual cues such as plate and utensil size. Approximation is expected; false precision is not. Never imply you have weighed anything.
6. Do not force a match. If you are unsure what a food is, give your best reading, lower the confidence accordingly, and list other plausible readings in "alternatives". Declared uncertainty is far more useful than a confident wrong answer.
7. State cookingMethod only when it is visible or clearly implied (grill marks, batter, oil sheen). Otherwise omit it \u2014 do not infer hidden preparation as fact.
8. Do not estimate hidden oil, butter, sauce or dressing as a separate quantity unless it is plainly visible. The user adds those.
9. Be consistent: the same photograph should produce the same reading every time.
10. Also give typical nutrition for the portion you estimated: estimatedKcal, estimatedProteinG, estimatedCarbsG, estimatedFatG. These are a fallback for when our nutrition database has no good match, so use ordinary published values for that food and portion. Plain meat has no carbohydrate; plain rice has little fat. Do not return zeroes unless the food genuinely contains none.

confidence is 0 to 1 and should reflect genuine visual certainty. Set needsUserConfirmation to true whenever any item is below 0.6, or the scene is cluttered, dark, blurry or ambiguous.`;
var RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          likelyFoodType: { type: "string" },
          estimatedQuantity: { type: "number" },
          unit: { type: "string", enum: ["g", "ml", "piece", "slice", "cup", "tbsp", "serving"] },
          confidence: { type: "number" },
          cookingMethod: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
          estimatedKcal: { type: "number" },
          estimatedProteinG: { type: "number" },
          estimatedCarbsG: { type: "number" },
          estimatedFatG: { type: "number" }
        },
        required: ["name", "estimatedQuantity", "unit", "confidence"]
      }
    },
    mealDescription: { type: "string" },
    overallConfidence: { type: "number" },
    needsUserConfirmation: { type: "boolean" }
  },
  required: ["items", "overallConfidence", "needsUserConfirmation"]
};
function extractText(payload) {
  if (payload.promptFeedback?.blockReason) {
    throw new ScanFailure("invalid_image", "That photo could not be analysed.");
  }
  const candidate = payload.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => part.text).filter((part) => typeof part === "string" && part.trim().length > 0).join("");
  if (!text) {
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new ScanFailure("unreadable_response", "The analysis did not finish.");
    }
    throw new ScanFailure("unreadable_response", "The analysis came back empty.");
  }
  return text;
}
__name(extractText, "extractText");
__name2(extractText, "extractText");
var GeminiFoodVisionProvider = class {
  static {
    __name(this, "GeminiFoodVisionProvider");
  }
  static {
    __name2(this, "GeminiFoodVisionProvider");
  }
  name = "gemini";
  apiKey;
  model;
  timeoutMs;
  /*
   * The model is passed in rather than read from process.env here. Cloudflare
   * Workers have no `process` global, and a provider that reaches for one
   * cannot run there — `resolveProviders` already holds the environment and is
   * the right place to make that decision.
   */
  constructor(apiKey, model = "gemini-3.6-flash", timeoutMs = 3e4) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }
  async identify(image, signal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs ?? this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetch(endpointFor(this.model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        signal: combined,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: SYSTEM_PROMPT },
                {
                  text: "Identify the food visible in this photograph and estimate the portions."
                },
                { inline_data: { mime_type: image.mimeType, data: image.base64 } }
              ]
            }
          ],
          generationConfig: {
            response_mime_type: "application/json",
            response_schema: RESPONSE_SCHEMA,
            // Identification is extraction, not writing. Near-zero temperature
            // keeps the same photograph returning the same reading.
            temperature: 0.1,
            topP: 0.95
          }
        })
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ScanFailure("timeout", "The analysis took too long.");
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ScanFailure("timeout", "The analysis was cancelled.", false);
      }
      throw new ScanFailure("provider_failed", "Could not reach the analysis service.");
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
      }
      if (response.status === 401 || response.status === 403) {
        throw new ScanFailure("unauthorized", "The analysis service rejected our credentials.");
      }
      if (response.status === 429 || response.status === 408) {
        throw new ScanFailure("rate_limited", "The analysis service is busy.");
      }
      if (response.status >= 500) {
        throw new ScanFailure("provider_failed", "The analysis service is unavailable.");
      }
      if (response.status === 404) {
        throw new ScanFailure("not_configured", "The configured vision model was not found.");
      }
      if (response.status === 400) {
        if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED/i.test(detail)) {
          throw new ScanFailure("unauthorized", "The analysis service rejected our credentials.");
        }
        if (/model|not found|NOT_FOUND/i.test(detail)) {
          throw new ScanFailure("not_configured", "The configured vision model is unavailable.");
        }
        throw new ScanFailure("invalid_image", "That photo could not be analysed.");
      }
      throw new ScanFailure("provider_failed", "The analysis service is unavailable.");
    }
    const payload = await response.json();
    return validateVisionResult(parseVisionJson(extractText(payload)));
  }
};
var COOKING_METHODS = [
  "grilled",
  "fried",
  "boiled",
  "baked",
  "roasted",
  "steamed",
  "poached",
  "raw",
  "cooked",
  "smoked",
  "braised",
  "broiled",
  "seared"
];
var COMPOSITE_MARKERS = [
  // Other dishes that merely contain the food.
  "sandwich",
  "burger",
  "soup",
  "stew",
  "casserole",
  "pizza",
  "pie",
  "wrap",
  "taco",
  "burrito",
  "roll",
  "sub",
  "melt",
  "curry",
  "lasagna",
  "nugget",
  "patty",
  "breaded",
  "battered",
  "country fried",
  "salad",
  "dinner",
  "entree",
  "baby food",
  "infant",
  "formula",
  // Ingredient and commercial forms rather than the food on a plate. Rice
  // flour is 359 kcal per 100g against about 130 for cooked rice, so matching
  // one for the other is not a rounding error.
  "flour",
  "powder",
  "dehydrated",
  "uncooked",
  "frozen",
  "mixture",
  "concentrate",
  "canned",
  "dry mix",
  "instant"
];
function tokenize(text) {
  return text.toLowerCase().split(/[^a-z]+/).filter((token) => token.length > 2);
}
__name(tokenize, "tokenize");
__name2(tokenize, "tokenize");
function looksBranded(description) {
  const withoutAbbreviations = description.replace(/\b(NFS|NS|USDA|SR)\b/g, "");
  return /\b[A-Z]{4,}\b/.test(withoutAbbreviations) || /\b[A-Z]{2,}\s+[A-Z]{2,}\b/.test(withoutAbbreviations);
}
__name(looksBranded, "looksBranded");
__name2(looksBranded, "looksBranded");
function isPlausible(per100) {
  const { kcal, proteinG, carbsG, fatG } = per100;
  if (kcal < 15 || kcal > 900) return false;
  if (proteinG < 0 || carbsG < 0 || fatG < 0) return false;
  if (proteinG > 100 || carbsG > 100 || fatG > 100) return false;
  const fromMacros = proteinG * 4 + carbsG * 4 + fatG * 9;
  if (fromMacros === 0) return false;
  const drift = Math.abs(fromMacros - kcal) / kcal;
  return drift <= 0.5;
}
__name(isPlausible, "isPlausible");
__name2(isPlausible, "isPlausible");
var MIN_SCORE = 0.45;
function scoreMatch(candidate, query) {
  const description = candidate.description?.trim();
  if (!description) return 0;
  const lower = description.toLowerCase();
  const queryTokens = tokenize(query);
  const coreTerms = queryTokens.filter((token) => !COOKING_METHODS.includes(token));
  if (coreTerms.length === 0) return 0;
  if (!coreTerms.every((term) => lower.includes(term))) return 0;
  const lowerQuery = query.toLowerCase();
  for (const marker of COMPOSITE_MARKERS) {
    if (lower.includes(marker) && !lowerQuery.includes(marker)) return 0;
  }
  for (const joiner of [" and ", " with ", " plus ", " in "]) {
    if (lower.includes(joiner) && !lowerQuery.includes(joiner)) return 0;
  }
  if (!isPlausible(candidate.per100)) return 0;
  let score = 1;
  const rowMethods = COOKING_METHODS.filter((method2) => lower.includes(method2));
  const askedMethod = queryTokens.find((token) => COOKING_METHODS.includes(token));
  if (!askedMethod && rowMethods.some((method2) => method2 !== "raw")) {
    score -= 0.2;
  } else if (askedMethod && rowMethods.length > 0 && !rowMethods.includes(askedMethod)) {
    score -= 0.25;
  }
  const extra = tokenize(lower).filter((token) => !queryTokens.includes(token));
  score -= Math.min(0.45, extra.length * 0.07);
  if (/\bnfs\b/i.test(lower)) score += 0.12;
  if (looksBranded(description)) score -= 0.25;
  const method = queryTokens.find((token) => COOKING_METHODS.includes(token));
  if (method && lower.includes(method)) score += 0.08;
  if (candidate.dataType === "Foundation" || candidate.dataType === "SR Legacy") score += 0.1;
  else if (candidate.dataType === "Survey (FNDDS)") score += 0.12;
  return Math.max(0, score);
}
__name(scoreMatch, "scoreMatch");
__name2(scoreMatch, "scoreMatch");
function pickBest(candidates, query) {
  let best = null;
  for (const candidate of candidates) {
    const score = scoreMatch(candidate, query);
    if (score >= MIN_SCORE && (best === null || score > best.score)) {
      best = { candidate, score };
    }
  }
  return best;
}
__name(pickBest, "pickBest");
__name2(pickBest, "pickBest");
var SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
var NUTRIENTS = {
  kcal: { ids: [1008, 2047, 2048], match: /^energy/i, unit: /kcal/i },
  proteinG: { ids: [1003], match: /^protein/i, unit: /g/i },
  fatG: { ids: [1004], match: /total lipid|^fat/i, unit: /g/i },
  carbsG: { ids: [1005], match: /carbohydrate/i, unit: /g/i }
};
var GRAMS_PER_UNIT = {
  g: 1,
  ml: 1,
  // Close enough for water-like foods; the user can adjust.
  piece: 120,
  slice: 30,
  cup: 240,
  tbsp: 15,
  serving: 150
};
function normalizeFoodName(name) {
  const trimmed = name.trim().split(/\s+/).join(" ");
  const words = trimmed.split(" ");
  if (words.length < 2) return trimmed;
  const last = words[words.length - 1].toLowerCase();
  if (COOKING_METHODS.includes(last)) {
    return [last, ...words.slice(0, -1)].join(" ");
  }
  return trimmed;
}
__name(normalizeFoodName, "normalizeFoodName");
__name2(normalizeFoodName, "normalizeFoodName");
function readNutrient(nutrients, spec) {
  for (const entry of nutrients) {
    const id = entry.nutrientId ?? entry.nutrient?.id;
    const name = entry.nutrientName ?? entry.nutrient?.name ?? "";
    const unit = entry.unitName ?? entry.nutrient?.unitName ?? "";
    const value = entry.value ?? entry.amount;
    if (typeof value !== "number") continue;
    const idMatches = typeof id === "number" && spec.ids.includes(id);
    const nameMatches = spec.match.test(name) && spec.unit.test(unit);
    if (idMatches || nameMatches) return value;
  }
  return 0;
}
__name(readNutrient, "readNutrient");
__name2(readNutrient, "readNutrient");
var FoodDataCentralNutritionProvider = class {
  static {
    __name(this, "FoodDataCentralNutritionProvider");
  }
  static {
    __name2(this, "FoodDataCentralNutritionProvider");
  }
  name = "usda-fdc";
  apiKey;
  timeoutMs;
  constructor(apiKey, timeoutMs = 12e3) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }
  /**
   * Searches, retrying its own transient failures.
   *
   * FoodData Central sits behind a gateway that intermittently answers a
   * perfectly valid request with an nginx `400 Bad Request` HTML page —
   * measured at roughly one in six identical calls. Treating that as a client
   * error is what left foods showing 0 kcal, so a non-JSON body is retried
   * rather than believed.
   */
  async search(query, signal) {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      query,
      pageSize: "15",
      dataType: "Foundation,SR Legacy,Survey (FNDDS)"
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) return [];
      try {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetch(`${SEARCH_URL}?${params}`, { signal: combined });
        const contentType = response.headers.get("content-type") ?? "";
        if (response.ok && contentType.includes("json")) {
          const payload = await response.json();
          return payload.foods ?? [];
        }
        if (response.status < 500 && response.status !== 429 && contentType.includes("json")) {
          return [];
        }
      } catch {
        if (signal?.aborted) return [];
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt + Math.random() * 300));
      }
    }
    return [];
  }
  async lookup(query, signal) {
    const search = normalizeFoodName([query.cookingMethod, query.name].filter(Boolean).join(" "));
    const foods = await this.search(search, signal);
    if (foods.length === 0) return null;
    const candidates = foods.map((food) => {
      const nutrients = food.foodNutrients ?? [];
      return {
        description: food.description ?? "",
        dataType: food.dataType,
        per100: {
          kcal: readNutrient(nutrients, NUTRIENTS.kcal),
          proteinG: readNutrient(nutrients, NUTRIENTS.proteinG),
          carbsG: readNutrient(nutrients, NUTRIENTS.carbsG),
          fatG: readNutrient(nutrients, NUTRIENTS.fatG)
        }
      };
    });
    const best = pickBest(candidates, search);
    if (!best) return null;
    const grams = query.quantity * (GRAMS_PER_UNIT[query.unit] ?? 100);
    const factor = grams / 100;
    const { per100 } = best.candidate;
    const unitPenalty = query.unit === "g" || query.unit === "ml" ? 0 : 0.2;
    return {
      kcal: Math.round(per100.kcal * factor),
      proteinG: Math.round(per100.proteinG * factor),
      carbsG: Math.round(per100.carbsG * factor),
      fatG: Math.round(per100.fatG * factor),
      matchedName: best.candidate.description,
      source: "USDA FoodData Central",
      matchConfidence: Math.max(0, Math.min(1, best.score) - unitPenalty)
    };
  }
};
var DevMockVisionProvider = class {
  static {
    __name(this, "DevMockVisionProvider");
  }
  static {
    __name2(this, "DevMockVisionProvider");
  }
  name = "dev-mock";
  async identify() {
    return {
      items: [
        {
          name: "DEV MOCK \u2014 not your photo",
          foodType: "placeholder",
          quantity: 100,
          unit: "g",
          confidence: 0.1,
          alternatives: []
        }
      ],
      mealDescription: "Development mock. No image was analysed.",
      overallConfidence: 0.1,
      needsUserConfirmation: true
    };
  }
};
function jitter(ms) {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}
__name(jitter, "jitter");
__name2(jitter, "jitter");
function delayFor(attempt, baseDelayMs = 1e3) {
  return jitter(baseDelayMs * 2 ** (attempt - 1));
}
__name(delayFor, "delayFor");
__name2(delayFor, "delayFor");
function isTransient(error) {
  if (error instanceof ScanFailure) return error.transient;
  return true;
}
__name(isTransient, "isTransient");
__name2(isTransient, "isTransient");
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ScanFailure("timeout", "Cancelled.", false));
      },
      { once: true }
    );
  });
}
__name(sleep, "sleep");
__name2(sleep, "sleep");
async function withRetry(task, options = {}) {
  const maxAttempts = Math.max(1, options.attempts ?? 3);
  const budgetMs = options.budgetMs ?? 9e4;
  const startedAt = Date.now();
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new ScanFailure("timeout", "Cancelled.", false);
    }
    try {
      const value = await task({
        attempt,
        timeoutMs: options.timeoutFor?.(attempt - 1) ?? 3e4
      });
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const last = attempt === maxAttempts;
      const elapsed = Date.now() - startedAt;
      if (last || !isTransient(error) || elapsed >= budgetMs || options.signal?.aborted) {
        break;
      }
      const delayMs = delayFor(attempt, options.baseDelayMs);
      if (elapsed + delayMs >= budgetMs) break;
      options.onRetry?.({
        attempt,
        delayMs,
        reason: error instanceof ScanFailure ? error.code : "unknown"
      });
      await sleep(delayMs, options.signal);
    }
  }
  throw lastError;
}
__name(withRetry, "withRetry");
__name2(withRetry, "withRetry");
var MAX_BYTES = 6 * 1024 * 1024;
var ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
var hostEnv = /* @__PURE__ */ __name2(() => globalThis.process?.env ?? {}, "hostEnv");
function resolveProviders(env = hostEnv()) {
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const fdcKey = env.FDC_API_KEY?.trim();
  const nutrition = fdcKey ? new FoodDataCentralNutritionProvider(fdcKey) : null;
  if (env.FOOD_SCAN_MOCK === "1" && env.NODE_ENV !== "production") {
    return { vision: new DevMockVisionProvider(), nutrition, source: "mock" };
  }
  if (!geminiKey) {
    throw new ScanFailure(
      "not_configured",
      "Food analysis is not configured on this server."
    );
  }
  const model = env.GEMINI_MODEL?.trim() || void 0;
  return { vision: new GeminiFoodVisionProvider(geminiKey, model), nutrition, source: "live" };
}
__name(resolveProviders, "resolveProviders");
__name2(resolveProviders, "resolveProviders");
function decodeImage(body) {
  if (typeof body?.imageBase64 !== "string" || typeof body?.mimeType !== "string") {
    throw new ScanFailure("invalid_image", "No photo was received.");
  }
  if (!ACCEPTED.includes(body.mimeType)) {
    throw new ScanFailure("invalid_image", "That file isn't a photo we can read.");
  }
  const bytes = Math.floor(body.imageBase64.length * 3 / 4);
  if (bytes === 0) throw new ScanFailure("invalid_image", "That photo was empty.");
  if (bytes > MAX_BYTES) throw new ScanFailure("too_large", "That photo is too large to analyse.");
  return { base64: body.imageBase64, mimeType: body.mimeType };
}
__name(decodeImage, "decodeImage");
__name2(decodeImage, "decodeImage");
async function runFoodScan(body, providers, signal, onRetry) {
  const image = decodeImage(body);
  const { value: vision, attempts } = await withRetry(
    ({ timeoutMs }) => providers.vision.identify(image, signal, timeoutMs),
    {
      attempts: 3,
      baseDelayMs: 1e3,
      budgetMs: 9e4,
      signal,
      // The first call of a session stalls on a cold connection, so it gets a
      // shorter leash; later attempts are given more room.
      timeoutFor: /* @__PURE__ */ __name2((index) => [2e4, 3e4, 4e4][index] ?? 3e4, "timeoutFor"),
      onRetry
    }
  );
  const cache = /* @__PURE__ */ new Map();
  const items = [];
  for (const detected of vision.items) {
    const key = `${detected.name}|${detected.cookingMethod ?? ""}|${detected.quantity}|${detected.unit}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        providers.nutrition ? await providers.nutrition.lookup(
          {
            name: detected.name,
            foodType: detected.foodType,
            cookingMethod: detected.cookingMethod,
            quantity: detected.quantity,
            unit: detected.unit
          },
          signal
        ) : null
      );
    }
    const facts = cache.get(key) ?? null;
    const estimate = detected.estimatedKcal && detected.estimatedKcal > 0 ? {
      kcal: Math.round(detected.estimatedKcal),
      proteinG: Math.round(detected.estimatedProteinG ?? 0),
      carbsG: Math.round(detected.estimatedCarbsG ?? 0),
      fatG: Math.round(detected.estimatedFatG ?? 0)
    } : null;
    const nutrition = facts ?? estimate;
    const nutritionFrom = facts ? "database" : estimate ? "estimate" : "none";
    items.push({
      name: detected.name,
      quantity: Math.round(detected.quantity * 10) / 10,
      unit: detected.unit,
      kcal: nutrition?.kcal ?? 0,
      proteinG: nutrition?.proteinG ?? 0,
      carbsG: nutrition?.carbsG ?? 0,
      fatG: nutrition?.fatG ?? 0,
      confidence: Math.round(detected.confidence * 100) / 100,
      confidenceLevel: confidenceLevel(detected.confidence),
      alternatives: detected.alternatives,
      cookingMethod: detected.cookingMethod,
      matchedName: facts?.matchedName,
      matchLevel: facts ? confidenceLevel(facts.matchConfidence) : void 0,
      nutritionFrom,
      fromDatabase: facts !== null
    });
  }
  return {
    items,
    mealDescription: vision.mealDescription,
    overallConfidence: Math.round(vision.overallConfidence * 100) / 100,
    overallLevel: confidenceLevel(vision.overallConfidence),
    needsUserConfirmation: vision.needsUserConfirmation || items.some(
      (item) => item.nutritionFrom !== "database" || item.confidenceLevel === "low" || item.matchLevel === "low"
    ),
    estimated: true,
    source: providers.source,
    nutritionSource: providers.nutrition?.name ?? "none",
    attempts
  };
}
__name(runFoodScan, "runFoodScan");
__name2(runFoodScan, "runFoodScan");
var STATUS = {
  not_configured: 503,
  invalid_image: 400,
  too_large: 413,
  unauthorized: 502,
  rate_limited: 429,
  timeout: 504,
  provider_failed: 502,
  unreadable_response: 502,
  no_food_found: 422
};
async function handleFoodScanRequest(body, signal, env) {
  const started = Date.now();
  let providerName = "unknown";
  try {
    const providers = resolveProviders(env);
    providerName = providers.vision.name;
    let retries = 0;
    const result = await runFoodScan(body, providers, signal, (info) => {
      retries += 1;
      logScan({
        ok: false,
        provider: providerName,
        ms: Date.now() - started,
        errorCode: info.reason,
        attempt: info.attempt,
        retryInMs: info.delayMs
      });
    });
    logScan({
      ok: true,
      provider: providerName,
      ms: Date.now() - started,
      attempt: result.attempts,
      ...retries > 0 ? { recoveredAfterRetries: retries } : {}
    });
    return { status: 200, body: result };
  } catch (error) {
    const failure = error instanceof ScanFailure ? error : new ScanFailure("provider_failed", "Food analysis is temporarily unavailable.");
    logScan({
      ok: false,
      provider: providerName,
      ms: Date.now() - started,
      errorCode: failure.code
    });
    return { status: STATUS[failure.code] ?? 500, body: { error: failure.code, message: failure.message } };
  }
}
__name(handleFoodScanRequest, "handleFoodScanRequest");
__name2(handleFoodScanRequest, "handleFoodScanRequest");
function logScan(entry) {
  console.info("[food-scan]", JSON.stringify({ ...entry, at: (/* @__PURE__ */ new Date()).toISOString() }));
}
__name(logScan, "logScan");
__name2(logScan, "logScan");
var onRequestPost = /* @__PURE__ */ __name2(async (context) => {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json(
      { error: "invalid_image", message: "No photo was received." },
      { status: 400 }
    );
  }
  const { status, body: payload } = await handleFoodScanRequest(
    body,
    context.request.signal,
    context.env
  );
  return Response.json(payload, {
    status,
    // Nothing about a food photo or its analysis should be cached anywhere.
    headers: { "Cache-Control": "no-store" }
  });
}, "onRequestPost");
var onRequest = /* @__PURE__ */ __name2(async () => Response.json({ error: "method_not_allowed" }, { status: 405 }), "onRequest");
var routes = [
  {
    routePath: "/api/food-scan",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/food-scan",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  }
];
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
__name2(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name2(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name2(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name2(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name2(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name2(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
__name2(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
__name2(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name2(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
__name2(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
__name2(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
__name2(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
__name2(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
__name2(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
__name2(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
__name2(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");
__name2(pathToRegexp, "pathToRegexp");
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
__name2(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name2(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name2(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name2((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  static {
    __name(this, "___Facade_ScheduledController__");
  }
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name2(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name2((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name2((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// C:/Users/ultimanium/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// C:/Users/ultimanium/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-wQ3yjH/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = middleware_loader_entry_default;

// C:/Users/ultimanium/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-wQ3yjH/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class ___Facade_ScheduledController__2 {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=functionsWorker-0.5141626189262208.js.map
