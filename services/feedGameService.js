/**
 * feedGameService.js
 * 분유주기 협동 게임 전용 AI 서비스
 */

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * AI가 아기가 원하는 분유 맛의 힌트를 생성합니다.
 * @returns {Promise<string>} 힌트 문자열
 */
const generateCookingHint = async () => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "너는 육아 게임의 나레이터야. 아기가 오늘 어떤 기분이고 어떤 맛의 분유를 원하는지 아주 짧고 창의적인 힌트를 한 문장으로 줘. 예: '달콤한 구름 위를 걷는 기분이 되고 싶대요!', '상큼한 숲속 요정이 찾아온 것 같아요!'",
        },
      ],
      max_tokens: 100,
      temperature: 0.9,
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("AI Hint Error:", err);
    return "오늘따라 아주 달콤한 게 당기나 봐요!";
  }
};

/**
 * 부모들이 고른 재료 조합을 AI가 평가합니다.
 * @param {string} hint - 처음에 주어진 힌트
 * @param {Object} ingredients - { base: string, topping: string }
 * @returns {Promise<{score: number, story: string}>} 점수(0-100)와 스토리
 */
const evaluateCooking = async (hint, ingredients) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `너는 아기의 미식 가이드야. 부모가 만든 분유 레시피를 평가해줘.
          
          오늘의 힌트: "${hint}"
          선택한 베이스: "${ingredients.base}"
          선택한 토핑: "${ingredients.topping}"
          
          위 조합이 힌트와 얼마나 잘 어울리는지 0~100점 사이로 점수를 매기고, 아기가 먹었을 때의 반응을 아주 귀엽고 재미있게 2~3문장으로 설명해줘.
          
          반드시 JSON 형식으로 응답해:
          {
            "score": 85,
            "story": "우와! 정말 구름처럼 폭신하고 달콤한 맛이에요! 아기가 너무 기분 좋아서 엉덩이 춤을 춰요!"
          }`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error("AI Evaluation Error:", err);
    return {
      score: 70,
      story: "음~ 나쁘지 않은 조합이에요! 아기가 맛있게 잘 먹었답니다.",
    };
  }
};

module.exports = {
  generateCookingHint,
  evaluateCooking,
};
