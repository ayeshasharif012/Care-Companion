import HealthTipTemplate from "../models/HealthTipTemplate.js";

export const DEFAULT_HEALTH_TIP_TEMPLATES = {
  english: [
    { category: "hydration", tipText: "Drink at least 8 glasses of water daily to stay hydrated." },
    { category: "hydration", tipText: "Keep a water bottle with you throughout the day." },
    { category: "posture", tipText: "Sit up straight with your shoulders back and relaxed." },
    { category: "posture", tipText: "Take breaks every hour to stretch your neck and shoulders." },
    { category: "exercise", tipText: "Take a 30-minute walk every day for better health." },
    { category: "exercise", tipText: "Do gentle stretching exercises in the morning." },
    { category: "nutrition", tipText: "Eat more fruits and vegetables for better nutrition." },
    { category: "nutrition", tipText: "Avoid sugary drinks and prefer water or herbal tea." },
    { category: "wellness", tipText: "Get 7-8 hours of sleep every night." },
    { category: "wellness", tipText: "Practice deep breathing exercises to reduce stress." },
  ],
  urdu: [
    { category: "hydration", tipText: "روزانہ کم از کم 8 گلاس پانی پیئں۔" },
    { category: "hydration", tipText: "ہمیشہ اپنے ساتھ پانی کی بوتل رکھیں۔" },
    { category: "posture", tipText: "سیدھے بیٹھیں اور اپنے کندھے پیچھے رکھیں۔" },
    { category: "posture", tipText: "ہر گھنٹے میں اپنی گردن کو سمجھو کریں۔" },
    { category: "exercise", tipText: "روزانہ 30 منٹ کی سیر کریں۔" },
    { category: "exercise", tipText: "صبح میں نرم ورزش کریں۔" },
    { category: "nutrition", tipText: "زیادہ سے زیادہ پھل اور سبزیاں کھائیں۔" },
    { category: "nutrition", tipText: "شکر والے مشروبات سے بچیں اور پانی پیئں۔" },
    { category: "wellness", tipText: "ہر رات 7 سے 8 گھنٹے کی نیند لیں۔" },
    { category: "wellness", tipText: "گہری سانس لینے کی ورزش کریں تاکہ تناؤ کم ہو۔" },
  ],
};

export async function ensureHealthTipTemplatesSeeded() {
  const count = await HealthTipTemplate.countDocuments();
  if (count > 0) return count;

  const docs = [];
  for (const [language, items] of Object.entries(DEFAULT_HEALTH_TIP_TEMPLATES)) {
    for (const item of items) {
      docs.push({ language, ...item, active: true });
    }
  }
  await HealthTipTemplate.insertMany(docs);
  console.log(`✅ Seeded ${docs.length} health tip templates in MongoDB`);
  return docs.length;
}
